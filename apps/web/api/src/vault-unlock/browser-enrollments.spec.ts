import { randomUUID, webcrypto } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import {
  approveBrowserEnrollment,
  beginBrowserEnrollment,
  cancelBrowserEnrollment,
  consumeBrowserEnrollment,
  inspectBrowserEnrollment,
} from './browser-enrollments';
import { closeVaultTestDatabase, migrateVaultTestDatabase } from './test-database';

import {
  accounts,
  accountMemberships,
  db,
  ManagedMemorySessionStore,
  revokeSessionVaultCustody,
  users,
  userSessions,
  vaultBrowserEnrollments,
} from 'shared';
import {
  browserVaultBinding,
  createBrowserVaultPairing,
  openBrowserVaultKey,
  sealBrowserVaultKey,
  signBrowserVaultConsume,
} from 'shared-crypto';

const crypto = webcrypto as unknown as Crypto;
const owners: { userId: string; accountId: string }[] = [];

beforeAll(migrateVaultTestDatabase, 30000);
afterAll(() => closeVaultTestDatabase(owners));

async function fixture() {
  const owner = { userId: randomUUID(), accountId: randomUUID(), authVersion: 1, sessionId: randomUUID() };

  owners.push(owner);
  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  await db
    .insert(accounts)
    .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Workspace', slug: owner.accountId });
  await db
    .insert(accountMemberships)
    .values({ id: randomUUID(), accountId: owner.accountId, userId: owner.userId, role: 'owner' });
  const { identity, pairing } = await createBrowserVaultPairing(
    crypto,
    owner.userId,
    owner.accountId,
    DateTime.utc().plus({ minutes: 5 }).toISO(),
  );
  const begun = await beginBrowserEnrollment(owner, owner.accountId, pairing);
  const binding = browserVaultBinding.parse({
    requestId: pairing.requestId,
    ownerUserId: owner.userId,
    personalScopeId: owner.accountId,
    challenge: pairing.challenge,
    fingerprint: begun.fingerprint,
    recipientEncryption: pairing.keys.encryption,
    keyGeneration: 1,
  });
  const plaintext = new Uint8Array(32).fill(42);
  const envelope = await sealBrowserVaultKey(crypto, plaintext, binding);

  plaintext.fill(0);
  const approver = { ...owner, sessionId: randomUUID() };
  const proof = await signBrowserVaultConsume(crypto, identity.signing.privateKey, pairing, {
    nonce: randomUUID(),
    issuedAt: DateTime.utc().toISO(),
  });

  return { owner, approver, identity, pairing, begun, binding, envelope, proof };
}

