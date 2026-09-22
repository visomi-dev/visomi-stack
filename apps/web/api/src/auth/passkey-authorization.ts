import { and, eq } from 'drizzle-orm';

import {
  accounts,
  accountMemberships,
  accountPasskeyCredentials,
  accountPasskeyEnrollments,
  accountWebAuthnChallenges,
  authEnrollmentGrants,
  db,
  HttpError,
  users,
} from 'shared';

type Credential = typeof accountPasskeyCredentials.$inferSelect;
type User = typeof users.$inferSelect;

function unavailable(code = 'credential_not_found'): never {
  throw new HttpError({ code, message: 'The passkey authorization is no longer available.', statusCode: 401 });
}

/** Commit only the identity and credential epoch whose assertion was verified. */
export async function authorizePasskeyAssertion(input: {
  credential: Credential;
  user: User;
  challengeId: string;
  challengeHash: string;
  sessionBinding: string;
  newCounter: number;
  registration?: {
    enrollmentId: string;
    authVersion: number;
    grantId?: string;
    requesterSessionHash: string;
    requiresGrant: boolean;
  };
}): Promise<User> {
  return db.transaction(async (tx) => {
    const snapshot = input.credential;
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, snapshot.accountId)).for('update');
    const [user] = await tx.select().from(users).where(eq(users.id, snapshot.userId)).for('update');
    const [membership] = await tx
      .select()
      .from(accountMemberships)
      .where(and(eq(accountMemberships.accountId, snapshot.accountId), eq(accountMemberships.userId, snapshot.userId)));

    if (
      !account ||
      !user ||
      !membership ||
      user.authVersion !== input.user.authVersion ||
      user.email !== input.user.email ||
      !user.emailVerifiedAt
    )
      unavailable();

    const registration = input.registration;
    const now = new Date();

    if (registration) {
      if (registration.authVersion !== user.authVersion) unavailable('authentication_required');
      const [flow] = await tx
        .select()
        .from(accountPasskeyEnrollments)
        .where(eq(accountPasskeyEnrollments.id, registration.enrollmentId))
        .for('update');

      if (
        !flow ||
        flow.accountId !== account.id ||
        flow.userId !== user.id ||
        flow.email !== user.email ||
        flow.credentialId !== snapshot.credentialId ||
        flow.status !== 'pending' ||
        flow.terminalAt ||
        flow.expiresAt <= now ||
        snapshot.enrollmentFlowId !== flow.id
      )
        unavailable();
    }
    const [challenge] = await tx
      .select()
      .from(accountWebAuthnChallenges)
      .where(eq(accountWebAuthnChallenges.id, input.challengeId))
      .for('update');

    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.challengeHash !== input.challengeHash ||
      challenge.sessionBinding !== input.sessionBinding ||
      !['authentication', 'discoverable_authentication'].includes(challenge.purpose) ||
      (challenge.userId && (challenge.userId !== user.id || challenge.accountId !== account.id)) ||
      (registration &&
        (challenge.purpose !== 'authentication' ||
          challenge.flowId !== registration.enrollmentId ||
          challenge.credentialId !== snapshot.credentialId))
    )
      unavailable('challenge_mismatch');

    if (registration?.requiresGrant && !registration.grantId) unavailable('enrollment_grant_required');
    if (registration?.grantId) {
      const [grant] = await tx
        .select()
        .from(authEnrollmentGrants)
        .where(eq(authEnrollmentGrants.id, registration.grantId))
        .for('update');

      if (
        !grant ||
        grant.userId !== user.id ||
        grant.accountId !== account.id ||
        grant.revokedAt ||
        grant.expiresAt <= now ||
        grant.requesterSessionHash !== registration.requesterSessionHash ||
        (grant.consumedAt && !['device_approval', 'password_enrollment', 'identity_enrollment'].includes(grant.source))
      ) {
        unavailable('enrollment_grant_unavailable');
      }
      await tx.update(authEnrollmentGrants).set({ consumedAt: now }).where(eq(authEnrollmentGrants.id, grant.id));
    }

    const [credential] = await tx
      .select()
      .from(accountPasskeyCredentials)
      .where(eq(accountPasskeyCredentials.id, snapshot.id))
      .for('update');

    if (
      !credential ||
      credential.revokedAt ||
      credential.status !== (registration ? 'pending' : 'active') ||
      credential.userId !== user.id ||
      credential.accountId !== account.id ||
      credential.publicKey !== snapshot.publicKey ||
      credential.signCount !== snapshot.signCount
    )
      unavailable();
    if ((credential.signCount !== 0 || input.newCounter !== 0) && input.newCounter <= credential.signCount) {
      unavailable('sign_count_regression');
    }
    await tx
      .update(accountWebAuthnChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(eq(accountWebAuthnChallenges.id, challenge.id));
    if (registration) {
      await tx
        .update(accountPasskeyEnrollments)
        .set({ status: 'active', activatedAt: now, updatedAt: now })
        .where(eq(accountPasskeyEnrollments.id, registration.enrollmentId));
    }
    await tx
      .update(accountPasskeyCredentials)
      .set({
        signCount: input.newCounter,
        lastUsedAt: now,
        updatedAt: now,
        ...(registration ? { status: 'active', activatedAt: now } : {}),
      })
      .where(eq(accountPasskeyCredentials.id, credential.id));

    // Session serialization must retain this epoch even if email changes after commit.
    return user;
  });
}
