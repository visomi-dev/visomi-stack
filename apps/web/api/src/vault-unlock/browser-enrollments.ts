import { webcrypto } from 'node:crypto';

import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { lockUnlockScope } from './pin-profile';
import { unlockSessionHash } from './prf-store';
import type { PrfOwner, UnlockTransaction } from './prf-store';

import { fail, vaultBrowserEnrollments, withAccountContext } from 'shared';
import {
  browserVaultPairing,
  browserVaultDelivery,
  browserVaultFingerprint,
  verifyBrowserVaultPairing,
  verifyBrowserVaultConsume,
} from 'shared-crypto';
import type { BrowserVaultPairing, BrowserVaultConsume, DeviceKeyEnvelope } from 'shared-crypto';

const crypto = webcrypto as unknown as Crypto;

async function cleanExpired(tx: UnlockTransaction, owner: PrfOwner): Promise<void> {
  await tx
    .update(vaultBrowserEnrollments)
    .set({ envelope: null, revokedAt: DateTime.utc().toJSDate() })
    .where(
      and(
        eq(vaultBrowserEnrollments.accountId, owner.accountId),
        eq(vaultBrowserEnrollments.userId, owner.userId),
        lte(vaultBrowserEnrollments.expiresAt, DateTime.utc().toJSDate()),
        isNull(vaultBrowserEnrollments.revokedAt),
      ),
    );
}

async function pending(tx: UnlockTransaction, owner: PrfOwner, scopeId: string, requestId: string) {
  await lockUnlockScope(tx, owner, scopeId);
  const [record] = await tx
    .select()
    .from(vaultBrowserEnrollments)
    .where(
      and(
        eq(vaultBrowserEnrollments.id, requestId),
        eq(vaultBrowserEnrollments.accountId, scopeId),
        eq(vaultBrowserEnrollments.userId, owner.userId),
        eq(vaultBrowserEnrollments.authVersion, owner.authVersion),
        isNull(vaultBrowserEnrollments.consumedAt),
        isNull(vaultBrowserEnrollments.revokedAt),
        gt(vaultBrowserEnrollments.expiresAt, DateTime.utc().toJSDate()),
      ),
    )
    .for('update');

  if (!record) fail('vault_enrollment_unavailable', 'Start a new browser connection.', 410);

  return { ...record, pairing: browserVaultPairing.parse(record.pairing) };
}

async function expireRequests(owner: PrfOwner, scopeId: string): Promise<void> {
  // Separate commit: an expired-request rejection must not roll ciphertext erasure back.
  await withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    await cleanExpired(tx, owner);
  });
}

export async function beginBrowserEnrollment(owner: PrfOwner, scopeId: string, input: BrowserVaultPairing) {
  const pairing = browserVaultPairing.parse(input);
  const now = DateTime.utc();
  const expiry = DateTime.fromISO(pairing.expiresAt);
  const valid = await verifyBrowserVaultPairing(crypto, pairing);

  if (
    !valid ||
    pairing.ownerUserId !== owner.userId ||
    pairing.personalScopeId !== scopeId ||
    !expiry.isValid ||
    expiry <= now ||
    expiry > now.plus({ minutes: 10 })
  )
    fail('vault_enrollment_invalid', 'The browser request did not match. Start again.', 400);
  const fingerprint = await browserVaultFingerprint(crypto, pairing);

  await withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    await cleanExpired(tx, owner);
    const active = await tx
      .select({ id: vaultBrowserEnrollments.id })
      .from(vaultBrowserEnrollments)
      .where(
        and(
          eq(vaultBrowserEnrollments.accountId, scopeId),
          eq(vaultBrowserEnrollments.userId, owner.userId),
          isNull(vaultBrowserEnrollments.consumedAt),
          isNull(vaultBrowserEnrollments.revokedAt),
          gt(vaultBrowserEnrollments.expiresAt, now.toJSDate()),
        ),
      );

    if (active.length >= 5)
      fail('vault_enrollment_limit', 'Finish or cancel an existing browser connection first.', 429);
    const [inserted] = await tx
      .insert(vaultBrowserEnrollments)
      .values({
        id: pairing.requestId,
        accountId: scopeId,
        userId: owner.userId,
        authVersion: owner.authVersion,
        sessionHash: unlockSessionHash(owner.sessionId),
        pairing,
        expiresAt: expiry.toJSDate(),
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) fail('vault_enrollment_mismatch', 'Start a new browser connection.', 409);
  });

  return { requestId: pairing.requestId, fingerprint, expiresAt: pairing.expiresAt };
}

