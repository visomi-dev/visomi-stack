import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

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
  isLegacySecretHash,
} from './auth-crypto';
import { sendVerificationMessage } from './auth-mail';
import { authUserSchema, challengeSchema } from './auth-schemas';
import { decryptTotpSecret, totpTimeStep, verifyTotpCode } from './totp';
import { assertPasswordAuthenticationAvailable, hashPassword, verifyPassword } from './password';

import {
  accountMemberships,
  accountPasskeyEnrollments,
  accounts,
  authVerificationChallenges,
  authEmailChallenges,
  authIdentityFlows,
  userTotpEnrollments,
  userRecoveryCodes,
  authOperationGrants,
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
const PASSWORD_OTP_PURPOSE = 'password_second_step' as const;
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(32)}`;

function flowHash(email: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(normalizeEmail(email)).digest('hex');
}

type RestrictedIdentity = {
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

async function deliverEmailOtp(
  flowId: string,
  email: string,
  context: string,
  purpose: VerificationPurpose = OTP_PURPOSE,
): Promise<EmailOtpDelivery> {
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
): Promise<EmailOtpDelivery> {
  return deliverEmailOtp(flowId, normalizeEmail(email), context, purpose);
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

  return deliverEmailOtp(flowId, challenge.normalizedEmail, context, challenge.purpose as VerificationPurpose);
}

export async function startPasswordSignIn(email: string, password: string, context: string, sessionBinding: string) {
  const normalizedEmail = normalizeEmail(email);
  const user = await findUserByEmail(normalizedEmail);
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !user.passwordHash || !passwordMatches) verificationFailed();
  if (!user.emailVerifiedAt)
    throw new HttpError({
      code: 'email_unverified',
      message: 'Verify your email address before signing in.',
      statusCode: 403,
    });

  if (user.passwordHash && isLegacySecretHash(user.passwordHash)) {
    const upgradedHash = await hashPassword(password);

    await db
      .update(users)
      .set({ passwordHash: upgradedHash, updatedAt: new Date() })
      .where(
        and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash), eq(users.authVersion, user.authVersion)),
      );
  }

  const memberships = await listMembershipsForUser(user.id);

  if (!memberships.length) verificationFailed();

  const [activeTotp] = await db
    .select()
    .from(userTotpEnrollments)
    .where(and(eq(userTotpEnrollments.userId, user.id), eq(userTotpEnrollments.status, 'active')))
    .limit(1);
  const requiredFactor = activeTotp ? 'totp' : 'email';
  const now = new Date();
  const flowId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);

  await db.insert(authIdentityFlows).values({
    id: flowId,
    state: 'password_pending_email',
    intent: 'sign_in',
    expiresAt,
    sessionBinding,
    emailHash: flowHash(normalizedEmail),
    userId: user.id,
    accountId: memberships[0]?.accountId,
    authorizationMethod: 'password',
    passwordProofAt: now,
    requiredFactor,
    userAuthVersion: user.authVersion,
    factorEnrollmentId: activeTotp?.id,
    factorEnrollmentVersion: activeTotp ? user.authVersion : null,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const delivery = activeTotp
    ? undefined
    : await requestEmailOtp(normalizedEmail, context, flowId, PASSWORD_OTP_PURPOSE);

  return {
    flowId,
    requiredFactor,
    expiresAt: expiresAt.toISOString(),
    ...(delivery ? { resendAvailableAt: delivery.resendAvailableAt } : {}),
    maskedEmail: `${normalizedEmail.slice(0, 1)}***@${normalizedEmail.split('@')[1]}`,
  };
}

export async function startPasswordSignUp(email: string, password: string, context: string, sessionBinding: string) {
  assertPasswordAuthenticationAvailable();
  const normalizedEmail = normalizeEmail(email);

  if (await findUserByEmail(normalizedEmail)) {
    throw new HttpError({
      code: 'email_already_registered',
      message: 'This email address is already registered.',
      statusCode: 409,
    });
  }
  const now = new Date();
  const flowId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);

  await db.insert(authIdentityFlows).values({
    id: flowId,
    state: 'password_pending_email',
    intent: 'password_signup',
    expiresAt,
    sessionBinding,
    emailHash: flowHash(normalizedEmail),
    pendingPasswordHash: await hashPassword(password),
    pendingEmail: normalizedEmail,
    requiredFactor: 'email',
    createdAt: now,
    updatedAt: now,
  });
  const delivery = await requestEmailOtp(normalizedEmail, context, flowId, 'password_signup');

  return { flowId, expiresAt: expiresAt.toISOString(), resendAvailableAt: delivery.resendAvailableAt };
}

export async function verifyPasswordSignUp(flowId: string, pin: string, context: string, sessionBinding: string) {
  const flow = await consumePasswordEmailOtp(flowId, pin, context, sessionBinding, 'password_signup');

  if (!flow.pendingPasswordHash || flow.intent !== 'password_signup') verificationFailed();
  const now = new Date();
  const identity = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        id: randomUUID(),
        email: flow.pendingEmail ?? '',
        passwordHash: flow.pendingPasswordHash,
        emailVerifiedAt: now,
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (!user) verificationFailed();
    const accountId = randomUUID();

    await tx.insert(accounts).values({
      id: accountId,
      name: user.email.split('@')[0] || 'Personal account',
      slug: `${normalizeAccountSlug(user.email)}-${accountId.slice(0, 8)}`,
      ownerUserId: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(accountMemberships).values({
      id: randomUUID(),
      accountId,
      userId: user.id,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(authIdentityFlows)
      .set({
        userId: user.id,
        accountId,
        state: 'complete',
        completedAt: now,
        pendingPasswordHash: null,
        pendingEmail: null,
        updatedAt: now,
      })
      .where(eq(authIdentityFlows.id, flow.id));

    return {
      accounts: [{ accountId, name: user.email.split('@')[0] || 'Personal account', role: 'owner' }],
      email: user.email,
      isNewUser: true,
      userId: user.id,
    };
  });

  return identity;
}

export async function startPasswordReset(email: string, context: string, sessionBinding: string) {
  assertPasswordAuthenticationAvailable();
  const normalizedEmail = normalizeEmail(email);
  const user = await findUserByEmail(normalizedEmail);
  const flowId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  let requiredFactor: 'email' | 'totp' = 'email';
  let factorEnrollmentId: string | null = null;

  if (user) {
    const [totp] = await db
      .select()
      .from(userTotpEnrollments)
      .where(and(eq(userTotpEnrollments.userId, user.id), eq(userTotpEnrollments.status, 'active')))
      .limit(1);

    requiredFactor = totp ? 'totp' : 'email';
    factorEnrollmentId = totp?.id ?? null;
  }
  await db.insert(authIdentityFlows).values({
    id: flowId,
    state: 'password_reset_pending_email',
    intent: 'password_reset',
    expiresAt,
    sessionBinding,
    emailHash: flowHash(normalizedEmail),
    userId: user?.id,
    accountId: (await (user ? getPrimaryMembership(user.id) : undefined))?.accountId,
    requiredFactor,
    factorEnrollmentId,
    userAuthVersion: user?.authVersion,
    createdAt: now,
    updatedAt: now,
  });
  if (user) await requestEmailOtp(normalizedEmail, context, flowId, 'password_reset');

  return {
    flowId,
    requiredFactor: requiredFactor === 'totp' ? 'totp_or_recovery' : 'email',
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completePasswordReset(
  flowId: string,
  emailCode: string,
  factor: { kind: 'totp' | 'recovery_code'; code: string } | undefined,
  password: string,
  context: string,
  sessionBinding: string,
) {
  const flow = await getPasswordFlow(flowId, sessionBinding, 'password_reset_pending_email');
  const user = await findUserById(flow.userId ?? '');

  if (!user || flow.userAuthVersion === null || user.authVersion !== flow.userAuthVersion) verificationFailed();
  const [totp] = await db
    .select()
    .from(userTotpEnrollments)
    .where(
      and(
        eq(userTotpEnrollments.userId, user.id),
        eq(userTotpEnrollments.status, 'active'),
        eq(userTotpEnrollments.id, flow.factorEnrollmentId ?? ''),
      ),
    )
    .limit(1);

  if (flow.requiredFactor === 'totp' && !totp) verificationFailed();
  if (totp) {
    if (!factor) verificationFailed();
    if (factor.kind === 'recovery_code') {
      if (!(await consumeRecoveryCode(user.id, factor.code))) verificationFailed();
    } else {
      let valid: boolean;

      try {
        valid = await verifyTotpCode(decryptTotpSecret(totp.encryptedSecret, totp.keyVersion), factor.code);
      } catch {
        valid = false;
      }
      if (!valid) verificationFailed();
    }
  } else if (factor || flow.requiredFactor === 'totp') verificationFailed();
  await consumePasswordEmailOtp(flowId, emailCode, context, sessionBinding, 'password_reset');
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        authVersion: sql`${users.authVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, user.id), eq(users.authVersion, flow.userAuthVersion!)));
    await tx
      .update(authIdentityFlows)
      .set({ state: 'complete', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(authIdentityFlows.id, flow.id));
  });
}

