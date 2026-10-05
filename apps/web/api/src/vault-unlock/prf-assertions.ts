import { randomBytes, randomUUID } from 'node:crypto';

import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { z } from 'zod';

import { env } from '../shared/env';

import { lockUnlockScope } from './pin-profile';
import type { assertionBeginInput, assertionCompleteInput } from './prf-contract';
import { activeUnlockCredential, unlockSessionHash } from './prf-store';
import type { PrfOwner } from './prf-store';

import { accountPasskeyCredentials, fail, vaultUnlockAssertions, vaultUnlockMethods, withAccountContext } from 'shared';
import { prfKeyEnvelope } from 'shared-crypto';

const rpId = process.env.WEBAUTHN_RP_ID ?? 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN ?? new URL(env.APP_BASE_URL).origin;

export async function beginUnlockAssertion(
  owner: PrfOwner,
  scopeId: string,
  input: z.infer<typeof assertionBeginInput>,
) {
  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const now = DateTime.utc();

    await tx
      .delete(vaultUnlockAssertions)
      .where(
        and(
          eq(vaultUnlockAssertions.accountId, scopeId),
          eq(vaultUnlockAssertions.userId, owner.userId),
          lte(vaultUnlockAssertions.expiresAt, now.toJSDate()),
        ),
      );
    const pending = await tx
      .select({ id: vaultUnlockAssertions.id })
      .from(vaultUnlockAssertions)
      .where(
        and(
          eq(vaultUnlockAssertions.accountId, scopeId),
          eq(vaultUnlockAssertions.userId, owner.userId),
          isNull(vaultUnlockAssertions.appliedAt),
          gt(vaultUnlockAssertions.expiresAt, now.toJSDate()),
        ),
      );

    if (pending.length >= 5) fail('vault_assertion_limit', 'Wait a minute before trying again.', 429);
    let method: typeof vaultUnlockMethods.$inferSelect | undefined;
    let selected: typeof accountPasskeyCredentials.$inferSelect | undefined;

    if (input.purpose === 'unlock') {
      [method] = await tx
        .select()
        .from(vaultUnlockMethods)
        .where(
          and(
            eq(vaultUnlockMethods.id, input.methodId),
            eq(vaultUnlockMethods.accountId, scopeId),
            eq(vaultUnlockMethods.userId, owner.userId),
            isNull(vaultUnlockMethods.revokedAt),
          ),
        );
    } else {
      [selected] = await tx
        .select()
        .from(accountPasskeyCredentials)
        .where(
          and(
            eq(accountPasskeyCredentials.accountId, scopeId),
            eq(accountPasskeyCredentials.userId, owner.userId),
            eq(accountPasskeyCredentials.credentialId, input.credentialId),
            eq(accountPasskeyCredentials.status, 'active'),
            isNull(accountPasskeyCredentials.revokedAt),
          ),
        );
    }
    const recordId = method?.credentialRecordId ?? selected?.id;

    if (!recordId) fail('vault_method_unavailable', 'Use your recovery key or set up a passkey.', 404);
    const credential = await activeUnlockCredential(tx, owner, recordId);
    const prfInput = method ? prfKeyEnvelope.parse(method.envelope).prfInput : randomBytes(32).toString('base64url');
    const methodId = method?.id ?? randomUUID();
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      timeout: 60_000,
      allowCredentials: [{ id: credential.credentialId }],
    });
    const challengeId = randomUUID();
    const expiresAt = now.plus({ seconds: 60 }).toJSDate();

    await tx.insert(vaultUnlockAssertions).values({
      id: challengeId,
      accountId: scopeId,
      userId: owner.userId,
      credentialRecordId: credential.id,
      authVersion: owner.authVersion,
      sessionHash: unlockSessionHash(owner.sessionId),
      purpose: input.purpose,
      methodId,
      prfInput,
      challenge: options.challenge,
      expiresAt,
    });

    return {
      challengeId,
      methodId,
      credentialId: credential.credentialId,
      prfInput,
      options,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function completeUnlockAssertion(
  owner: PrfOwner,
  scopeId: string,
  input: z.infer<typeof assertionCompleteInput>,
) {
  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const now = DateTime.utc().toJSDate();
    const [challenge] = await tx
      .select()
      .from(vaultUnlockAssertions)
      .where(
        and(
          eq(vaultUnlockAssertions.id, input.challengeId),
          eq(vaultUnlockAssertions.accountId, scopeId),
          eq(vaultUnlockAssertions.userId, owner.userId),
          gt(vaultUnlockAssertions.expiresAt, now),
          isNull(vaultUnlockAssertions.consumedAt),
        ),
      )
      .for('update');

    if (
      !challenge ||
      challenge.authVersion !== owner.authVersion ||
      challenge.sessionHash !== unlockSessionHash(owner.sessionId)
    )
      fail('vault_assertion_unavailable', 'Try your passkey again.', 401);
    const credential = await activeUnlockCredential(tx, owner, challenge.credentialRecordId);

    if (input.response.id !== credential.credentialId || input.response.rawId !== credential.credentialId)
      fail('vault_assertion_unavailable', 'The passkey did not match.', 401);
    let verified;

    try {
      verified = await verifyAuthenticationResponse({
        response: {
          ...input.response,
          clientExtensionResults: {},
          response: { ...input.response.response, userHandle: input.response.response.userHandle ?? undefined },
        },
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.signCount,
        },
      });
    } catch {
      fail('vault_assertion_unavailable', 'The passkey could not be confirmed.', 401);
    }
    if (!verified.verified || verified.authenticationInfo.newCounter < credential.signCount)
      fail('vault_assertion_unavailable', 'The passkey could not be confirmed.', 401);
    await tx
      .update(accountPasskeyCredentials)
      .set({ signCount: verified.authenticationInfo.newCounter, lastUsedAt: now })
      .where(eq(accountPasskeyCredentials.id, credential.id));
    await tx
      .update(vaultUnlockAssertions)
      .set({
        consumedAt: now,
        verifiedAt: now,
        expiresAt: DateTime.fromJSDate(now).plus({ seconds: 60 }).toJSDate(),
        ...(challenge.purpose === 'unlock' ? { appliedAt: now } : {}),
      })
      .where(eq(vaultUnlockAssertions.id, challenge.id));

    if (challenge.purpose === 'enroll') return { purpose: 'enroll' as const, enrollmentProofId: challenge.id };
    const [method] = await tx
      .select()
      .from(vaultUnlockMethods)
      .where(
        and(
          eq(vaultUnlockMethods.id, challenge.methodId),
          eq(vaultUnlockMethods.accountId, scopeId),
          eq(vaultUnlockMethods.userId, owner.userId),
          eq(vaultUnlockMethods.credentialRecordId, credential.id),
          isNull(vaultUnlockMethods.revokedAt),
        ),
      );

    if (!method) fail('vault_method_unavailable', 'This method was removed. Use recovery.', 404);

    return { purpose: 'unlock' as const, envelope: prfKeyEnvelope.parse(method.envelope) };
  });
}
