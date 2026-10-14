import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { consumeEnrolledFactor } from './auth-factors';
import { flowHash, requestEmailOtp, verificationFailed } from './auth-service';
import { findUserByEmail, getPrimaryMembership, normalizeAccountSlug, normalizeEmail } from './auth-identity';
import { consumeFactorVerificationLimit } from './passkey-security';
import { hashPassword } from './password';
import {
  completePasswordFlow,
  consumePasswordEmailOtp,
  consumePasswordEmailProof,
  lockedPasswordProof,
  reservePasswordAttempt,
} from './password-session';

import { accountMemberships, accounts, authIdentityFlows, db, HttpError, userTotpEnrollments, users } from 'shared';

export async function startPasswordSignUp(
  email: string,
  password: string,
  context: string,
  sessionBinding: string,
  ip?: string,
) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await findUserByEmail(normalizedEmail);

  if (existing) {
    throw new HttpError({
      code: 'email_already_registered',
      message: 'This email address is already registered.',
      statusCode: 409,
    });
  }
  const now = DateTime.utc();
  const flowId = randomUUID();
  const expiresAt = now.plus({ minutes: 10 }).toJSDate();
  const pendingPasswordHash = await hashPassword(password);

  await db.insert(authIdentityFlows).values({
    id: flowId,
    state: 'password_pending_email',
    intent: 'password_signup',
    expiresAt,
    sessionBinding,
    emailHash: flowHash(normalizedEmail),
    pendingPasswordHash,
    pendingEmail: normalizedEmail,
    requiredFactor: 'email',
    createdAt: now.toJSDate(),
    updatedAt: now.toJSDate(),
  });
  const delivery = await requestEmailOtp(normalizedEmail, context, flowId, 'password_signup', ip);

  return { flowId, expiresAt: expiresAt.toISOString(), resendAvailableAt: delivery.resendAvailableAt };
}

export async function verifyPasswordSignUp(flowId: string, pin: string, context: string, sessionBinding: string) {
  const flow = await consumePasswordEmailOtp(flowId, pin, context, sessionBinding, 'password_signup');

  if (!flow.pendingPasswordHash || flow.intent !== 'password_signup') {
    verificationFailed();
  }
  const now = DateTime.utc().toJSDate();
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

    if (!user) {
      verificationFailed();
    }
    const accountId = randomUUID();

    await tx.insert(accounts).values({
      id: accountId,
      name: user.email.split('@')[0] || 'Personal account',
      slug: `${normalizeAccountSlug(user.email)}-${accountId.slice(0, 8)}`,
      ownerUserId: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .insert(accountMemberships)
      .values({ id: randomUUID(), accountId, userId: user.id, role: 'owner', createdAt: now, updatedAt: now });
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
      authVersion: user.authVersion,
    };
  });

  return identity;
}

export async function startPasswordReset(email: string, context: string, sessionBinding: string, ip?: string) {
  const normalizedEmail = normalizeEmail(email);
  const user = await findUserByEmail(normalizedEmail);
  const flowId = randomUUID();
  const now = DateTime.utc();
  const expiresAt = now.plus({ minutes: 10 }).toJSDate();
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
  let membership: Awaited<ReturnType<typeof getPrimaryMembership>> | undefined;

  if (user) {
    const primaryMembership = await getPrimaryMembership(user.id);

    membership = primaryMembership;
  }

  await db.insert(authIdentityFlows).values({
    id: flowId,
    state: 'password_reset_pending_email',
    intent: 'password_reset',
    expiresAt,
    sessionBinding,
    emailHash: flowHash(normalizedEmail),
    userId: user?.id,
    accountId: membership?.accountId,
    requiredFactor,
    factorEnrollmentId,
    userAuthVersion: user?.authVersion,
    createdAt: now.toJSDate(),
    updatedAt: now.toJSDate(),
  });
  if (user) {
    await requestEmailOtp(normalizedEmail, context, flowId, 'password_reset', ip);
  }

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
  ip?: string,
) {
  const reserved = await reservePasswordAttempt(flowId, sessionBinding, 'password_reset_pending_email');

  if (!reserved.userId) {
    verificationFailed();
  }
  const permitted = await consumeFactorVerificationLimit(reserved.userId, ip);

  if (!permitted) {
    verificationFailed();
  }
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const { flow, user, enrollment } = await lockedPasswordProof(tx, reserved, sessionBinding);

    if (flow.intent !== 'password_reset') {
      verificationFailed();
    }
    await consumePasswordEmailProof(tx, flow, emailCode, context, 'password_reset');
    if (enrollment) {
      if (!factor) {
        verificationFailed();
      }
      const valid = await consumeEnrolledFactor(tx, enrollment, factor);

      if (!valid) {
        verificationFailed();
      }
    } else if (factor) {
      verificationFailed();
    }
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: DateTime.utc().toJSDate(),
        authVersion: sql`${users.authVersion} + 1`,
        updatedAt: DateTime.utc().toJSDate(),
      })
      .where(and(eq(users.id, user.id), eq(users.authVersion, user.authVersion)));
    await completePasswordFlow(tx, flow.id);
  });
}
