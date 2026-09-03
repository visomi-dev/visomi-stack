import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
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
  db,
  HttpError,
  safeInsert,
  userDevices,
  users,
} from 'shared';

type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];
type AuthUser = z.infer<typeof authUserSchema>;
type AuthChallengePayload = z.infer<typeof challengeSchema>;

const MAX_CHALLENGE_ATTEMPTS = 5;

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
): Promise<AuthChallengePayload> {
  const pin = generateVerificationPin();

  const now = new Date();

  const expiresAt = new Date(now.getTime() + env.PIN_EXPIRY_MINUTES * 60 * 1000);

  const challengeId = randomUUID();

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

export async function createPasskeyEnrollment(email: string, _label: string, existingUser?: typeof users.$inferSelect) {
  const user = existingUser ?? (await findOrCreateUserByEmail(email));
  const membership = (await getPrimaryMembership(user.id)) ?? {
    accountId: '',
    createdAt: new Date(),
    id: '',
    role: 'owner',
    updatedAt: new Date(),
    userId: user.id,
  };

  if (!membership.accountId) {
    throw new HttpError({
      code: 'account_membership_missing',
      message: 'The account membership could not be found.',
      statusCode: 500,
    });
  }

  const now = new Date();
  const verification = await createChallenge(user, 'bootstrap_recovery');
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
    verificationChallengeId: verification.challengeId,
  });

  return {
    enrollmentId,
    membership: { ...membership, accountId: membership.accountId, userId: user.id },
    user,
    verificationChallengeId: verification.challengeId,
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
