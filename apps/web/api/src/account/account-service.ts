import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { generateVerificationPin, hashSecret, verifySecret } from '../auth/auth-crypto';
import { sendVerificationMessage, sendEmailChangeNotification } from '../auth/auth-mail';

import type { ProfileUpdate } from './account-schemas';

import {
  accounts,
  accountMemberships,
  authIdentityFlows,
  authEnrollmentGrants,
  authVerificationChallenges,
  db,
  env,
  HttpError,
  users,
} from 'shared';

export type AccountContext = { userId: string; accountId: string; authVersion: number; sessionBinding: string };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function fail(code: string, message: string, statusCode = 409): never {
  throw new HttpError({ code, message, statusCode });
}

// All membership mutations serialize on the account before taking the user lock.
async function lockContext(tx: Transaction, context: AccountContext) {
  const [account] = await tx.select().from(accounts).where(eq(accounts.id, context.accountId)).for('update');
  const [user] = await tx.select().from(users).where(eq(users.id, context.userId)).for('update');
  const [membership] = await tx
    .select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, context.accountId), eq(accountMemberships.userId, context.userId)));

  if (!account || !user || !membership || user.authVersion !== context.authVersion)
    fail('account_authority_changed', 'Your workspace access changed. Sign in again.', 401);

  return { account, user, membership };
}

const profileSelection = {
  id: users.id,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  displayName: users.displayName,
  preferences: users.preferences,
  preferencesConfigured: users.preferencesConfigured,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export async function getProfile(context: AccountContext) {
  return db.transaction(async (tx) => {
    const { account } = await lockContext(tx, context);
    const [profile] = await tx.select(profileSelection).from(users).where(eq(users.id, context.userId));
    const memberships = await tx
      .select({
        accountId: accounts.id,
        name: accounts.name,
        role: accountMemberships.role,
        joinedAt: accountMemberships.createdAt,
      })
      .from(accountMemberships)
      .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
      .where(eq(accountMemberships.userId, context.userId))
      .orderBy(asc(accountMemberships.createdAt));
    const ownershipCandidates =
      account.ownerUserId === context.userId
        ? await tx
            .select({ userId: users.id, displayName: users.displayName, email: users.email })
            .from(accountMemberships)
            .innerJoin(users, eq(users.id, accountMemberships.userId))
            .where(and(eq(accountMemberships.accountId, context.accountId), sql`${users.id} <> ${context.userId}`))
        : [];

    return {
      profile,
      memberships,
      ownershipCandidates,
      selectedAccountId: context.accountId,
      isWorkspaceOwner: account.ownerUserId === context.userId,
    };
  });
}

export async function updateProfile(context: AccountContext, input: ProfileUpdate) {
  return db.transaction(async (tx) => {
    await lockContext(tx, context);
    const [profile] = await tx
      .update(users)
      .set({ ...input, preferencesConfigured: true, updatedAt: new Date() })
      .where(eq(users.id, context.userId))
      .returning(profileSelection);

    return profile;
  });
}

export async function exportProfile(context: AccountContext) {
  const { profile, memberships } = await getProfile(context);

  return {
    schemaVersion: 1,
    scope: 'profile_and_membership_metadata' as const,
    exportedAt: new Date().toISOString(),
    profile,
    memberships,
  };
}

export async function requestEmailChange(context: AccountContext, email: string) {
  const pendingEmail = email.trim().toLowerCase();
  const pin = generateVerificationPin();
  const id = randomUUID();
  const pinHash = await hashSecret(emailChangeProof(context, id, pendingEmail, pin));
  const expiresAt = new Date(Date.now() + env.PIN_EXPIRY_MINUTES * 60_000);

  await db.transaction(async (tx) => {
    const { user } = await lockContext(tx, context);

    if (user.email === pendingEmail) fail('email_unchanged', 'Choose a different email address.');
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, pendingEmail));

    if (taken) fail('email_unavailable', 'This email address is unavailable.');
    const [recent] = await tx
      .select()
      .from(authIdentityFlows)
      .where(and(eq(authIdentityFlows.userId, user.id), eq(authIdentityFlows.intent, 'email_change')))
      .orderBy(sql`${authIdentityFlows.createdAt} DESC`)
      .limit(1);

    if (recent && Date.now() - recent.createdAt.getTime() < env.PIN_RESEND_COOLDOWN_SECONDS * 1000)
      fail('email_change_cooldown', 'Wait before requesting another code.', 429);
    const now = new Date();

    await tx
      .update(authIdentityFlows)
      .set({ terminalAt: now, pendingEmail: null, updatedAt: now })
      .where(
        and(
          eq(authIdentityFlows.userId, user.id),
          eq(authIdentityFlows.intent, 'email_change'),
          isNull(authIdentityFlows.completedAt),
          isNull(authIdentityFlows.terminalAt),
        ),
      );
    await tx.insert(authIdentityFlows).values({
      id,
      userId: user.id,
      accountId: context.accountId,
      sessionBinding: context.sessionBinding,
      userAuthVersion: user.authVersion,
      pendingEmail,
      intent: 'email_change',
      state: 'email_change_pending',
      expiresAt,
    });
    await tx.insert(authVerificationChallenges).values({
      id,
      userId: user.id,
      email: pendingEmail,
      purpose: 'email_change',
      pinHash,
      expiresAt,
      lastSentAt: now,
    });
  });
  try {
    await sendVerificationMessage({ challengeId: id, email: pendingEmail, expiresAt, pin, purpose: 'email_change' });
  } catch {
    await db
      .update(authIdentityFlows)
      .set({ terminalAt: new Date(), pendingEmail: null })
      .where(eq(authIdentityFlows.id, id));
    fail('email_delivery_failed', 'The verification email could not be sent. Your primary email has not changed.', 503);
  }

  return { flowId: id, email: pendingEmail, expiresAt: expiresAt.toISOString() };
}

