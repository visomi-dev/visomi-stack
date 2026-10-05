import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { env } from '../shared/env';

import { generateVerificationPin, hashSecret, verifySecret } from './auth-crypto';
import { sendVerificationMessage } from './auth-mail';
import { challengeSchema } from './auth-schemas';
import { findUserById, normalizeAccountSlug, normalizeEmail } from './auth-identity';
import { consumeEmailOtpDeliveryLimit } from './passkey-security';

import {
  accountMemberships,
  accounts,
  authVerificationChallenges,
  authEmailChallenges,
  authIdentityFlows,
  authOperationGrants,
  db,
  fail,
  HttpError,
  safeInsert,
  users,
} from 'shared';

type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];
export type AuthChallengePayload = z.infer<typeof challengeSchema>;
type ChallengeId = AuthChallengePayload['challengeId'];

export const MAX_CHALLENGE_ATTEMPTS = 5;
const OTP_PURPOSE = 'bootstrap_recovery' as const;

export function flowHash(email: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(normalizeEmail(email)).digest('hex');
}

type RestrictedIdentity = {
  authVersion: number;
  accounts: Array<{ accountId: string; name: string; role: string }>;
  email: string;
  isNewUser: boolean;
  userId: string;
};
type EmailOtpDelivery = { flowId: string; resendAvailableAt: string };

export function clientContextHash(ip: string | undefined, userAgent: string | undefined): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`${ip ?? 'unknown'}\u0000${userAgent ?? 'unknown'}`)
    .digest('hex');
}

export function hashPin(flowId: string, email: string, context: string, pin: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`${flowId}\u0000${email}\u0000${context}\u0000${pin}`)
    .digest('hex');
}

export function pinMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');

  return left.length === right.length && timingSafeEqual(left, right);
}

export function verificationFailed(): never {
  fail('verification_failed', 'The verification request could not be completed.', 401);
}

export async function findVerificationChallenge(id: string) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(eq(authVerificationChallenges.id, id))
    .limit(1);

  return challenge?.purpose === 'email_change' ? undefined : challenge;
}

export async function createChallenge(
  user: typeof users.$inferSelect,
  purpose: VerificationPurpose = 'bootstrap_recovery',
  challengeId: ChallengeId = randomUUID(),
): Promise<AuthChallengePayload> {
  const pin = generateVerificationPin();

  const now = new Date();

  const expiresAt = new Date(now.getTime() + env.PIN_EXPIRY_MINUTES * 60 * 1000);

  await db
    .update(authVerificationChallenges)
    .set({
      consumedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(authVerificationChallenges.userId, user.id),
        eq(authVerificationChallenges.purpose, purpose),
        isNull(authVerificationChallenges.consumedAt),
      ),
    );

  const pinHash = await hashSecret(pin);

  await safeInsert(
    () =>
      db.insert(authVerificationChallenges).values({
        attemptCount: 0,
        createdAt: now,
        email: user.email,
        expiresAt,
        id: challengeId,
        lastSentAt: now,
        pinHash,
        purpose,
        updatedAt: now,
        userId: user.id,
      }),
    'auth_verification_challenges_pkey',
    {
      code: 'challenge_already_exists',
      message: 'A verification challenge with that id already exists.',
      statusCode: 409,
    },
  );

  await sendVerificationMessage({
    challengeId,
    email: user.email,
    expiresAt,
    pin,
    purpose,
  });

  return {
    challengeId,
    email: user.email,
    expiresAt: expiresAt.toISOString(),
    purpose,
  };
}

export async function createEmailChallenge(email: string): Promise<AuthChallengePayload> {
  const normalizedEmail = normalizeEmail(email);
  const pin = generateVerificationPin();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.PIN_EXPIRY_MINUTES * 60 * 1000);
  const challengeId = randomUUID();

  const pinHash = await hashSecret(pin);

  await db.insert(authVerificationChallenges).values({
    attemptCount: 0,
    createdAt: now,
    email: normalizedEmail,
    expiresAt,
    id: challengeId,
    lastSentAt: now,
    pinHash,
    purpose: 'bootstrap_recovery',
    updatedAt: now,
    userId: null,
  });
  await sendVerificationMessage({ challengeId, email: normalizedEmail, expiresAt, pin, purpose: 'bootstrap_recovery' });

  return { challengeId, email: normalizedEmail, expiresAt: expiresAt.toISOString(), purpose: 'bootstrap_recovery' };
}

