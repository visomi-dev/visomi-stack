import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { env } from '../shared/env';

import {
  generateUserDeviceToken,
  generateVerificationPin,
  hashSecret,
  hashUserDeviceToken,
  verifySecret,
  verifyUserDeviceToken,
} from './auth-crypto';
import { sendVerificationMessage } from './auth-mail';
import { authUserSchema, challengeSchema } from './auth-schemas';

import {
  accountMemberships,
  accountPasskeyEnrollments,
  accounts,
  authVerificationChallenges,
  authEmailChallenges,
  db,
  HttpError,
  safeInsert,
  userDevices,
  users,
} from 'shared';

type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];
type AuthUser = z.infer<typeof authUserSchema>;
type AuthChallengePayload = z.infer<typeof challengeSchema>;
type ChallengeId = AuthChallengePayload['challengeId'];

const MAX_CHALLENGE_ATTEMPTS = 5;
const OTP_PURPOSE = 'bootstrap_recovery' as const;

type RestrictedIdentity = {
  accounts: Array<{ accountId: string; name: string; role: string }>;
  email: string;
  userId: string;
};
type EmailOtpDelivery = { flowId: string; resendAvailableAt: string };

export function clientContextHash(ip: string | undefined, userAgent: string | undefined): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`${ip ?? 'unknown'}\u0000${userAgent ?? 'unknown'}`)
    .digest('hex');
}

function hashPin(flowId: string, email: string, context: string, pin: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`${flowId}\u0000${email}\u0000${context}\u0000${pin}`)
    .digest('hex');
}

function pinMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');

  return left.length === right.length && timingSafeEqual(left, right);
}

function verificationFailed(): never {
  throw new HttpError({
    code: 'verification_failed',
    message: 'The verification request could not be completed.',
    statusCode: 401,
  });
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeAccountSlug(email: string) {
  return normalizeEmail(email)
    .split('@')[0]
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  return user;
}

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return user;
}

export async function findVerificationChallenge(id: string) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(eq(authVerificationChallenges.id, id))
    .limit(1);

  return challenge;
}

export async function getPrimaryMembership(userId: string) {
  const [membership] = await db
    .select()
    .from(accountMemberships)
    .where(eq(accountMemberships.userId, userId))
    .orderBy(asc(accountMemberships.createdAt))
    .limit(1);

  return membership;
}

export async function resolveAuthUser(user: typeof users.$inferSelect): Promise<AuthUser> {
  return resolveAuthUserForAccount(user);
}

export async function resolveAuthUserForAccount(
  user: typeof users.$inferSelect,
  accountId?: string,
): Promise<AuthUser> {
  const membership = accountId
    ? (
        await db
          .select()
          .from(accountMemberships)
          .where(and(eq(accountMemberships.userId, user.id), eq(accountMemberships.accountId, accountId)))
          .limit(1)
      )[0]
    : await getPrimaryMembership(user.id);

  if (!membership) {
    throw new HttpError({
      code: 'account_membership_missing',
      message: 'The account membership could not be found.',
      statusCode: 500,
    });
  }

  return {
    accountId: membership.accountId,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    id: user.id,
    role: membership.role,
  };
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

  await db.insert(authVerificationChallenges).values({
    attemptCount: 0,
    createdAt: now,
    email: normalizedEmail,
    expiresAt,
    id: challengeId,
    lastSentAt: now,
    pinHash: await hashSecret(pin),
    purpose: 'bootstrap_recovery',
    updatedAt: now,
    userId: null,
  });
  await sendVerificationMessage({ challengeId, email: normalizedEmail, expiresAt, pin, purpose: 'bootstrap_recovery' });

  return { challengeId, email: normalizedEmail, expiresAt: expiresAt.toISOString(), purpose: 'bootstrap_recovery' };
}

export async function createRecoveryChallenge(
  user: typeof users.$inferSelect,
  flowId: ChallengeId,
): Promise<AuthChallengePayload> {
  const challenge = await createChallenge(user, 'existing_account_recovery', flowId);

  return challenge;
}

export async function findOrCreateUserByEmail(email: string): Promise<typeof users.$inferSelect> {
  const normalizedEmail = normalizeEmail(email);
  const existing = await findUserByEmail(normalizedEmail);

  if (existing) return existing;

  const now = new Date();
  const inserted = (await safeInsert(
    () =>
      db
        .insert(users)
        .values({
          createdAt: now,
          email: normalizedEmail,
          id: randomUUID(),
          updatedAt: now,
        })
        .returning(),
    'users_email_idx',
    {
      code: 'email_already_registered',
      message: 'An account already exists for this email address.',
      statusCode: 409,
    },
  )) as Array<typeof users.$inferSelect>;

  const user = inserted[0];

  if (!user) {
    throw new HttpError({
      code: 'user_not_created',
      message: 'The account could not be created.',
      statusCode: 500,
    });
  }

  const accountId = randomUUID();
  const baseSlug = normalizeAccountSlug(normalizedEmail);
  const [existingAccount] = await db.select().from(accounts).where(eq(accounts.slug, baseSlug)).limit(1);
  const accountSlug = existingAccount ? `${baseSlug}-${accountId.slice(0, 8)}` : baseSlug;

  await safeInsert(
    () =>
      db.insert(accounts).values({
        createdAt: now,
        id: accountId,
        name: normalizedEmail.split('@')[0],
        ownerUserId: user.id,
        slug: accountSlug,
        updatedAt: now,
      }),
    'accounts_slug_idx',
    {
      code: 'account_slug_taken',
      message: 'An account with that slug already exists.',
      statusCode: 409,
    },
  );

  await safeInsert(
    () =>
      db.insert(accountMemberships).values({
        accountId,
        createdAt: now,
        id: randomUUID(),
        role: 'owner',
        updatedAt: now,
        userId: user.id,
      }),
    'account_memberships_account_user_idx',
    {
      code: 'membership_already_exists',
      message: 'The account membership already exists.',
      statusCode: 409,
    },
  );

  return user;
}

