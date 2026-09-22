import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { env } from '../shared/env';

import { verifyPassword } from './password';

import {
  accountMemberships,
  accountPasskeyCredentials,
  accounts,
  authAuditEvents,
  db,
  HttpError,
  userFederatedIdentities,
  users,
} from 'shared';

type AccessRemoval =
  | { kind: 'password'; currentPassword: string }
  | { kind: 'passkey'; credentialId: string }
  | { kind: 'google'; identityId: string };

export async function removeAccessMethod(user: Express.User, removal: AccessRemoval) {
  return db.transaction(async (tx) => {
    // Match assertion and recovery lock ordering before taking the shared user lock.
    // The audit-event foreign key also needs this account row during removal.
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, user.accountId)).for('update');
    // Every destructive credential path takes the same user-row lock before
    // counting alternatives, including global methods and account-scoped keys.
    const [identity] = await tx
      .update(users)
      .set({ updatedAt: sql`${users.updatedAt}` })
      .where(eq(users.id, user.id))
      .returning();

    if (!identity || identity.authVersion !== user.authVersion)
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'Confirm your current identity again.',
        statusCode: 401,
      });
    if (
      removal.kind === 'password' &&
      (!identity.passwordHash || !(await verifyPassword(removal.currentPassword, identity.passwordHash)))
    )
      throw new HttpError({ code: 'password_invalid', message: 'The current password is invalid.', statusCode: 401 });
    const memberships = await tx.select().from(accountMemberships).where(eq(accountMemberships.userId, user.id));
    const passkeys = await tx
      .select()
      .from(accountPasskeyCredentials)
      .where(
        and(
          eq(accountPasskeyCredentials.userId, user.id),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      );
    const federated = await tx
      .select()
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.userId, user.id), isNull(userFederatedIdentities.revokedAt)));
    const targetKey =
      removal.kind === 'passkey'
        ? passkeys.find((key) => key.accountId === user.accountId && key.credentialId === removal.credentialId)
        : undefined;
    const targetGoogle =
      removal.kind === 'google' ? federated.find((item) => item.id === removal.identityId) : undefined;

    if (removal.kind === 'passkey' && !targetKey)
      throw new HttpError({ code: 'credential_not_found', message: 'This passkey is not available.', statusCode: 404 });
    if (removal.kind === 'google' && !targetGoogle)
      throw new HttpError({
        code: 'federated_identity_not_found',
        message: 'This connected account is not available.',
        statusCode: 404,
      });
    const passwordRemains = removal.kind !== 'password' && Boolean(identity.passwordHash && identity.emailVerifiedAt);
    const googleRemains =
      Boolean(env.GOOGLE_AUTH_CLIENT_ID) &&
      federated.some((item) => item.provider === 'google' && item.id !== targetGoogle?.id);
    const keysRemaining = passkeys.filter((key) => key.id !== targetKey?.id);
    const protectedAccounts =
      removal.kind === 'passkey' ? [user.accountId] : memberships.map((membership) => membership.accountId);

    if (
      !passwordRemains &&
      !googleRemains &&
      (!protectedAccounts.length ||
        protectedAccounts.some((accountId) => !keysRemaining.some((key) => key.accountId === accountId)))
    )
      throw new HttpError({
        code: 'last_access_method',
        message: 'Set up and verify another sign-in method before removing this one.',
        statusCode: 409,
      });
    if (removal.kind === 'password')
      await tx
        .update(users)
        .set({
          passwordHash: null,
          passwordChangedAt: new Date(),
          authVersion: sql`${users.authVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    else if (targetKey)
      await tx
        .update(accountPasskeyCredentials)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(accountPasskeyCredentials.id, targetKey.id));
    else if (targetGoogle)
      await tx
        .update(userFederatedIdentities)
        .set({ revokedAt: new Date() })
        .where(eq(userFederatedIdentities.id, targetGoogle.id));
    await tx.insert(authAuditEvents).values({
      id: randomUUID(),
      userId: user.id,
      accountId: user.accountId,
      event: `${removal.kind}_access_removed`,
      outcome: 'accepted',
      createdAt: new Date(),
    });

    return targetKey ? { ...targetKey, revokedAt: new Date() } : null;
  });
}