async function getPasswordFlow(flowId: string, sessionBinding: string, state: string) {
  const [flow] = await db
    .select()
    .from(authIdentityFlows)
    .where(
      and(
        eq(authIdentityFlows.id, flowId),
        eq(authIdentityFlows.sessionBinding, sessionBinding),
        eq(authIdentityFlows.state, state),
        gt(authIdentityFlows.expiresAt, new Date()),
        isNull(authIdentityFlows.completedAt),
        isNull(authIdentityFlows.terminalAt),
      ),
    )
    .limit(1);

  if (!flow) verificationFailed();

  return flow;
}

async function consumePasswordEmailOtp(
  flowId: string,
  pin: string,
  context: string,
  sessionBinding: string,
  purpose: 'password_signup' | 'password_reset',
) {
  const flow = await getPasswordFlow(
    flowId,
    sessionBinding,
    purpose === 'password_signup' ? 'password_pending_email' : 'password_reset_pending_email',
  );
  const [challenge] = await db
    .select()
    .from(authEmailChallenges)
    .where(
      and(
        eq(authEmailChallenges.flowId, flowId),
        eq(authEmailChallenges.purpose, purpose),
        isNull(authEmailChallenges.consumedAt),
        isNull(authEmailChallenges.supersededAt),
      ),
    )
    .limit(1);

  if (!challenge || challenge.clientContextHash !== context || challenge.expiresAt <= new Date()) verificationFailed();
  if (!pinMatches(challenge.pinHash, hashPin(flowId, challenge.normalizedEmail, context, pin))) {
    await db
      .update(authEmailChallenges)
      .set({ attemptCount: sql`${authEmailChallenges.attemptCount} + 1`, updatedAt: new Date() })
      .where(
        and(eq(authEmailChallenges.id, challenge.id), lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS)),
      );
    verificationFailed();
  }
  const [consumed] = await db
    .update(authEmailChallenges)
    .set({ consumedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(authEmailChallenges.id, challenge.id),
        isNull(authEmailChallenges.consumedAt),
        gt(authEmailChallenges.expiresAt, new Date()),
        lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS),
      ),
    )
    .returning();

  if (!consumed) verificationFailed();

  return flow;
}