export async function listMembershipsForUser(userId: string) {
  const memberships = await db
    .select()
    .from(accountMemberships)
    .where(eq(accountMemberships.userId, userId))
    .orderBy(asc(accountMemberships.createdAt));

  return memberships;
}

export async function createPasskeyEnrollment(
  email: string,
  accountId: string,
  existingUser?: typeof users.$inferSelect,
) {
  const user = existingUser ?? (await findOrCreateUserByEmail(email));
  const [membership] = await db
    .select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.userId, user.id), eq(accountMemberships.accountId, accountId)))
    .limit(1);

  if (!membership) {
    throw new HttpError({
      code: 'account_membership_missing',
      message: 'The account membership could not be found.',
      statusCode: 500,
    });
  }

  const now = new Date();
  const enrollmentId = randomUUID();

  await db.insert(accountPasskeyEnrollments).values({
    activatedAt: null,
    accountId: membership.accountId,
    credentialId: null,
    createdAt: now,
    email: user.email,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    id: enrollmentId,
    status: 'pending',
    terminalAt: null,
    updatedAt: now,
    userId: user.id,
    verificationChallengeId: null,
  });

  return {
    enrollmentId,
    membership: { ...membership, accountId: membership.accountId, userId: user.id },
    user,
    verificationChallengeId: null,
  };
}

export async function createUserDevice(userId: string) {
  const token = generateUserDeviceToken();
  const now = new Date();

  await safeInsert(
    () =>
      db.insert(userDevices).values({
        createdAt: now,
        expiresAt: new Date(now.getTime() + env.REMEMBERED_DEVICE_MAX_AGE_MS),
        id: randomUUID(),
        tokenHash: hashUserDeviceToken(token),
        updatedAt: now,
        userId,
      }),
    'user_devices_token_hash_idx',
    {
      code: 'device_token_collision',
      message: 'A device with that token already exists.',
      statusCode: 409,
    },
  );

  return token;
}

export async function isRememberedDevice(userId: string, token: string | undefined) {
  if (!token) {
    return false;
  }

  const devices = await db
    .select()
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), gt(userDevices.expiresAt, new Date())));

  for (const device of devices) {
    if (verifyUserDeviceToken(token, device.tokenHash)) {
      await db
        .update(userDevices)
        .set({
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userDevices.id, device.id));

      return true;
    }
  }

  return false;
}

export async function resendChallenge(challengeId: string) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(eq(authVerificationChallenges.id, challengeId))
    .limit(1);

  if (!challenge) {
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

  if (!challenge) {
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

async function deliverEmailOtp(flowId: string, email: string, context: string): Promise<EmailOtpDelivery> {
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
      purpose: OTP_PURPOSE,
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
    await sendVerificationMessage({ challengeId: flowId, email, expiresAt, pin, purpose: OTP_PURPOSE });
  } catch {
    /* Do not disclose delivery failures. */
  }

  return { flowId, resendAvailableAt: new Date(now.getTime() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000).toISOString() };
}

export async function requestEmailOtp(
  email: string,
  context: string,
  flowId = randomUUID(),
): Promise<EmailOtpDelivery> {
  return deliverEmailOtp(flowId, normalizeEmail(email), context);
}

export async function resendEmailOtp(flowId: string, context: string): Promise<EmailOtpDelivery> {
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

  if (!challenge || challenge.clientContextHash !== context)
    return { flowId, resendAvailableAt: new Date(Date.now() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000).toISOString() };
  if (Date.now() < challenge.lastSentAt.getTime() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000)
    throw new HttpError({
      code: 'rate_limited',
      message: 'Wait before requesting another verification code.',
      statusCode: 429,
    });

  return deliverEmailOtp(flowId, challenge.normalizedEmail, context);
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
  )
    verificationFailed();
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

    if (!consumed) return null;
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
    let [user] = created
      ? [created]
      : await tx.select().from(users).where(eq(users.email, challenge.normalizedEmail)).limit(1);

    if (!user) throw new Error('Verified email identity could not be resolved.');
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

    return { accounts: memberships, email: user.email, userId: user.id };
  });

  if (!identity || !identity.accounts.length) verificationFailed();

  return identity;
}