export async function inspectBrowserEnrollment(owner: PrfOwner, scopeId: string, requestId: string) {
  await expireRequests(owner, scopeId);

  return withAccountContext(owner, async (tx) => {
    const record = await pending(tx, owner, scopeId, requestId);
    const fingerprint = await browserVaultFingerprint(crypto, record.pairing);

    return { pairing: record.pairing, fingerprint, approved: Boolean(record.envelope) };
  });
}

export async function approveBrowserEnrollment(
  owner: PrfOwner,
  scopeId: string,
  requestId: string,
  fingerprint: string,
  input: DeviceKeyEnvelope,
): Promise<void> {
  const envelope = browserVaultDelivery.parse(input);

  await expireRequests(owner, scopeId);
  await withAccountContext(owner, async (tx) => {
    const record = await pending(tx, owner, scopeId, requestId);
    const expected = await browserVaultFingerprint(crypto, record.pairing);

    if (record.sessionHash === unlockSessionHash(owner.sessionId) || record.envelope || expected !== fingerprint)
      fail('vault_enrollment_mismatch', 'Check the code on both browsers and try again.', 409);
    await tx.update(vaultBrowserEnrollments).set({ envelope }).where(eq(vaultBrowserEnrollments.id, requestId));
  });
}

export async function consumeBrowserEnrollment(
  owner: PrfOwner,
  scopeId: string,
  requestId: string,
  proof: BrowserVaultConsume,
) {
  await expireRequests(owner, scopeId);

  return withAccountContext(owner, async (tx) => {
    const record = await pending(tx, owner, scopeId, requestId);
    const issuedAt = DateTime.fromISO(proof.issuedAt).toMillis();
    const valid = await verifyBrowserVaultConsume(crypto, record.pairing, proof);

    if (
      !valid ||
      record.sessionHash !== unlockSessionHash(owner.sessionId) ||
      !Number.isFinite(issuedAt) ||
      Math.abs(DateTime.utc().toMillis() - issuedAt) > 60_000
    )
      fail('vault_enrollment_proof_invalid', 'Start a new browser connection.', 401);
    if (!record.envelope)
      fail('vault_enrollment_waiting', 'Approve the connection on your trusted browser first.', 409);
    const envelope = browserVaultDelivery.parse(record.envelope);

    await tx
      .update(vaultBrowserEnrollments)
      .set({ consumedAt: DateTime.utc().toJSDate(), envelope: null })
      .where(eq(vaultBrowserEnrollments.id, requestId));

    return envelope;
  });
}

export async function cancelBrowserEnrollment(owner: PrfOwner, scopeId: string, requestId: string): Promise<void> {
  await expireRequests(owner, scopeId);
  await withAccountContext(owner, async (tx) => {
    const record = await pending(tx, owner, scopeId, requestId);

    if (record.sessionHash !== unlockSessionHash(owner.sessionId))
      fail('vault_enrollment_mismatch', 'Cancel the connection on the requesting browser.', 403);
    await tx
      .update(vaultBrowserEnrollments)
      .set({ revokedAt: DateTime.utc().toJSDate(), envelope: null })
      .where(eq(vaultBrowserEnrollments.id, requestId));
  });
}