export async function resendChallenge(challengeId: string) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(eq(authVerificationChallenges.id, challengeId))
    .limit(1);

  if (!challenge || challenge.purpose === 'email_change') {
    throw new HttpError({
      code: 'challenge_not_found',
      message: 'The verification request could not be found.',
      statusCode: 404,
    });
  }

  if (challenge.consumedAt) {
    throw new HttpError({
      code: 'challenge_consumed',
      message: 'This verification request has already been completed.',
      statusCode: 409,
    });
  }

  const nextAllowedAt = challenge.lastSentAt.getTime() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000;

  if (Date.now() < nextAllowedAt) {
    throw new HttpError({
      code: 'challenge_cooldown',
      message: 'Wait before requesting another verification code.',
      statusCode: 429,
    });
  }

  if (challenge.userId) {
    const user = await findUserById(challenge.userId);

    if (!user) {
      throw new HttpError({
        code: 'user_not_found',
        message: 'The verification request is no longer valid.',
        statusCode: 404,
      });
    }

    return createChallenge(user, challenge.purpose as VerificationPurpose);
  }

  return createEmailChallenge(challenge.email);
}

export async function consumeChallenge(challengeId: string, pin: string) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(eq(authVerificationChallenges.id, challengeId))
    .limit(1);

  if (!challenge || challenge.purpose === 'email_change') {
    throw new HttpError({
      code: 'challenge_not_found',
      message: 'The verification request could not be found.',
      statusCode: 404,
    });
  }

  if (challenge.consumedAt) {
    throw new HttpError({
      code: 'challenge_consumed',
      message: 'This verification request has already been completed.',
      statusCode: 409,
    });
  }

  if (challenge.expiresAt <= new Date()) {
    throw new HttpError({
      code: 'challenge_expired',
      message: 'This verification code has expired.',
      statusCode: 410,
    });
  }

  if (challenge.attemptCount >= MAX_CHALLENGE_ATTEMPTS) {
    throw new HttpError({
      code: 'challenge_attempt_limit',
      message: 'Too many invalid verification attempts.',
      statusCode: 429,
    });
  }

  const isValid = await verifySecret(pin, challenge.pinHash);

  if (!isValid) {
    await db
      .update(authVerificationChallenges)
      .set({
        attemptCount: challenge.attemptCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(authVerificationChallenges.id, challenge.id));

    throw new HttpError({
      code: 'invalid_verification_code',
      message: 'The verification code is invalid.',
      statusCode: 401,
    });
  }

  return challenge;
}

export async function markChallengeConsumed(challengeId: string) {
  const now = new Date();

  const [consumed] = await db
    .update(authVerificationChallenges)
    .set({ consumedAt: now, updatedAt: now })
    .where(and(eq(authVerificationChallenges.id, challengeId), isNull(authVerificationChallenges.consumedAt)))
    .returning();

  if (!consumed) {
    throw new HttpError({
      code: 'challenge_consumed',
      message: 'This verification request has already been completed.',
      statusCode: 409,
    });
  }

  return consumed;
}

export async function getLatestChallengeForUser(userId: string) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(
      and(
        eq(authVerificationChallenges.userId, userId),
        eq(authVerificationChallenges.purpose, 'bootstrap_recovery' as const),
        isNull(authVerificationChallenges.consumedAt),
        gt(authVerificationChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authVerificationChallenges.createdAt))
    .limit(1);

  return challenge;
}

