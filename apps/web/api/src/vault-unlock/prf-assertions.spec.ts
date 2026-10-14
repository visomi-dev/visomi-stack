import { randomUUID } from 'node:crypto';

import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { beginUnlockAssertion, completeUnlockAssertion } from './prf-assertions';
import { assertionCompleteInput } from './prf-contract';
import { createUnlockMethod, listUnlockMethods, revokeUnlockMethod } from './prf-store';
import { closeVaultTestDatabase, migrateVaultTestDatabase } from './test-database';

import {
  accounts,
  accountMemberships,
  accountPasskeyCredentials,
  db,
  users,
  vaultUnlockAssertions,
  vaultUnlockMethods,
} from 'shared';
import type { PrfKeyEnvelope } from 'shared-crypto';

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const owners: { userId: string; accountId: string }[] = [];

beforeAll(migrateVaultTestDatabase, 30000);
afterAll(async () => {
  await closeVaultTestDatabase(owners);
});
beforeEach(() => {
  jest
    .mocked(generateAuthenticationOptions)
    .mockReset()
    .mockResolvedValue({ challenge: 'test-challenge', rpId: 'localhost', userVerification: 'required' });
  jest
    .mocked(verifyAuthenticationResponse)
    .mockReset()
    .mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'AQ',
        newCounter: 1,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost',
        rpID: 'localhost',
      },
    });
});

async function fixture() {
  const owner = { userId: randomUUID(), accountId: randomUUID(), authVersion: 1, sessionId: randomUUID() };

  owners.push(owner);
  const credentialRecordId = randomUUID();
  const credentialId = Buffer.from(randomUUID()).toString('base64url');

  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  await db
    .insert(accounts)
    .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Workspace', slug: owner.accountId });
  await db
    .insert(accountMemberships)
    .values({ id: randomUUID(), accountId: owner.accountId, userId: owner.userId, role: 'owner' });
  await db.insert(accountPasskeyCredentials).values({
    id: credentialRecordId,
    accountId: owner.accountId,
    userId: owner.userId,
    credentialId,
    publicKey: 'AQ',
    rpId: 'localhost',
    label: 'Test passkey',
    status: 'active',
  });

  return { owner, credentialRecordId, credentialId };
}

function response(credentialId: string) {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key' as const,
    response: { clientDataJSON: 'AQ', authenticatorData: 'AQ', signature: 'AQ' },
    clientExtensionResults: {},
  };
}

async function enrollment() {
  const value = await fixture();
  const begun = await beginUnlockAssertion(value.owner, value.owner.accountId, {
    purpose: 'enroll',
    credentialId: value.credentialId,
  });
  const completed = await completeUnlockAssertion(value.owner, value.owner.accountId, {
    challengeId: begun.challengeId,
    response: response(value.credentialId),
  });
  const envelope: PrfKeyEnvelope = {
    version: 1,
    hkdfSalt: 'A'.repeat(43),
    iv: 'A'.repeat(16),
    ciphertext: 'A'.repeat(64),
    kdfProfile: 'prf-hkdf-sha256-v1',
    prfInput: begun.prfInput,
    binding: {
      ownerUserId: value.owner.userId,
      personalScopeId: value.owner.accountId,
      methodId: begun.methodId,
      methodKind: 'passkey-prf',
      credentialId: value.credentialId,
      keyGeneration: 1,
    },
  };

  if (completed.purpose !== 'enroll') throw new Error('unexpected_assertion_purpose');

  return {
    ...value,
    begun,
    input: {
      methodId: begun.methodId,
      credentialId: value.credentialId,
      envelope,
      enrollmentProofId: completed.enrollmentProofId,
      grantId: randomUUID(),
    },
  };
}