describe('signed, session-bound browser vault delivery relay', () => {
  it('erases requester ciphertext through trusted memory-session revocation without affecting another session', async () => {
    const value = await fixture();
    const other = await fixture();
    const store = new ManagedMemorySessionStore(revokeSessionVaultCustody);

    await approveBrowserEnrollment(
      value.approver,
      value.owner.accountId,
      value.pairing.requestId,
      value.begun.fingerprint,
      value.envelope,
    );
    await approveBrowserEnrollment(
      other.approver,
      other.owner.accountId,
      other.pairing.requestId,
      other.begun.fingerprint,
      other.envelope,
    );
    await new Promise<void>((resolve, reject) =>
      store.destroy(value.owner.sessionId, (error) => (error ? reject(error) : resolve())),
    );
    const [record] = await db
      .select()
      .from(vaultBrowserEnrollments)
      .where(eq(vaultBrowserEnrollments.id, value.pairing.requestId));
    const [unrelated] = await db
      .select()
      .from(vaultBrowserEnrollments)
      .where(eq(vaultBrowserEnrollments.id, other.pairing.requestId));

    expect(record.envelope).toBeNull();
    expect(record.revokedAt).not.toBeNull();
    expect(unrelated.envelope).toEqual(other.envelope);
    await expect(
      consumeBrowserEnrollment(value.owner, value.owner.accountId, value.pairing.requestId, value.proof),
    ).rejects.toMatchObject({ code: 'vault_enrollment_unavailable' });
  });

  it.each(['revocation', 'scope', 'delete', 'version'] as const)(
    'erases ciphertext transactionally on durable session %s',
    async (change) => {
      const value = await fixture();
      const sess = {
        authority: 'full',
        passport: { user: { id: value.owner.userId, accountId: value.owner.accountId, authVersion: 1 } },
      };

      await db
        .insert(userSessions)
        .values({ sid: value.owner.sessionId, sess, expiresAt: DateTime.utc().plus({ minutes: 10 }).toJSDate() });
      try {
        await approveBrowserEnrollment(
          value.approver,
          value.owner.accountId,
          value.pairing.requestId,
          value.begun.fingerprint,
          value.envelope,
        );
        if (change === 'revocation')
          await db
            .update(userSessions)
            .set({ revokedAt: DateTime.utc().toJSDate() })
            .where(eq(userSessions.sid, value.owner.sessionId));
        if (change === 'scope')
          await db
            .update(userSessions)
            .set({ sess: { ...sess, passport: { user: { ...sess.passport.user, accountId: randomUUID() } } } })
            .where(eq(userSessions.sid, value.owner.sessionId));
        if (change === 'delete') await db.delete(userSessions).where(eq(userSessions.sid, value.owner.sessionId));
        if (change === 'version')
          await db.update(users).set({ authVersion: 2 }).where(eq(users.id, value.owner.userId));
        const [record] = await db
          .select()
          .from(vaultBrowserEnrollments)
          .where(eq(vaultBrowserEnrollments.id, value.pairing.requestId));

        expect(record.envelope).toBeNull();
        expect(record.revokedAt).not.toBeNull();
      } finally {
        await db.delete(userSessions).where(eq(userSessions.sid, value.owner.sessionId));
      }
    },
  );

  it('exposes only pairing metadata and consumes ciphertext exactly once in the original session', async () => {
    const value = await fixture();

    await approveBrowserEnrollment(
      value.approver,
      value.owner.accountId,
      value.pairing.requestId,
      value.begun.fingerprint,
      value.envelope,
    );
    const inspected = await inspectBrowserEnrollment(value.owner, value.owner.accountId, value.pairing.requestId);

    expect(inspected.approved).toBe(true);
    expect(inspected).not.toHaveProperty('envelope');
    const delivered = await consumeBrowserEnrollment(
      value.owner,
      value.owner.accountId,
      value.pairing.requestId,
      value.proof,
    );
    const bytes = await openBrowserVaultKey(crypto, value.identity.encryption.privateKey, value.binding, delivered);

    expect(bytes).toEqual(new Uint8Array(32).fill(42));
    bytes.fill(0);
    await expect(
      consumeBrowserEnrollment(value.owner, value.owner.accountId, value.pairing.requestId, value.proof),
    ).rejects.toMatchObject({ code: 'vault_enrollment_unavailable' });
    const [record] = await db
      .select()
      .from(vaultBrowserEnrollments)
      .where(eq(vaultBrowserEnrollments.id, value.pairing.requestId));

    expect(record.envelope).toBeNull();
    expect(record.consumedAt).not.toBeNull();
  });

  it('rejects self-approval, fingerprint substitution, repeat approval and foreign-session consumption', async () => {
    const value = await fixture();
    const { owner, approver, pairing, begun, envelope, proof } = value;

    await expect(
      approveBrowserEnrollment(owner, owner.accountId, pairing.requestId, begun.fingerprint, envelope),
    ).rejects.toMatchObject({ code: 'vault_enrollment_mismatch' });
    await expect(
      approveBrowserEnrollment(approver, owner.accountId, pairing.requestId, 'A'.repeat(43), envelope),
    ).rejects.toMatchObject({ code: 'vault_enrollment_mismatch' });
    await expect(consumeBrowserEnrollment(owner, owner.accountId, pairing.requestId, proof)).rejects.toMatchObject({
      code: 'vault_enrollment_waiting',
    });
    await approveBrowserEnrollment(approver, owner.accountId, pairing.requestId, begun.fingerprint, envelope);
    await expect(
      approveBrowserEnrollment(approver, owner.accountId, pairing.requestId, begun.fingerprint, envelope),
    ).rejects.toMatchObject({ code: 'vault_enrollment_mismatch' });
    await expect(consumeBrowserEnrollment(approver, owner.accountId, pairing.requestId, proof)).rejects.toMatchObject({
      code: 'vault_enrollment_proof_invalid',
    });
    await expect(
      consumeBrowserEnrollment(owner, owner.accountId, pairing.requestId, { ...proof, nonce: randomUUID() }),
    ).rejects.toMatchObject({ code: 'vault_enrollment_proof_invalid' });
    await consumeBrowserEnrollment(owner, owner.accountId, pairing.requestId, proof);
  });

  it('commits expired ciphertext erasure even when the requested operation rejects', async () => {
    const { owner, approver, pairing, begun, envelope, proof } = await fixture();

    await approveBrowserEnrollment(approver, owner.accountId, pairing.requestId, begun.fingerprint, envelope);
    await db
      .update(vaultBrowserEnrollments)
      .set({ expiresAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() })
      .where(eq(vaultBrowserEnrollments.id, pairing.requestId));
    await expect(consumeBrowserEnrollment(owner, owner.accountId, pairing.requestId, proof)).rejects.toMatchObject({
      code: 'vault_enrollment_unavailable',
    });
    const [record] = await db
      .select()
      .from(vaultBrowserEnrollments)
      .where(eq(vaultBrowserEnrollments.id, pairing.requestId));

    expect(record.envelope).toBeNull();
    expect(record.revokedAt).not.toBeNull();
  });

  it('allows only requester cancellation and denies stale version, foreign account and removed membership', async () => {
    const { owner, approver, pairing, begun, envelope } = await fixture();

    await approveBrowserEnrollment(approver, owner.accountId, pairing.requestId, begun.fingerprint, envelope);
    await expect(cancelBrowserEnrollment(approver, owner.accountId, pairing.requestId)).rejects.toMatchObject({
      code: 'vault_enrollment_mismatch',
    });
    await expect(inspectBrowserEnrollment(owner, randomUUID(), pairing.requestId)).rejects.toMatchObject({
      code: 'vault_access_denied',
    });
    await expect(
      inspectBrowserEnrollment({ ...owner, authVersion: 2 }, owner.accountId, pairing.requestId),
    ).rejects.toMatchObject({ code: 'vault_access_denied' });
    await cancelBrowserEnrollment(owner, owner.accountId, pairing.requestId);
    const [record] = await db
      .select()
      .from(vaultBrowserEnrollments)
      .where(eq(vaultBrowserEnrollments.id, pairing.requestId));

    expect(record.envelope).toBeNull();
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    expect(
      await db.select().from(vaultBrowserEnrollments).where(eq(vaultBrowserEnrollments.id, pairing.requestId)),
    ).toEqual([]);
  });

  it('denies expired, overlong, substituted and duplicate signed pairings', async () => {
    const { owner, pairing } = await fixture();

    await expect(beginBrowserEnrollment(owner, owner.accountId, pairing)).rejects.toMatchObject({
      code: 'vault_enrollment_mismatch',
    });
    await expect(
      beginBrowserEnrollment(owner, owner.accountId, { ...pairing, ownerUserId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'vault_enrollment_invalid' });
    for (const expiresAt of [
      DateTime.utc().minus({ seconds: 1 }).toISO(),
      DateTime.utc().plus({ minutes: 11 }).toISO(),
    ]) {
      const created = await createBrowserVaultPairing(crypto, owner.userId, owner.accountId, expiresAt);

      await expect(beginBrowserEnrollment(owner, owner.accountId, created.pairing)).rejects.toMatchObject({
        code: 'vault_enrollment_invalid',
      });
    }
  });
});