function emailChangeProof(context: AccountContext, flowId: string, email: string, pin: string): string {
  // Domain separation also prevents generic sign-in challenge handlers accepting this code.
  return JSON.stringify([
    'email_change',
    context.userId,
    context.accountId,
    context.authVersion,
    context.sessionBinding,
    flowId,
    email,
    pin,
  ]);
}

export async function verifyEmailChange(context: AccountContext, flowId: string, pin: string) {
  const result = await db
    .transaction(async (tx) => {
      const { user } = await lockContext(tx, context);
      const [flow] = await tx.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flowId)).for('update');
      const [challenge] = await tx
        .select()
        .from(authVerificationChallenges)
        .where(eq(authVerificationChallenges.id, flowId))
        .for('update');

      if (
        !flow ||
        !challenge ||
        flow.intent !== 'email_change' ||
        flow.state !== 'email_change_pending' ||
        flow.userId !== user.id ||
        flow.accountId !== context.accountId ||
        flow.sessionBinding !== context.sessionBinding ||
        flow.userAuthVersion !== user.authVersion ||
        flow.completedAt ||
        flow.terminalAt ||
        flow.expiresAt <= new Date() ||
        challenge.purpose !== 'email_change' ||
        challenge.userId !== user.id ||
        challenge.email !== flow.pendingEmail ||
        challenge.consumedAt ||
        challenge.expiresAt <= new Date() ||
        challenge.attemptCount >= 5
      )
        fail(
          'email_verification_unavailable',
          'This email verification is no longer available. Request a new code.',
          401,
        );
      if (!(await verifySecret(emailChangeProof(context, flowId, challenge.email, pin), challenge.pinHash))) {
        await tx
          .update(authVerificationChallenges)
          .set({ attemptCount: challenge.attemptCount + 1, updatedAt: new Date() })
          .where(eq(authVerificationChallenges.id, flowId));

        return null; // Commit the failed attempt before returning the HTTP error.
      }
      const pendingEmail = flow.pendingEmail;

      if (!pendingEmail) fail('email_verification_unavailable', 'Request a new email verification.', 401);
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, pendingEmail));

      if (taken) fail('email_unavailable', 'This email address is unavailable.');
      const now = new Date();

      await tx
        .update(users)
        .set({ email: pendingEmail, emailVerifiedAt: now, authVersion: sql`${users.authVersion} + 1`, updatedAt: now })
        .where(eq(users.id, user.id));
      // Recovery consumption/issuance also holds this user lock. Whichever wins
      // first, no proof or enrollment grant from the old email survives commit.
      await tx
        .update(authIdentityFlows)
        .set({ terminalAt: now, updatedAt: now })
        .where(
          or(
            and(
              eq(authIdentityFlows.userId, user.id),
              or(
                eq(authIdentityFlows.intent, 'existing_account_recovery'),
                eq(authIdentityFlows.authorizationMethod, 'email_recovery'),
              ),
            ),
            inArray(
              authIdentityFlows.id,
              tx
                .select({ id: authVerificationChallenges.id })
                .from(authVerificationChallenges)
                .where(
                  and(
                    eq(authVerificationChallenges.userId, user.id),
                    eq(authVerificationChallenges.purpose, 'existing_account_recovery'),
                  ),
                ),
            ),
          ),
        );
      await tx
        .update(authVerificationChallenges)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(authVerificationChallenges.userId, user.id),
            eq(authVerificationChallenges.purpose, 'existing_account_recovery'),
            isNull(authVerificationChallenges.consumedAt),
          ),
        );
      await tx
        .update(authEnrollmentGrants)
        .set({ revokedAt: now })
        .where(and(eq(authEnrollmentGrants.userId, user.id), isNull(authEnrollmentGrants.revokedAt)));
      await tx
        .update(authIdentityFlows)
        .set({ state: 'complete', completedAt: now, pendingEmail: null, updatedAt: now })
        .where(eq(authIdentityFlows.id, flowId));
      await tx
        .update(authVerificationChallenges)
        .set({ consumedAt: now, updatedAt: now })
        .where(eq(authVerificationChallenges.id, flowId));

      return { oldEmail: user.email };
    })
    .catch((error: unknown) => {
      // The unique index is the final arbiter if two users verify the same address concurrently.
      const cause = error instanceof Error && 'cause' in error ? error.cause : error;

      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505')
        fail('email_unavailable', 'This email address is unavailable.');
      throw error;
    });

  if (!result) fail('invalid_verification_code', 'The verification code is invalid.', 401);
  let notification: 'sent' | 'failed' = 'sent';

  try {
    await sendEmailChangeNotification(result.oldEmail);
  } catch {
    notification = 'failed';
  }

  return { changed: true as const, signInRequired: true as const, notification };
}