describe('session-bound PRF assertions and enrolled ciphertext authority', () => {
  it('requires UV and returns no ciphertext until a verified single-use assertion', async () => {
    const { owner, credentialId, begun, input } = await enrollment();

    expect(generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        userVerification: 'required',
        timeout: 60000,
        allowCredentials: [{ id: credentialId }],
      }),
    );
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true, expectedChallenge: 'test-challenge' }),
    );
    expect(await createUnlockMethod(owner, owner.accountId, input)).toEqual({ methodId: begun.methodId, revision: 1 });
    const methods = await listUnlockMethods(owner, owner.accountId);

    expect(methods).toHaveLength(1);
    expect(methods[0]).not.toHaveProperty('envelope');
    await expect(createUnlockMethod(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_proof_unavailable',
    });
    await expect(
      completeUnlockAssertion(owner, owner.accountId, {
        challengeId: begun.challengeId,
        response: response(credentialId),
      }),
    ).rejects.toMatchObject({ code: 'vault_assertion_unavailable' });
    const unlock = await beginUnlockAssertion(owner, owner.accountId, { purpose: 'unlock', methodId: begun.methodId });

    expect(unlock.prfInput).toBe(input.envelope.prfInput);
    expect(
      await completeUnlockAssertion(owner, owner.accountId, {
        challengeId: unlock.challengeId,
        response: response(credentialId),
      }),
    ).toEqual({ purpose: 'unlock', envelope: input.envelope });
  });

  it('rejects PRF output and unrecognized extension fields at the HTTP contract', () => {
    const payload = { challengeId: randomUUID(), response: response('AQ') };

    expect(assertionCompleteInput.safeParse(payload).success).toBe(true);
    expect(
      assertionCompleteInput.safeParse({
        ...payload,
        response: { ...payload.response, clientExtensionResults: { prf: { results: { first: 'secret' } } } },
      }).success,
    ).toBe(false);
    expect(assertionCompleteInput.safeParse({ ...payload, prfOutput: 'secret' }).success).toBe(false);
  });

  it('denies foreign account, user and session before invoking WebAuthn verification', async () => {
    const { owner, credentialId } = await fixture();
    const begun = await beginUnlockAssertion(owner, owner.accountId, { purpose: 'enroll', credentialId });
    const input = { challengeId: begun.challengeId, response: response(credentialId) };

    await expect(
      completeUnlockAssertion({ ...owner, sessionId: randomUUID() }, owner.accountId, input),
    ).rejects.toMatchObject({ code: 'vault_assertion_unavailable' });
    await expect(completeUnlockAssertion(owner, randomUUID(), input)).rejects.toMatchObject({
      code: 'vault_access_denied',
    });
    const foreign = await fixture();

    await expect(completeUnlockAssertion(foreign.owner, foreign.owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_assertion_unavailable',
    });
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('does not accept enrollment proof from another session or mismatched ciphertext binding', async () => {
    const { owner, input } = await enrollment();

    await expect(
      createUnlockMethod({ ...owner, sessionId: randomUUID() }, owner.accountId, input),
    ).rejects.toMatchObject({ code: 'vault_proof_unavailable' });
    await expect(
      createUnlockMethod(owner, owner.accountId, {
        ...input,
        envelope: { ...input.envelope, binding: { ...input.envelope.binding, ownerUserId: randomUUID() } },
      }),
    ).rejects.toMatchObject({ code: 'vault_binding_mismatch' });
    expect(await listUnlockMethods(owner, owner.accountId)).toEqual([]);
    await createUnlockMethod(owner, owner.accountId, input);
  });

  it('denies expired and unverified proofs without inserting methods', async () => {
    const { owner, begun, input } = await enrollment();

    await db
      .update(vaultUnlockAssertions)
      .set({ verifiedAt: null })
      .where(eq(vaultUnlockAssertions.id, begun.challengeId));
    await expect(createUnlockMethod(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_proof_unavailable',
    });
    await db
      .update(vaultUnlockAssertions)
      .set({ verifiedAt: DateTime.utc().toJSDate(), expiresAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() })
      .where(eq(vaultUnlockAssertions.id, begun.challengeId));
    await expect(createUnlockMethod(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_proof_unavailable',
    });
    expect(await listUnlockMethods(owner, owner.accountId)).toEqual([]);
  });

  it('caps pending assertions at five and removes expired assertions before retry', async () => {
    const { owner, credentialId } = await fixture();

    for (let index = 0; index < 5; index++)
      await beginUnlockAssertion(owner, owner.accountId, { purpose: 'enroll', credentialId });
    await expect(
      beginUnlockAssertion(owner, owner.accountId, { purpose: 'enroll', credentialId }),
    ).rejects.toMatchObject({ code: 'vault_assertion_limit' });
    await db
      .update(vaultUnlockAssertions)
      .set({ expiresAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() })
      .where(eq(vaultUnlockAssertions.userId, owner.userId));
    await expect(
      beginUnlockAssertion(owner, owner.accountId, { purpose: 'enroll', credentialId }),
    ).resolves.toHaveProperty('challengeId');
  });

  it('rejects failed signatures and stale counters without applying a challenge', async () => {
    const { owner, credentialId, credentialRecordId } = await fixture();
    const begun = await beginUnlockAssertion(owner, owner.accountId, { purpose: 'enroll', credentialId });
    const input = { challengeId: begun.challengeId, response: response(credentialId) };

    jest.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(new Error('invalid_signature'));
    await expect(completeUnlockAssertion(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_assertion_unavailable',
    });
    await db
      .update(accountPasskeyCredentials)
      .set({ signCount: 2 })
      .where(eq(accountPasskeyCredentials.id, credentialRecordId));
    await expect(completeUnlockAssertion(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_assertion_unavailable',
    });
    const [record] = await db
      .select()
      .from(vaultUnlockAssertions)
      .where(eq(vaultUnlockAssertions.id, begun.challengeId));

    expect(record.consumedAt).toBeNull();
  });

  it('enforces revision revocation and rejects assertions begun before revocation', async () => {
    const { owner, credentialId, begun, input } = await enrollment();

    await createUnlockMethod(owner, owner.accountId, input);
    const unlock = await beginUnlockAssertion(owner, owner.accountId, { purpose: 'unlock', methodId: begun.methodId });

    await expect(revokeUnlockMethod(owner, owner.accountId, begun.methodId, 2)).rejects.toMatchObject({
      code: 'vault_method_conflict',
    });
    await revokeUnlockMethod(owner, owner.accountId, begun.methodId, 1);
    expect(await listUnlockMethods(owner, owner.accountId)).toEqual([]);
    await expect(
      completeUnlockAssertion(owner, owner.accountId, {
        challengeId: unlock.challengeId,
        response: response(credentialId),
      }),
    ).rejects.toMatchObject({ code: 'vault_method_unavailable' });
    const [method] = await db.select().from(vaultUnlockMethods).where(eq(vaultUnlockMethods.id, begun.methodId));

    expect(method.revision).toBe(2);
  });

  it('rejects revoked credentials, auth-version changes and removed memberships', async () => {
    const { owner, credentialRecordId, credentialId } = await fixture();
    const begun = await beginUnlockAssertion(owner, owner.accountId, { purpose: 'enroll', credentialId });
    const input = { challengeId: begun.challengeId, response: response(credentialId) };

    await db
      .update(accountPasskeyCredentials)
      .set({ status: 'revoked' })
      .where(eq(accountPasskeyCredentials.id, credentialRecordId));
    await expect(completeUnlockAssertion(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_method_unavailable',
    });
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, owner.userId));
    await expect(completeUnlockAssertion(owner, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_access_denied',
    });
    await expect(completeUnlockAssertion({ ...owner, authVersion: 2 }, owner.accountId, input)).rejects.toMatchObject({
      code: 'vault_assertion_unavailable',
    });
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    expect(
      await db.select().from(vaultUnlockAssertions).where(eq(vaultUnlockAssertions.id, begun.challengeId)),
    ).toEqual([]);
  });
});