export async function verifyPasswordEmailOtp(flowId: string, pin: string, context: string, sessionBinding: string) {
  const [challenge] = await db
    .select()
    .from(authEmailChallenges)
    .where(
      and(
        eq(authEmailChallenges.flowId, flowId),
        eq(authEmailChallenges.purpose, PASSWORD_OTP_PURPOSE),
        isNull(authEmailChallenges.consumedAt),
        isNull(authEmailChallenges.supersededAt),
      ),
    )
    .limit(1);

  if (!challenge || challenge.clientContextHash !== context || challenge.expiresAt <= new Date()) verificationFailed();
  if (!pinMatches(challenge.pinHash, hashPin(flowId, challenge.normalizedEmail, context, pin))) {
    await db
      .update(authEmailChallenges)
      .set({ attemptCount: sql`${authEmailChallenges.attemptCount} + 1`, updatedAt: new Date() })
      .where(
        and(eq(authEmailChallenges.id, challenge.id), lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS)),
      );
    verificationFailed();
  }
  const [consumed] = await db
    .update(authEmailChallenges)
    .set({ consumedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(authEmailChallenges.id, challenge.id),
        isNull(authEmailChallenges.consumedAt),
        isNull(authEmailChallenges.supersededAt),
        lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS),
      ),
    )
    .returning();

  if (!consumed) verificationFailed();

  const [flow] = await db
    .select()
    .from(authIdentityFlows)
    .where(and(eq(authIdentityFlows.id, flowId), eq(authIdentityFlows.state, 'password_pending_email')))
    .limit(1);

  if (!flow || flow.sessionBinding !== sessionBinding || flow.userAuthVersion === null) verificationFailed();
  const user = await findUserById(flow.userId ?? '');

  if (!user || user.authVersion !== flow.userAuthVersion) verificationFailed();
  const [activeTotp] = await db
    .select()
    .from(userTotpEnrollments)
    .where(and(eq(userTotpEnrollments.userId, user.id), eq(userTotpEnrollments.status, 'active')))
    .limit(1);

  if (activeTotp) verificationFailed();
  await db
    .update(authIdentityFlows)
    .set({ state: 'complete', completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(authIdentityFlows.id, flow.id),
        isNull(authIdentityFlows.completedAt),
        isNull(authIdentityFlows.terminalAt),
      ),
    );

  return { flow, user };
}

