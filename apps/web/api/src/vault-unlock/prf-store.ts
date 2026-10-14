import { createHash } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { z } from 'zod';

import { lockUnlockScope } from './pin-profile';
import type { UnlockOwner } from './pin-profile';
import type { methodCreateInput } from './prf-contract';

import { accountPasskeyCredentials, fail, vaultUnlockAssertions, vaultUnlockMethods, withAccountContext } from 'shared';
import { prfKeyEnvelope } from 'shared-crypto';

export type PrfOwner = UnlockOwner & { sessionId: string };
export type UnlockTransaction = Parameters<Parameters<typeof withAccountContext>[1]>[0];

export function unlockSessionHash(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

export async function activeUnlockCredential(tx: UnlockTransaction, owner: PrfOwner, recordId: string) {
  const [credential] = await tx
    .select()
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.id, recordId),
        eq(accountPasskeyCredentials.accountId, owner.accountId),
        eq(accountPasskeyCredentials.userId, owner.userId),
        eq(accountPasskeyCredentials.status, 'active'),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    )
    .for('update');

  if (!credential) fail('vault_method_unavailable', 'Use another method or your recovery key.', 404);

  return credential;
}

export async function listUnlockMethods(owner: PrfOwner, scopeId: string) {
  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);

    return tx
      .select({
        methodId: vaultUnlockMethods.id,
        credentialId: accountPasskeyCredentials.credentialId,
        revision: vaultUnlockMethods.revision,
        createdAt: vaultUnlockMethods.createdAt,
      })
      .from(vaultUnlockMethods)
      .innerJoin(accountPasskeyCredentials, eq(vaultUnlockMethods.credentialRecordId, accountPasskeyCredentials.id))
      .where(
        and(
          eq(vaultUnlockMethods.accountId, scopeId),
          eq(vaultUnlockMethods.userId, owner.userId),
          eq(accountPasskeyCredentials.accountId, scopeId),
          eq(accountPasskeyCredentials.userId, owner.userId),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(vaultUnlockMethods.revokedAt),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      );
  });
}

export async function createUnlockMethod(owner: PrfOwner, scopeId: string, input: z.infer<typeof methodCreateInput>) {
  const envelope = prfKeyEnvelope.parse(input.envelope);

  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const now = DateTime.utc().toJSDate();
    const [proof] = await tx
      .select()
      .from(vaultUnlockAssertions)
      .where(
        and(
          eq(vaultUnlockAssertions.id, input.enrollmentProofId),
          eq(vaultUnlockAssertions.accountId, scopeId),
          eq(vaultUnlockAssertions.userId, owner.userId),
          gt(vaultUnlockAssertions.expiresAt, now),
        ),
      )
      .for('update');

    if (
      !proof ||
      proof.purpose !== 'enroll' ||
      !proof.consumedAt ||
      !proof.verifiedAt ||
      proof.appliedAt ||
      proof.sessionHash !== unlockSessionHash(owner.sessionId) ||
      proof.authVersion !== owner.authVersion
    )
      fail('vault_proof_unavailable', 'Confirm your passkey again.', 401);
    const credential = await activeUnlockCredential(tx, owner, proof.credentialRecordId);
    const binding = envelope.binding;

    if (
      binding.ownerUserId !== owner.userId ||
      binding.personalScopeId !== scopeId ||
      binding.methodId !== proof.methodId ||
      binding.methodId !== input.methodId ||
      binding.credentialId !== credential.credentialId ||
      input.credentialId !== credential.credentialId ||
      envelope.prfInput !== proof.prfInput
    )
      fail('vault_binding_mismatch', 'The vault setup did not match. Try again.', 400);
    const methods = await tx
      .select()
      .from(vaultUnlockMethods)
      .where(
        and(
          eq(vaultUnlockMethods.accountId, scopeId),
          eq(vaultUnlockMethods.userId, owner.userId),
          isNull(vaultUnlockMethods.revokedAt),
        ),
      );

    if (methods.length >= 20 || methods.some((method) => method.credentialRecordId === credential.id))
      fail('vault_method_conflict', 'This passkey is already set up or the method limit was reached.', 409);
    await tx.update(vaultUnlockAssertions).set({ appliedAt: now }).where(eq(vaultUnlockAssertions.id, proof.id));
    await tx.insert(vaultUnlockMethods).values({
      id: proof.methodId,
      accountId: scopeId,
      userId: owner.userId,
      credentialRecordId: credential.id,
      envelope,
      revision: 1,
      createdAt: now,
    });

    return { methodId: proof.methodId, revision: 1 };
  });
}

export async function revokeUnlockMethod(owner: PrfOwner, scopeId: string, methodId: string, expectedRevision: number) {
  await withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const [method] = await tx
      .select()
      .from(vaultUnlockMethods)
      .where(
        and(
          eq(vaultUnlockMethods.id, methodId),
          eq(vaultUnlockMethods.accountId, scopeId),
          eq(vaultUnlockMethods.userId, owner.userId),
        ),
      )
      .for('update');

    if (!method) fail('vault_method_unavailable', 'This unlock method is unavailable.', 404);
    if (method.revokedAt) return;
    if (method.revision !== expectedRevision)
      fail('vault_method_conflict', 'The method changed. Refresh and try again.', 409);
    await tx
      .update(vaultUnlockMethods)
      .set({ revokedAt: DateTime.utc().toJSDate(), revision: method.revision + 1 })
      .where(eq(vaultUnlockMethods.id, method.id));
  });
}
