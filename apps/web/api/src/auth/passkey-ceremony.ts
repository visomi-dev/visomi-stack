import { createHash, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DateTime } from 'luxon';

import { env } from '../shared/env';

import { findUserByEmail, getPrimaryMembership, resolveAuthUserForAccount } from './auth-identity';
import { establishFullSession } from './auth-session';
import { emailGate } from './passkey-contract';

import { accountMemberships, accountPasskeyCredentials, accountWebAuthnChallenges, db, fail, users } from 'shared';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SECURITY_REAUTH_TTL_MS = 10 * 60 * 1000;

export const PASSKEY_ACCOUNT_UNAVAILABLE = 'credential_not_found';
export const rpId = process.env.WEBAUTHN_RP_ID ?? 'localhost';
export const origin = process.env.WEBAUTHN_ORIGIN ?? new URL(env.APP_BASE_URL).origin;

export function hashChallenge(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}

export function credentialView(value: typeof accountPasskeyCredentials.$inferSelect) {
  return {
    id: value.credentialId,
    label: value.label,
    createdAt: value.createdAt.toISOString(),
    lastUsedAt: value.lastUsedAt?.toISOString() ?? null,
    revokedAt: value.revokedAt?.toISOString() ?? null,
    transports: value.transports,
    backupEligible: value.backupEligible,
    backupState: value.backupState,
  };
}

export function failure(
  code: string,
  statusCode: number,
  message = 'The passkey ceremony could not be completed.',
): never {
  fail(code, message, statusCode);
}

export function requireFreshSecurityReauthentication(req: Request): void {
  const verifiedAt = req.session?.passkeySecurityReauthenticatedAt;

  if (!verifiedAt || DateTime.utc().toMillis() - verifiedAt > SECURITY_REAUTH_TTL_MS) {
    failure('reauthentication_required', 401, 'Confirm an existing passkey before changing security settings.');
  }
}

export async function requireVerifiedEmail(email: string, accountId?: string) {
  const user = await findUserByEmail(email);

  if (!user) {
    failure(PASSKEY_ACCOUNT_UNAVAILABLE, 404);
  }
  const gate = emailGate(email, user.emailVerifiedAt);

  if (gate === 'email_required') {
    failure('email_required', 400, 'An email address is required.');
  }
  if (gate === 'email_unverified') {
    failure('email_unverified', 403, 'Verify the email address before using a passkey.');
  }
  const membershipLookup = accountId
    ? db
        .select()
        .from(accountMemberships)
        .where(and(eq(accountMemberships.userId, user.id), eq(accountMemberships.accountId, accountId)))
        .limit(1)
    : getPrimaryMembership(user.id).then((membership) => [membership]);
  const [membership] = await membershipLookup;

  if (!membership) {
    failure('account_membership_missing', 500);
  }

  return { user, membership };
}

export function requireRestrictedSession(req: Request): { userId: string; email: string; accountId: string } {
  const sessionUser = req.user;
  const authority = req.session?.authority;

  if (!sessionUser?.id || !sessionUser.email || !sessionUser.accountId) {
    failure('authentication_required', 401, 'Sign in before changing security settings.');
  }
  if (authority !== 'restricted' && authority !== 'full') {
    failure('restricted_session_required', 401, 'Verify the email before registering a passkey.');
  }

  return { accountId: sessionUser.accountId, email: sessionUser.email, userId: sessionUser.id };
}

export async function createChallenge(
  accountId: string | null,
  userId: string | null,
  purpose: 'registration' | 'authentication' | 'discoverable_authentication',
  value: string,
  sessionBinding = 'legacy',
  binding: { credentialId?: string; flowId?: string } = {},
) {
  const now = DateTime.utc();
  const expiresAt = now.plus({ milliseconds: CHALLENGE_TTL_MS }).toJSDate();
  const id = randomUUID();

  await db.insert(accountWebAuthnChallenges).values({
    id,
    accountId,
    userId,
    challengeHash: hashChallenge(value),
    purpose,
    ceremonyType: purpose === 'registration' ? 'registration' : 'authentication',
    sessionBinding,
    flowId: binding.flowId ?? null,
    credentialId: binding.credentialId ?? null,
    allowCredentialIds: binding.credentialId ? [binding.credentialId] : [],
    rpId,
    origin,
    userVerification: 'required',
    expiresAt,
    createdAt: now.toJSDate(),
    attemptCount: 0,
    consumedAt: null,
  });

  return { id, expiresAt };
}

export async function loginPasskey(
  req: Request,
  res: Response,
  user: typeof users.$inferSelect,
  accountId: string,
  credentialId: string,
) {
  const authUser = await resolveAuthUserForAccount(user, accountId);
  const authenticatedUser = {
    ...authUser,
    authority: 'full' as const,
    authenticationMethod: 'passkey' as const,
    authVersion: user.authVersion,
    credentialId,
  };

  await establishFullSession(req, res, authenticatedUser);
  delete req.session.restrictedAuth;

  return authenticatedUser;
}
