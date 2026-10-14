import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { env } from '../shared/env';

import { generateVerificationPin, hashSecret, verifySecret } from './auth-crypto';
import { sendVerificationMessage } from './auth-mail';
import { flowHash, MAX_CHALLENGE_ATTEMPTS, requireEmailDelivery } from './auth-service';
import { consumeEnrolledFactor } from './auth-factors';
import type { AuthChallengePayload } from './auth-service';

import {
  accountMemberships,
  accounts,
  authEnrollmentGrants,
  authIdentityFlows,
  authVerificationChallenges,
  db,
  fail,
  safeInsert,
  users,
  userTotpEnrollments,
} from 'shared';

export async function createRecoveryChallenge(
  user: typeof users.$inferSelect,
  flowId: AuthChallengePayload['challengeId'],
  sessionBinding: string,
  ip?: string,
): Promise<AuthChallengePayload> {
  await requireEmailDelivery(user.email, ip);
  const pin = generateVerificationPin();
  const now = DateTime.utc();
  const expiresAt = now.plus({ minutes: env.PIN_EXPIRY_MINUTES }).toJSDate();
  const pinHash = await hashSecret(recoveryProof(user, flowId, sessionBinding, pin));
  const [primary] = await db
    .select({ accountId: accountMemberships.accountId })
    .from(accountMemberships)
    .where(eq(accountMemberships.userId, user.id))
    .orderBy(asc(accountMemberships.createdAt))
    .limit(1);

  await db.transaction(async (tx) => {
    if (primary) {
      await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, primary.accountId)).for('update');
    }
    const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');
    const [flow] = await tx.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flowId)).for('update');

    if (
      !current ||
      current.authVersion !== user.authVersion ||
      current.email !== user.email ||
      !flow ||
      flow.sessionBinding !== sessionBinding ||
      flow.state !== 'authorize_existing_account' ||
      flow.emailHash !== flowHash(current.email) ||
      flow.expiresAt <= DateTime.utc().toJSDate() ||
      flow.completedAt ||
      flow.terminalAt
    ) {
      recoveryUnavailable();
    }
    const [membership] = await tx
      .select()
      .from(accountMemberships)
      .where(eq(accountMemberships.userId, user.id))
      .orderBy(asc(accountMemberships.createdAt))
      .limit(1);

    if (membership?.accountId !== primary?.accountId) {
      recoveryUnavailable();
    }
    await tx
      .update(authVerificationChallenges)
      .set({ consumedAt: now.toJSDate(), updatedAt: now.toJSDate() })
      .where(
        and(
          eq(authVerificationChallenges.userId, user.id),
          eq(authVerificationChallenges.purpose, 'existing_account_recovery'),
          isNull(authVerificationChallenges.consumedAt),
        ),
      );
    await tx
      .update(authIdentityFlows)
      .set({
        intent: 'existing_account_recovery',
        authorizationMethod: 'email_recovery',
        userId: current.id,
        userAuthVersion: current.authVersion,
        accountId: membership?.accountId ?? null,
        updatedAt: now.toJSDate(),
      })
      .where(eq(authIdentityFlows.id, flowId));
    await safeInsert(
      () =>
        tx.insert(authVerificationChallenges).values({
          id: flowId,
          userId: current.id,
          email: current.email,
          purpose: 'existing_account_recovery',
          pinHash,
          expiresAt,
          lastSentAt: now.toJSDate(),
          createdAt: now.toJSDate(),
          updatedAt: now.toJSDate(),
        }),
      'auth_verification_challenges_pkey',
      {
        code: 'challenge_already_exists',
        message: 'A verification challenge with that id already exists.',
        statusCode: 409,
      },
    );
  });
  await sendVerificationMessage({
    challengeId: flowId,
    email: user.email,
    expiresAt,
    pin,
    purpose: 'existing_account_recovery',
  });

  return {
    challengeId: flowId,
    email: user.email,
    expiresAt: expiresAt.toISOString(),
    purpose: 'existing_account_recovery',
  };
}

function recoveryUnavailable(): never {
  fail('recovery_unavailable', 'The recovery request could not be completed.', 401);
}

function recoveryProof(
  user: { id: string; email: string; authVersion: number },
  flowId: string,
  sessionBinding: string,
  pin: string,
): string {
  return JSON.stringify([
    'existing_account_recovery',
    flowId,
    user.id,
    user.email,
    user.authVersion,
    sessionBinding,
    pin,
  ]);
}

