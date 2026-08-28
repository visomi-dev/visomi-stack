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
  accountPasskeyCredentials,
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

export async function getLatestChallengeForUser(userId: string, purpose: VerificationPurpose) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(
      and(
        eq(authVerificationChallenges.userId, userId),
        eq(authVerificationChallenges.purpose, purpose),
        isNull(authVerificationChallenges.consumedAt),
        gt(authVerificationChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authVerificationChallenges.createdAt))
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
  const membership = await getPrimaryMembership(user.id);

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
  purpose: VerificationPurpose,
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

export async function getOrCreateActiveChallenge(user: typeof users.$inferSelect, purpose: VerificationPurpose) {
  const challenge = await getLatestChallengeForUser(user.id, purpose);

  if (challenge) {
    return {
      challengeId: challenge.id,
      email: user.email,
      expiresAt: challenge.expiresAt.toISOString(),
      purpose: challenge.purpose as VerificationPurpose,
    };
  }

  return createChallenge(user, purpose);
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

export async function beginSignIn(user: typeof users.$inferSelect, rememberedDeviceToken?: string) {
  if (!user.emailVerifiedAt) {
    return getOrCreateActiveChallenge(user, 'sign_up');
  }

  const rememberDevice = await isRememberedDevice(user.id, rememberedDeviceToken);

  if (rememberDevice) {
    return null;
  }

  // Always generate a fresh verification challenge to ensure a fresh email code is sent
  // and any previous unconsumed sign-in challenges are invalidated.
  return createChallenge(user, 'sign_in');
}

export async function signUp(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);

  const existingUser = await findUserByEmail(normalizedEmail);

  if (existingUser) {
    throw new HttpError({
      code: 'email_already_registered',
      message: 'An account already exists for this email address.',
      statusCode: 409,
    });
  }

  const now = new Date();

  const passwordHash = await hashSecret(password);

  const [user] = (await safeInsert(
    () =>
      db
        .insert(users)
        .values({
          createdAt: now,
          email: normalizedEmail,
          id: randomUUID(),
          passwordHash,
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

  return createChallenge(user, 'sign_up');
}

export async function createPasskeyEnrollment(email: string, _label: string, existingUser?: typeof users.$inferSelect) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  const passwordHash = null;
  const createdUsers = existingUser
    ? []
    : ((await safeInsert(
        () =>
          db
            .insert(users)
            .values({ createdAt: now, email: normalizedEmail, id: randomUUID(), passwordHash, updatedAt: now })
            .returning(),
        'users_email_idx',
        {
          code: 'email_already_registered',
          message: 'An account already exists for this email address.',
          statusCode: 409,
        },
      )) as Array<typeof users.$inferSelect>);
  const user = existingUser ?? createdUsers[0];
  const accountId = randomUUID();

  await db.insert(accounts).values({
    createdAt: now,
    id: accountId,
    name: normalizedEmail.split('@')[0],
    ownerUserId: user.id,
    slug: `${normalizeAccountSlug(normalizedEmail)}-${accountId.slice(0, 8)}`,
    updatedAt: now,
  });
  const membership = (
    await db
      .insert(accountMemberships)
      .values({ accountId, createdAt: now, id: randomUUID(), role: 'owner', updatedAt: now, userId: user.id })
      .returning()
  )[0];
  const verification = await createChallenge(user, 'sign_up');
  const enrollmentId = randomUUID();

  await db.insert(accountPasskeyEnrollments).values({
    id: enrollmentId,
    accountId,
    userId: user.id,
    email: normalizedEmail,
    credentialId: null,
    status: 'pending',
    verificationChallengeId: verification.challengeId,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    activatedAt: null,
    terminalAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return { user, membership, enrollmentId, verificationChallengeId: verification.challengeId };
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

export async function verifyChallenge(challengeId: string, pin: string, purpose: VerificationPurpose) {
  const [challenge] = await db
    .select()
    .from(authVerificationChallenges)
    .where(eq(authVerificationChallenges.id, challengeId))
    .limit(1);

  if (!challenge || challenge.purpose !== purpose) {
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

  const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);

  if (!user) {
    throw new HttpError({
      code: 'user_not_found',
      message: 'The account could not be found.',
      statusCode: 404,
    });
  }

  const now = new Date();

  let nextUser = user;

  if (purpose === 'sign_up' && !user.emailVerifiedAt) {
    // Email activation and the pending passkey linkage must share one
    // persistence boundary. A failure in any statement rolls back the
    // consumed verification challenge and leaves the account unverified.
    nextUser = await db.transaction(async (tx) => {
      const [updatedUser] = await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, user.id))
        .returning();

      if (!updatedUser) throw new Error('Account activation update returned no user.');

      const [enrollment] = await tx
        .select()
        .from(accountPasskeyEnrollments)
        .where(eq(accountPasskeyEnrollments.verificationChallengeId, challenge.id))
        .limit(1);

      if (enrollment && (enrollment.status !== 'pending' || !enrollment.credentialId)) {
        throw new Error('Pending passkey enrollment is not activatable.');
      }

      if (enrollment?.status === 'pending' && enrollment.credentialId) {
        const [activatedEnrollment] = await tx
          .update(accountPasskeyEnrollments)
          .set({ status: 'active', activatedAt: now, updatedAt: now })
          .where(and(eq(accountPasskeyEnrollments.id, enrollment.id), eq(accountPasskeyEnrollments.status, 'pending')))
          .returning();

        if (!activatedEnrollment) throw new Error('Pending enrollment activation failed.');

        const [credential] = await tx
          .update(accountPasskeyCredentials)
          .set({ updatedAt: now })
          .where(
            and(
              eq(accountPasskeyCredentials.credentialId, enrollment.credentialId),
              eq(accountPasskeyCredentials.accountId, enrollment.accountId),
              eq(accountPasskeyCredentials.userId, enrollment.userId),
              isNull(accountPasskeyCredentials.revokedAt),
            ),
          )
          .returning();

        if (!credential) throw new Error('Pending passkey credential activation failed.');
      }

      const [consumedChallenge] = await tx
        .update(authVerificationChallenges)
        .set({ consumedAt: now, updatedAt: now })
        .where(and(eq(authVerificationChallenges.id, challenge.id), isNull(authVerificationChallenges.consumedAt)))
        .returning();

      if (!consumedChallenge) throw new Error('Verification challenge consumption failed.');

      return updatedUser;
    });
  } else {
    const [consumedChallenge] = await db
      .update(authVerificationChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(and(eq(authVerificationChallenges.id, challenge.id), isNull(authVerificationChallenges.consumedAt)))
      .returning();

    if (!consumedChallenge) throw new Error('Verification challenge consumption failed.');
  }

  return resolveAuthUser(nextUser);
}

export async function verifyPassword(email: string, password: string) {
  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  const matches = user.passwordHash ? await verifySecret(password, user.passwordHash) : false;

  return matches ? user : null;
}

export async function requestPasswordReset(email: string) {
  const user = await findUserByEmail(email);

  if (!user || !user.emailVerifiedAt) {
    return null;
  }

  return createChallenge(user, 'password_reset');
}

export async function submitPasswordReset(userId: string, newPassword: string) {
  const user = await findUserById(userId);

  if (!user) {
    throw new HttpError({
      code: 'user_not_found',
      message: 'The account could not be found.',
      statusCode: 404,
    });
  }

  const now = new Date();

  await db
    .update(users)
    .set({
      passwordHash: await hashSecret(newPassword),
      passwordConfigured: true,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  await db.update(userDevices).set({ expiresAt: now, updatedAt: now }).where(eq(userDevices.userId, user.id));
}