async function deliverEmailOtp(
  flowId: string,
  email: string,
  context: string,
  purpose: VerificationPurpose = OTP_PURPOSE,
  ip?: string,
): Promise<EmailOtpDelivery> {
  await requireEmailDelivery(email, ip);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.PIN_EXPIRY_MINUTES * 60_000);
  const pin = generateVerificationPin();

  await db.transaction(async (tx) => {
    await tx
      .update(authEmailChallenges)
      .set({ supersededAt: now, updatedAt: now })
      .where(
        and(
          eq(authEmailChallenges.flowId, flowId),
          isNull(authEmailChallenges.consumedAt),
          isNull(authEmailChallenges.supersededAt),
        ),
      );
    await tx.insert(authEmailChallenges).values({
      id: randomUUID(),
      flowId,
      normalizedEmail: email,
      purpose,
      pinHash: hashPin(flowId, email, context, pin),
      clientContextHash: context,
      expiresAt,
      consumedAt: null,
      supersededAt: null,
      attemptCount: 0,
      lastSentAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
  try {
    await sendVerificationMessage({ challengeId: flowId, email, expiresAt, pin, purpose });
  } catch {
    /* Do not disclose delivery failures. */
  }

  return { flowId, resendAvailableAt: new Date(now.getTime() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000).toISOString() };
}

export async function requestEmailOtp(
  email: string,
  context: string,
  flowId = randomUUID(),
  purpose: VerificationPurpose = OTP_PURPOSE,
  ip?: string,
): Promise<EmailOtpDelivery> {
  return deliverEmailOtp(flowId, normalizeEmail(email), context, purpose, ip);
}

export async function requireEmailDelivery(email: string, ip?: string): Promise<void> {
  const limit = await consumeEmailOtpDeliveryLimit(ip, email, true);

  if (!limit.allowed) {
    throw new HttpError({
      code: 'rate_limited',
      message: 'Wait before requesting another verification code.',
      statusCode: 429,
      data: { retryAfter: limit.retryAfter },
    });
  }
}

export async function resendEmailOtp(flowId: string, context: string, ip?: string): Promise<EmailOtpDelivery> {
  const [challenge] = await db
    .select()
    .from(authEmailChallenges)
    .where(
      and(
        eq(authEmailChallenges.flowId, flowId),
        isNull(authEmailChallenges.consumedAt),
        isNull(authEmailChallenges.supersededAt),
      ),
    )
    .limit(1);

  if (!challenge || challenge.clientContextHash !== context) {
    return { flowId, resendAvailableAt: new Date(Date.now() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000).toISOString() };
  }
  if (Date.now() < challenge.lastSentAt.getTime() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000) {
    throw new HttpError({
      code: 'rate_limited',
      message: 'Wait before requesting another verification code.',
      statusCode: 429,
    });
  }

  if (challenge.purpose.startsWith('password_')) {
    const [flow] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flowId));

    if (!flow || flow.expiresAt <= new Date() || flow.completedAt || flow.terminalAt) {
      verificationFailed();
    }
  }

  return deliverEmailOtp(flowId, challenge.normalizedEmail, context, challenge.purpose as VerificationPurpose, ip);
}

export async function createOperationGrant(userId: string, purpose: string, sessionBinding: string): Promise<string> {
  const id = randomUUID();

  await db.insert(authOperationGrants).values({
    id,
    userId,
    purpose,
    sessionBinding,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    createdAt: new Date(),
  });

  return id;
}

export async function verifyEmailOtp(flowId: string, pin: string, context: string): Promise<RestrictedIdentity> {
  const [challenge] = await db
    .select()
    .from(authEmailChallenges)
    .where(
      and(
        eq(authEmailChallenges.flowId, flowId),
        isNull(authEmailChallenges.consumedAt),
        isNull(authEmailChallenges.supersededAt),
      ),
    )
    .limit(1);

  if (
    !challenge ||
    challenge.clientContextHash !== context ||
    challenge.expiresAt <= new Date() ||
    challenge.attemptCount >= MAX_CHALLENGE_ATTEMPTS
  ) {
    verificationFailed();
  }
  if (!pinMatches(challenge.pinHash, hashPin(flowId, challenge.normalizedEmail, context, pin))) {
    await db
      .update(authEmailChallenges)
      .set({ attemptCount: sql`${authEmailChallenges.attemptCount} + 1`, updatedAt: new Date() })
      .where(
        and(eq(authEmailChallenges.id, challenge.id), lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS)),
      );
    verificationFailed();
  }
  const identity = await db.transaction(async (tx) => {
    const now = new Date();
    const [consumed] = await tx
      .update(authEmailChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(authEmailChallenges.id, challenge.id),
          eq(authEmailChallenges.clientContextHash, context),
          isNull(authEmailChallenges.consumedAt),
          isNull(authEmailChallenges.supersededAt),
          gt(authEmailChallenges.expiresAt, now),
          lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS),
        ),
      )
      .returning();

    if (!consumed) {
      return null;
    }
    const [created] = await tx
      .insert(users)
      .values({
        id: randomUUID(),
        email: challenge.normalizedEmail,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();
    let user = created;

    if (!user) {
      const [existingUser] = await tx.select().from(users).where(eq(users.email, challenge.normalizedEmail)).limit(1);

      user = existingUser;
    }

    if (!user) {
      throw new Error('Verified email identity could not be resolved.');
    }
    if (!user.emailVerifiedAt) {
      const [verifiedUser] = await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)))
        .returning();

      user = verifiedUser ?? user;
    }
    if (created) {
      const accountId = randomUUID();

      await tx.insert(accounts).values({
        id: accountId,
        name: challenge.normalizedEmail.split('@')[0] || 'Personal account',
        slug: `${normalizeAccountSlug(challenge.normalizedEmail)}-${accountId.slice(0, 8)}`,
        ownerUserId: user.id,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .insert(accountMemberships)
        .values({ id: randomUUID(), accountId, userId: user.id, role: 'owner', createdAt: now, updatedAt: now });
    }
    const memberships = await tx
      .select({ accountId: accountMemberships.accountId, name: accounts.name, role: accountMemberships.role })
      .from(accountMemberships)
      .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
      .where(eq(accountMemberships.userId, user.id))
      .orderBy(asc(accountMemberships.createdAt));

    return {
      accounts: memberships,
      email: user.email,
      isNewUser: Boolean(created),
      userId: user.id,
      authVersion: user.authVersion,
    };
  });

  if (!identity || !identity.accounts.length) {
    verificationFailed();
  }

  return identity;
}