// Account -> user -> flow -> challenge/grant matches email-change's lock order.
// Taking the account lock first also avoids FK key-share/user-lock deadlocks.
// Never reload the user's current epoch after accepting a proof from an older one.
export async function consumeRecoveryAuthorization(
  flowId: string,
  pin: string,
  sessionBinding: string,
  requesterSessionHash: string,
  factor?: { kind: 'totp' | 'recovery_code'; code: string },
) {
  const [candidate] = await db
    .select({ userId: authIdentityFlows.userId, accountId: authIdentityFlows.accountId })
    .from(authIdentityFlows)
    .where(eq(authIdentityFlows.id, flowId));

  if (!candidate?.userId || !candidate.accountId) {
    recoveryUnavailable();
  }
  const userId = candidate.userId;
  const accountId = candidate.accountId;
  const authorization = await db.transaction(async (tx) => {
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for('update');
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    const [flow] = await tx.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flowId)).for('update');
    const [challenge] = await tx
      .select()
      .from(authVerificationChallenges)
      .where(eq(authVerificationChallenges.id, flowId))
      .for('update');

    if (
      !user ||
      !flow ||
      !challenge ||
      flow.intent !== 'existing_account_recovery' ||
      flow.state !== 'authorize_existing_account' ||
      flow.authorizationMethod !== 'email_recovery' ||
      flow.userId !== user.id ||
      flow.accountId !== accountId ||
      flow.sessionBinding !== sessionBinding ||
      flow.userAuthVersion !== user.authVersion ||
      flow.emailHash !== flowHash(user.email) ||
      flow.expiresAt <= DateTime.utc().toJSDate() ||
      flow.completedAt ||
      flow.terminalAt ||
      challenge.purpose !== 'existing_account_recovery' ||
      challenge.userId !== user.id ||
      challenge.email !== user.email ||
      challenge.consumedAt ||
      challenge.expiresAt <= DateTime.utc().toJSDate() ||
      challenge.attemptCount >= MAX_CHALLENGE_ATTEMPTS
    ) {
      recoveryUnavailable();
    }
    await tx
      .update(authVerificationChallenges)
      .set({ attemptCount: challenge.attemptCount + 1, updatedAt: DateTime.utc().toJSDate() })
      .where(eq(authVerificationChallenges.id, flowId));
    const valid = await verifySecret(recoveryProof(user, flowId, sessionBinding, pin), challenge.pinHash);

    if (!valid) {
      return null; // Failed attempts must commit rather than disappear with a thrown rollback.
    }
    const [enrollment] = await tx
      .select()
      .from(userTotpEnrollments)
      .where(and(eq(userTotpEnrollments.userId, user.id), eq(userTotpEnrollments.status, 'active')))
      .for('update');

    if (enrollment) {
      if (!factor) {
        return null;
      }
      const factorValid = await consumeEnrolledFactor(tx, enrollment, factor);

      if (!factorValid) {
        return null;
      }
    }
    const memberships = await tx
      .select()
      .from(accountMemberships)
      .where(eq(accountMemberships.userId, user.id))
      .orderBy(asc(accountMemberships.createdAt));
    const selected = memberships.find((membership) => membership.accountId === flow.accountId);

    if (!selected) {
      recoveryUnavailable();
    }
    const now = DateTime.utc().toJSDate();
    const expiresAt = DateTime.fromMillis(Math.min(flow.expiresAt.getTime(), now.getTime() + 15 * 60_000)).toJSDate();

    await tx
      .update(authVerificationChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(eq(authVerificationChallenges.id, flowId));
    await tx
      .update(authEnrollmentGrants)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authEnrollmentGrants.userId, user.id),
          eq(authEnrollmentGrants.accountId, selected.accountId),
          isNull(authEnrollmentGrants.consumedAt),
          isNull(authEnrollmentGrants.revokedAt),
        ),
      );
    const [grant] = await tx
      .insert(authEnrollmentGrants)
      .values({
        id: flowId,
        userId: user.id,
        accountId: selected.accountId,
        requesterSessionHash,
        source: 'email_recovery',
        expiresAt,
        createdAt: now,
      })
      .returning();

    await tx
      .update(authIdentityFlows)
      .set({
        state: 'enroll_passkey',
        requiredFactor: enrollment ? 'totp' : 'email',
        factorEnrollmentId: enrollment?.id ?? null,
        factorEnrollmentVersion: user.authVersion,
        updatedAt: now,
      })
      .where(eq(authIdentityFlows.id, flowId));

    return { user, memberships, selected, grant, flowId, sessionBinding, expiresAt: expiresAt.getTime() };
  });

  if (!authorization) {
    recoveryUnavailable();
  }

  return authorization;
}

// Passport rotates the session ID during login. Rebind only the already-issued
// grant, checking the original epoch again; this cannot recreate a revoked grant.
export async function bindRecoveryEnrollmentSession(
  authorization: Awaited<ReturnType<typeof consumeRecoveryAuthorization>>,
  requesterSessionHash: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, authorization.selected.accountId))
      .for('update');
    const [user] = await tx.select().from(users).where(eq(users.id, authorization.user.id)).for('update');
    const [flow] = await tx
      .select()
      .from(authIdentityFlows)
      .where(eq(authIdentityFlows.id, authorization.flowId))
      .for('update');

    if (
      !user ||
      user.authVersion !== authorization.user.authVersion ||
      user.email !== authorization.user.email ||
      !flow ||
      flow.userAuthVersion !== user.authVersion ||
      flow.userId !== user.id ||
      flow.intent !== 'existing_account_recovery' ||
      flow.accountId !== authorization.selected.accountId ||
      flow.state !== 'enroll_passkey' ||
      flow.authorizationMethod !== 'email_recovery' ||
      flow.sessionBinding !== authorization.sessionBinding ||
      flow.terminalAt ||
      flow.completedAt ||
      flow.expiresAt <= DateTime.utc().toJSDate()
    ) {
      recoveryUnavailable();
    }
    const [bound] = await tx
      .update(authEnrollmentGrants)
      .set({ requesterSessionHash })
      .where(
        and(
          eq(authEnrollmentGrants.id, authorization.grant.id),
          eq(authEnrollmentGrants.requesterSessionHash, authorization.grant.requesterSessionHash),
          eq(authEnrollmentGrants.userId, user.id),
          eq(authEnrollmentGrants.source, 'email_recovery'),
          eq(authEnrollmentGrants.accountId, authorization.selected.accountId),
          isNull(authEnrollmentGrants.consumedAt),
          isNull(authEnrollmentGrants.revokedAt),
          gt(authEnrollmentGrants.expiresAt, DateTime.utc().toJSDate()),
        ),
      )
      .returning();

    if (!bound) {
      recoveryUnavailable();
    }
  });
}
