import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { isLegacySecretHash } from './auth-crypto';
import { consumeEnrolledFactor } from './auth-factors';
import {
  flowHash,
  hashPin,
  MAX_CHALLENGE_ATTEMPTS,
  pinMatches,
  requestEmailOtp,
  verificationFailed,
} from './auth-service';
import { findUserByEmail, listMembershipsForUser, normalizeEmail } from './auth-identity';
import { hashPassword, verifyPassword } from './password';

import { authEmailChallenges, authIdentityFlows, db, HttpError, users, userTotpEnrollments } from 'shared';

type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PasswordFlow = typeof authIdentityFlows.$inferSelect;
const PASSWORD_OTP_PURPOSE = 'password_second_step' as const;
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(32)}`;

export async function startPasswordSignIn(
  email: string,
  password: string,
  context: string,
  sessionBinding: string,
  ip?: string,
) {
  const normalizedEmail = normalizeEmail(email);
  const user = await findUserByEmail(normalizedEmail);
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !user.passwordHash || !passwordMatches) {
    verificationFailed();
  }
  if (!user.emailVerifiedAt) {
    throw new HttpError({
      code: 'email_unverified',
      message: 'Verify your email address before signing in.',
      statusCode: 403,
    });
  }
  if (user.passwordHash && isLegacySecretHash(user.passwordHash)) {
    const upgradedHash = await hashPassword(password);

    await db
      .update(users)
      .set({ passwordHash: upgradedHash, updatedAt: DateTime.utc().toJSDate() })
      .where(
        and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash), eq(users.authVersion, user.authVersion)),
      );
  }
  const memberships = await listMembershipsForUser(user.id);

  if (!memberships.length) {
    verificationFailed();
  }
  const [activeTotp] = await db
    .select()
    .from(userTotpEnrollments)
    .where(and(eq(userTotpEnrollments.userId, user.id), eq(userTotpEnrollments.status, 'active')))
    .limit(1);
  const requiredFactor = activeTotp ? 'totp' : 'email';
  const now = DateTime.utc();
  const flowId = randomUUID();
  const expiresAt = now.plus({ minutes: 10 }).toJSDate();

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
    passwordProofAt: now.toJSDate(),
    requiredFactor,
    userAuthVersion: user.authVersion,
    factorEnrollmentId: activeTotp?.id,
    factorEnrollmentVersion: activeTotp ? user.authVersion : null,
    attemptCount: 0,
    createdAt: now.toJSDate(),
    updatedAt: now.toJSDate(),
  });
  let delivery: Awaited<ReturnType<typeof requestEmailOtp>> | undefined;

  if (!activeTotp) {
    const emailDelivery = await requestEmailOtp(normalizedEmail, context, flowId, PASSWORD_OTP_PURPOSE, ip);

    delivery = emailDelivery;
  }

  return {
    flowId,
    requiredFactor,
    expiresAt: expiresAt.toISOString(),
    ...(delivery ? { resendAvailableAt: delivery.resendAvailableAt } : {}),
    maskedEmail: `${normalizedEmail.slice(0, 1)}***@${normalizedEmail.split('@')[1]}`,
  };
}

export async function completePasswordFlow(tx: AuthTransaction, flowId: string) {
  const [completed] = await tx
    .update(authIdentityFlows)
    .set({ state: 'complete', completedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
    .where(
      and(
        eq(authIdentityFlows.id, flowId),
        gt(authIdentityFlows.expiresAt, DateTime.utc().toJSDate()),
        isNull(authIdentityFlows.completedAt),
        isNull(authIdentityFlows.terminalAt),
      ),
    )
    .returning();

  if (!completed) {
    verificationFailed();
  }
}

// Reserve outside the proof transaction: invalid guesses must consume the budget.
export async function reservePasswordAttempt(flowId: string, sessionBinding: string, state: string) {
  const [flow] = await db
    .update(authIdentityFlows)
    .set({ attemptCount: sql`${authIdentityFlows.attemptCount} + 1`, updatedAt: DateTime.utc().toJSDate() })
    .where(
      and(
        eq(authIdentityFlows.id, flowId),
        eq(authIdentityFlows.sessionBinding, sessionBinding),
        eq(authIdentityFlows.state, state),
        gt(authIdentityFlows.expiresAt, DateTime.utc().toJSDate()),
        isNull(authIdentityFlows.completedAt),
        isNull(authIdentityFlows.terminalAt),
        lt(authIdentityFlows.attemptCount, MAX_CHALLENGE_ATTEMPTS),
      ),
    )
    .returning();

  if (!flow) {
    verificationFailed();
  }

  return flow;
}

export async function lockedPasswordProof(tx: AuthTransaction, reserved: PasswordFlow, sessionBinding: string) {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, reserved.userId ?? ''))
    .for('update');
  const [flow] = await tx.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, reserved.id)).for('update');

  if (
    !user ||
    !flow ||
    flow.userId !== user.id ||
    flow.userAuthVersion !== user.authVersion ||
    flow.sessionBinding !== sessionBinding ||
    flow.state !== reserved.state ||
    flow.expiresAt <= DateTime.utc().toJSDate() ||
    flow.completedAt ||
    flow.terminalAt ||
    flow.emailHash !== flowHash(user.email) ||
    (flow.intent !== 'password_reset' &&
      (!flow.passwordProofAt ||
        flow.authorizationMethod !== 'password' ||
        DateTime.utc().toMillis() - flow.passwordProofAt.getTime() > 10 * 60_000))
  ) {
    verificationFailed();
  }
  const [enrollment] = await tx
    .select()
    .from(userTotpEnrollments)
    .where(and(eq(userTotpEnrollments.userId, user.id), eq(userTotpEnrollments.status, 'active')))
    .for('update');

  if (
    enrollment
      ? flow.requiredFactor !== 'totp' || flow.factorEnrollmentId !== enrollment.id
      : flow.requiredFactor !== 'email'
  ) {
    verificationFailed();
  }

  return { user, flow, enrollment };
}

export async function consumePasswordEmailProof(
  tx: AuthTransaction,
  flow: PasswordFlow,
  pin: string,
  context: string,
  purpose: string,
) {
  const [challenge] = await tx
    .select()
    .from(authEmailChallenges)
    .where(
      and(
        eq(authEmailChallenges.flowId, flow.id),
        eq(authEmailChallenges.purpose, purpose),
        isNull(authEmailChallenges.consumedAt),
        isNull(authEmailChallenges.supersededAt),
      ),
    )
    .for('update');

  if (
    !challenge ||
    challenge.clientContextHash !== context ||
    challenge.expiresAt <= DateTime.utc().toJSDate() ||
    challenge.attemptCount >= MAX_CHALLENGE_ATTEMPTS ||
    flow.emailHash !== flowHash(challenge.normalizedEmail) ||
    !pinMatches(challenge.pinHash, hashPin(flow.id, challenge.normalizedEmail, context, pin))
  ) {
    verificationFailed();
  }
  await tx
    .update(authEmailChallenges)
    .set({ consumedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
    .where(eq(authEmailChallenges.id, challenge.id));
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
        gt(authIdentityFlows.expiresAt, DateTime.utc().toJSDate()),
        isNull(authIdentityFlows.completedAt),
        isNull(authIdentityFlows.terminalAt),
      ),
    )
    .limit(1);

  if (!flow) {
    verificationFailed();
  }

  return flow;
}

export async function consumePasswordEmailOtp(
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

  if (!challenge || challenge.clientContextHash !== context || challenge.expiresAt <= DateTime.utc().toJSDate()) {
    verificationFailed();
  }
  if (!pinMatches(challenge.pinHash, hashPin(flowId, challenge.normalizedEmail, context, pin))) {
    await db
      .update(authEmailChallenges)
      .set({ attemptCount: sql`${authEmailChallenges.attemptCount} + 1`, updatedAt: DateTime.utc().toJSDate() })
      .where(
        and(eq(authEmailChallenges.id, challenge.id), lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS)),
      );
    verificationFailed();
  }
  const [consumed] = await db
    .update(authEmailChallenges)
    .set({ consumedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
    .where(
      and(
        eq(authEmailChallenges.id, challenge.id),
        isNull(authEmailChallenges.consumedAt),
        gt(authEmailChallenges.expiresAt, DateTime.utc().toJSDate()),
        lt(authEmailChallenges.attemptCount, MAX_CHALLENGE_ATTEMPTS),
      ),
    )
    .returning();

  if (!consumed) {
    verificationFailed();
  }

  return flow;
}

export async function verifyPasswordEmailOtp(flowId: string, pin: string, context: string, sessionBinding: string) {
  const reserved = await reservePasswordAttempt(flowId, sessionBinding, 'password_pending_email');

  return db.transaction(async (tx) => {
    const { flow, user, enrollment } = await lockedPasswordProof(tx, reserved, sessionBinding);

    if (!['sign_in', 'passkey_enroll'].includes(flow.intent) || enrollment) {
      verificationFailed();
    }
    await consumePasswordEmailProof(tx, flow, pin, context, PASSWORD_OTP_PURPOSE);
    await completePasswordFlow(tx, flow.id);

    return { flow, user };
  });
}

export async function verifyPasswordTotp(
  flowId: string,
  code: string,
  sessionBinding: string,
  kind: 'totp' | 'recovery_code' = 'totp',
) {
  const reserved = await reservePasswordAttempt(flowId, sessionBinding, 'password_pending_email');

  return db.transaction(async (tx) => {
    const { flow, user, enrollment } = await lockedPasswordProof(tx, reserved, sessionBinding);

    if (!['sign_in', 'passkey_enroll'].includes(flow.intent) || !enrollment) {
      verificationFailed();
    }
    const valid = await consumeEnrolledFactor(tx, enrollment, { kind, code });

    if (!valid) {
      verificationFailed();
    }
    await completePasswordFlow(tx, flow.id);

    return { flow, user };
  });
}

export async function setUserPassword(userId: string, password: string): Promise<number> {
  const passwordHash = await hashPassword(password);
  const now = DateTime.utc().toJSDate();
  const [updated] = await db.transaction(async (tx) =>
    tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: now, authVersion: sql`${users.authVersion} + 1`, updatedAt: now })
      .where(eq(users.id, userId))
      .returning({ id: users.id, authVersion: users.authVersion }),
  );

  if (!updated) {
    throw new HttpError({ code: 'account_unavailable', message: 'The account is not available.', statusCode: 404 });
  }

  return updated.authVersion;
}
