import { randomUUID } from 'node:crypto';

import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Router } from 'express';
import type { Request } from 'express';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { consumeChallenge, createEmailChallenge, findUserByEmail } from './auth-service';
import { consumeEmailOtpDeliveryLimit } from './passkey-security';
import { APP_NAME } from './auth-brand';
import { passkeySignupBeginSchema, passkeySignupVerifySchema, registrationCompleteSchema } from './passkey-schemas';

import {
  accountMemberships,
  accountPasskeyCredentials,
  accounts,
  authVerificationChallenges,
  db,
  HttpError,
  users,
} from 'shared';

const rpID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
const expectedOrigin = process.env.WEBAUTHN_ORIGIN ?? new URL(env.APP_BASE_URL).origin;
const ttl = 15 * 60_000;

function pendingSignup(req: Request) {
  const pending = req.session.passkeySignup;

  if (!pending || pending.expiresAt <= Date.now()) {
    throw new HttpError({ code: 'signup_expired', message: 'Start passkey signup again.', statusCode: 410 });
  }

  return pending;
}

async function saveSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

export const passkeySignupRouter = Router();

passkeySignupRouter.post('/begin', validateRequest({ body: passkeySignupBeginSchema }), async (req, res) => {
  const { email } = getValidated<{ body: typeof passkeySignupBeginSchema }>(req).body!;
  const normalizedEmail = email.trim().toLowerCase();

  if (await findUserByEmail(normalizedEmail)) {
    throw new HttpError({
      code: 'email_already_registered',
      message: 'An account already exists. Sign in or recover your account.',
      statusCode: 409,
    });
  }
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  const userId = randomUUID();
  const options = await generateRegistrationOptions({
    rpName: APP_NAME,
    rpID,
    userName: normalizedEmail,
    userID: Buffer.from(userId),
    attestationType: 'none',
    timeout: 60_000,
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
  });

  req.session.passkeySignup = {
    id: randomUUID(),
    userId,
    email: normalizedEmail,
    challenge: options.challenge,
    expiresAt: Date.now() + ttl,
  };
  await saveSession(req);
  res.json({ data: { challengeId: req.session.passkeySignup.id, options } });
});

passkeySignupRouter.post('/complete', validateRequest({ body: registrationCompleteSchema }), async (req, res) => {
  const pending = pendingSignup(req);
  const body = getValidated<{ body: typeof registrationCompleteSchema }>(req).body!;

  if (body.challengeId !== pending.id || pending.credential) {
    throw new HttpError({ code: 'challenge_mismatch', message: 'Start passkey signup again.', statusCode: 409 });
  }
  let verified;

  try {
    verified = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: pending.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    throw new HttpError({
      code: 'passkey_invalid',
      message: 'We could not verify the passkey. Try again.',
      statusCode: 400,
    });
  }
  if (!verified.verified || !verified.registrationInfo) {
    throw new HttpError({ code: 'passkey_invalid', message: 'We could not verify the passkey.', statusCode: 400 });
  }
  const { credential, credentialBackedUp, credentialDeviceType } = verified.registrationInfo;
  const delivery = consumeEmailOtpDeliveryLimit(req.ip, pending.email, true);

  if (!delivery.allowed) {
    res.setHeader('Retry-After', delivery.retryAfter);
    throw new HttpError({
      code: 'rate_limited',
      message: 'Too many requests; retry after the cooldown.',
      statusCode: 429,
    });
  }
  const challenge = await createEmailChallenge(pending.email);

  pending.credential = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
    backupEligible: credentialDeviceType === 'multiDevice',
    backupState: credentialBackedUp,
  };
  pending.emailChallengeId = challenge.challengeId;
  await saveSession(req);
  res.status(202).json({ data: { email: pending.email } });
});

passkeySignupRouter.post('/verify', validateRequest({ body: passkeySignupVerifySchema }), async (req, res) => {
  const pending = pendingSignup(req);
  const { code } = getValidated<{ body: typeof passkeySignupVerifySchema }>(req).body!;
  const credential = pending.credential;

  if (!credential || !pending.emailChallengeId) {
    throw new HttpError({ code: 'passkey_required', message: 'Create your passkey first.', statusCode: 409 });
  }
  const challenge = await consumeChallenge(pending.emailChallengeId, code);

  if (challenge.email !== pending.email || challenge.purpose !== 'bootstrap_recovery') {
    throw new HttpError({ code: 'challenge_mismatch', message: 'Start passkey signup again.', statusCode: 409 });
  }
  if (await findUserByEmail(pending.email)) {
    throw new HttpError({
      code: 'email_already_registered',
      message: 'An account already exists. Sign in or recover your account.',
      statusCode: 409,
    });
  }
  const now = new Date();
  const accountId = randomUUID();

  await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(authVerificationChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(authVerificationChallenges.id, challenge.id),
          isNull(authVerificationChallenges.consumedAt),
          gt(authVerificationChallenges.expiresAt, now),
        ),
      )
      .returning();

    if (!consumed)
      throw new HttpError({
        code: 'challenge_consumed',
        message: 'This verification has already been completed.',
        statusCode: 409,
      });
    await tx.insert(users).values({ id: pending.userId, email: pending.email, emailVerifiedAt: now });
    await tx
      .insert(accounts)
      .values({ id: accountId, name: pending.email.split('@')[0]!, slug: accountId, ownerUserId: pending.userId });
    await tx.insert(accountMemberships).values({ id: randomUUID(), accountId, userId: pending.userId, role: 'owner' });
    await tx.insert(accountPasskeyCredentials).values({
      id: randomUUID(),
      accountId,
      userId: pending.userId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      rpId: rpID,
      label: 'Primary passkey',
      transports: credential.transports,
      signCount: credential.counter,
      backupEligible: credential.backupEligible,
      backupState: credential.backupState,
      status: 'active',
      activatedAt: now,
    });
  });
  delete req.session.passkeySignup;
  await saveSession(req);
  res.status(201).json({ data: { verified: true } });
});