export async function verifyPasswordTotp(flowId: string, code: string, sessionBinding: string) {
  const [flow] = await db
    .select()
    .from(authIdentityFlows)
    .where(
      and(
        eq(authIdentityFlows.id, flowId),
        eq(authIdentityFlows.state, 'password_pending_email'),
        eq(authIdentityFlows.sessionBinding, sessionBinding),
        eq(authIdentityFlows.requiredFactor, 'totp'),
        gt(authIdentityFlows.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!flow || flow.userAuthVersion === null) verificationFailed();
  const user = await findUserById(flow.userId ?? '');

  if (!user || user.authVersion !== flow.userAuthVersion) verificationFailed();
  const [enrollment] = await db
    .select()
    .from(userTotpEnrollments)
    .where(
      and(
        eq(userTotpEnrollments.userId, user.id),
        eq(userTotpEnrollments.status, 'active'),
        eq(userTotpEnrollments.id, flow.factorEnrollmentId ?? ''),
      ),
    )
    .limit(1);

  if (!enrollment) verificationFailed();
  let valid: boolean;

  try {
    valid = await verifyTotpCode(decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion), code);
  } catch {
    valid = false;
  }
  const timeStep = totpTimeStep();

  if (!valid || enrollment.lastAcceptedTimeStep === timeStep) verificationFailed();
  const [accepted] = await db
    .update(userTotpEnrollments)
    .set({ lastAcceptedTimeStep: timeStep, updatedAt: new Date() })
    .where(
      and(
        eq(userTotpEnrollments.id, enrollment.id),
        eq(userTotpEnrollments.status, 'active'),
        sql`(${userTotpEnrollments.lastAcceptedTimeStep} IS NULL OR ${userTotpEnrollments.lastAcceptedTimeStep} <> ${timeStep})`,
      ),
    )
    .returning();

  if (!accepted) verificationFailed();
  await db
    .update(authIdentityFlows)
    .set({ state: 'complete', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(authIdentityFlows.id, flow.id));

  return { flow, user };
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  assertPasswordAuthenticationAvailable();
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const [updated] = await db.transaction(async (tx) =>
    tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        authVersion: sql`${users.authVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id }),
  );

  if (!updated) {
    throw new HttpError({ code: 'account_unavailable', message: 'The account is not available.', statusCode: 404 });
  }
}

export function generateRecoveryCode(): string {
  const value = randomBytes(16).toString('hex').toUpperCase();

  return `${value.slice(0, 8)}-${value.slice(8)}`;
}

export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, generateRecoveryCode);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await tx
      .insert(userRecoveryCodes)
      .values(
        await Promise.all(
          codes.map(async (code) => ({ id: randomUUID(), userId, codeHash: await hashSecret(code), createdAt: now })),
        ),
      );
  });

  return codes;
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const candidates = await db
    .select()
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));

  for (const candidate of candidates) {
    if (!(await verifySecret(code.toUpperCase(), candidate.codeHash))) continue;
    const [consumed] = await db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(userRecoveryCodes.id, candidate.id), isNull(userRecoveryCodes.usedAt)))
      .returning();

    return Boolean(consumed);
  }

  return false;
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

export async function consumeOperationGrant(
  id: string,
  userId: string,
  purpose: string,
  sessionBinding: string,
): Promise<boolean> {
  const [grant] = await db
    .update(authOperationGrants)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authOperationGrants.id, id),
        eq(authOperationGrants.userId, userId),
        eq(authOperationGrants.purpose, purpose),
        eq(authOperationGrants.sessionBinding, sessionBinding),
        isNull(authOperationGrants.consumedAt),
        gt(authOperationGrants.expiresAt, new Date()),
      ),
    )
    .returning();

  return Boolean(grant);
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

    return { accounts: memberships, email: user.email, isNewUser: Boolean(created), userId: user.id };
  });

  if (!identity || !identity.accounts.length) verificationFailed();

  return identity;
}