export async function transferWorkspaceOwnership(context: AccountContext, targetUserId: string) {
  await db.transaction(async (tx) => {
    const { account } = await lockContext(tx, context);

    if (account.ownerUserId !== context.userId)
      fail('workspace_owner_required', 'Only the current workspace owner can transfer ownership.', 403);
    if (targetUserId === context.userId) fail('ownership_target_invalid', 'Choose another workspace member.');
    const [target] = await tx
      .select()
      .from(accountMemberships)
      .where(and(eq(accountMemberships.accountId, context.accountId), eq(accountMemberships.userId, targetUserId)))
      .for('update');

    if (!target) fail('ownership_target_invalid', 'Choose an existing member of this workspace.');
    await tx
      .update(accountMemberships)
      .set({ role: 'owner', updatedAt: new Date() })
      .where(eq(accountMemberships.id, target.id));
    await tx
      .update(accounts)
      .set({ ownerUserId: targetUserId, updatedAt: new Date() })
      .where(eq(accounts.id, context.accountId));
  });

  return { transferred: true as const };
}

export async function leaveWorkspace(context: AccountContext) {
  return db.transaction(async (tx) => {
    const { account, membership } = await lockContext(tx, context);
    const owners = await tx
      .select({ userId: accountMemberships.userId })
      .from(accountMemberships)
      .where(and(eq(accountMemberships.accountId, context.accountId), eq(accountMemberships.role, 'owner')));

    if (
      account.ownerUserId === context.userId ||
      (membership.role === 'owner' && !owners.some((owner) => owner.userId !== context.userId))
    )
      fail('ownership_transfer_required', 'Transfer workspace ownership to another member before leaving.');
    await tx.delete(accountMemberships).where(eq(accountMemberships.id, membership.id));
    await tx
      .update(users)
      .set({ authVersion: sql`${users.authVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, context.userId));
    const remaining = await tx
      .select({ accountId: accountMemberships.accountId })
      .from(accountMemberships)
      .where(eq(accountMemberships.userId, context.userId));

    return {
      left: true as const,
      accountId: context.accountId,
      signInRequired: true as const,
      hasRemainingMemberships: remaining.length > 0,
    };
  });
}
