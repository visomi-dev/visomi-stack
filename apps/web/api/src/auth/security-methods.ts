import { and, eq, isNull } from 'drizzle-orm';

import { env } from '../shared/env';

import { findUserById } from './auth-identity';

import { accountPasskeyCredentials, db, userTotpEnrollments, userRecoveryCodes, userFederatedIdentities } from 'shared';

export async function securityMethods(userId: string, accountId: string) {
  const [user, passkeys, totp, recovery, google] = await Promise.all([
    findUserById(userId),
    db
      .select({ id: accountPasskeyCredentials.id })
      .from(accountPasskeyCredentials)
      .where(
        and(
          eq(accountPasskeyCredentials.userId, userId),
          eq(accountPasskeyCredentials.accountId, accountId),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      ),
    db
      .select({ id: userTotpEnrollments.id })
      .from(userTotpEnrollments)
      .where(and(eq(userTotpEnrollments.userId, userId), eq(userTotpEnrollments.status, 'active'))),
    db
      .select({ id: userRecoveryCodes.id })
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt))),
    db
      .select({ id: userFederatedIdentities.id })
      .from(userFederatedIdentities)
      .where(
        and(
          eq(userFederatedIdentities.userId, userId),
          eq(userFederatedIdentities.provider, 'google'),
          eq(userFederatedIdentities.issuer, 'https://accounts.google.com'),
          isNull(userFederatedIdentities.revokedAt),
        ),
      ),
  ]);
  const methods: Array<'passkey' | 'google' | 'password' | 'totp' | 'recovery_code'> = [];

  if (passkeys.length) {
    methods.push('passkey');
  }
  if (env.GOOGLE_AUTH_CLIENT_ID && google.length) {
    methods.push('google');
  }
  if (user?.passwordHash) {
    methods.push('password');
  }
  if (totp.length) {
    methods.push('totp');
  }
  if (recovery.length) {
    methods.push('recovery_code');
  }

  return {
    methods,
    passwordEnabled: Boolean(user?.passwordHash),
    totpEnabled: totp.length > 0,
    recoveryCodesRemaining: recovery.length,
  };
}
