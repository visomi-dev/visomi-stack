import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { Router, type Response } from 'express';

import { getValidated, validateRequest } from '../shared/http/route-schemas';
import { env } from '../shared/env';

import { authed, authedRequest } from './auth-middleware';
import {
  createPasskeyEnrollment,
  findUserByEmail,
  findUserById,
  getPrimaryMembership,
  resolveAuthUserForAccount,
} from './auth-service';
import {
  authenticationBeginSchema,
  authenticationCompleteSchema,
  credentialMutationSchema,
  credentialIdPathSchema,
  passkeyOpenApiPaths,
  registrationBeginSchema,
  registrationCompleteSchema,
} from './passkey-schemas';
import { emailGate, nextPasskeyAttempt } from './passkey-contract';
import { csrfProtection, passkeyRateLimit } from './passkey-security';
import { setSessionHintCookie } from './session-cookie';

import {
  accountPasskeyCredentials,
  accountPasskeyEnrollments,
  accountWebAuthnChallenges,
  db,
  HttpError,
  users,
} from 'shared';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SECURITY_REAUTH_TTL_MS = 10 * 60 * 1000;
const PASSKEY_ACCOUNT_UNAVAILABLE = 'credential_not_found';
const rpId = process.env.WEBAUTHN_RP_ID ?? 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN ?? new URL(env.APP_BASE_URL).origin;

function hashChallenge(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}
function credentialView(value: typeof accountPasskeyCredentials.$inferSelect) {
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
function failure(code: string, statusCode: number, message = 'The passkey ceremony could not be completed.'): never {
  throw new HttpError({ code, message, statusCode });
}
function requireFreshSecurityReauthentication(req: Parameters<typeof authedRequest>[0]): void {
  const verifiedAt = req.session?.passkeySecurityReauthenticatedAt;

  if (!verifiedAt || Date.now() - verifiedAt > SECURITY_REAUTH_TTL_MS)
    failure('reauthentication_required', 401, 'Confirm an existing passkey before changing security settings.');
}
async function requireVerifiedEmail(email: string) {
  const user = await findUserByEmail(email);

  if (!user) failure(PASSKEY_ACCOUNT_UNAVAILABLE, 404);
  const gate = emailGate(email, user.emailVerifiedAt);

  if (gate === 'email_required') failure('email_required', 400, 'An email address is required.');
  if (gate === 'email_unverified') failure('email_unverified', 403, 'Verify the email address before using a passkey.');
  const membership = await getPrimaryMembership(user.id);

  if (!membership) failure('account_membership_missing', 500);

  return { user, membership };
}
function requireRestrictedSession(req: Parameters<typeof authedRequest>[0]): {
  userId: string;
  email: string;
  accountId: string;
} {
  const sessionUser = req.user;
  const authority = req.session?.authority;

  if (!sessionUser?.id || !sessionUser.email || !sessionUser.accountId) {
    failure('authentication_required', 401, 'Sign in before changing security settings.');
  }

  if (authority !== 'restricted' && authority !== 'full') {
    failure('restricted_session_required', 401, 'Verify the email before registering a passkey.');
  }

  return {
    accountId: sessionUser.accountId,
    email: sessionUser.email,
    userId: sessionUser.id,
  };
}
async function createChallenge(
  accountId: string | null,
  userId: string | null,
  purpose: 'registration' | 'authentication' | 'discoverable_authentication',
  value: string,
  sessionBinding = 'legacy',
  binding: { credentialId?: string; flowId?: string } = {},
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
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
    createdAt: now,
    attemptCount: 0,
    consumedAt: null,
  });

  return { id, expiresAt };
}
async function consumeChallenge(
  id: string,
  value: string,
  purpose: 'registration' | 'authentication' | 'discoverable_authentication',
  sessionBinding?: string,
) {
  const now = new Date();
  const [updated] = await db
    .update(accountWebAuthnChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(accountWebAuthnChallenges.id, id),
        eq(accountWebAuthnChallenges.purpose, purpose),
        eq(accountWebAuthnChallenges.challengeHash, hashChallenge(value)),
        ...(sessionBinding ? [eq(accountWebAuthnChallenges.sessionBinding, sessionBinding)] : []),
        isNull(accountWebAuthnChallenges.consumedAt),
        gt(accountWebAuthnChallenges.expiresAt, now),
      ),
    )
    .returning();

  if (updated) return updated;
  const [existing] = await db
    .select()
    .from(accountWebAuthnChallenges)
    .where(eq(accountWebAuthnChallenges.id, id))
    .limit(1);

  if (!existing || existing.purpose !== purpose) failure('challenge_mismatch', 400);
  if (existing.consumedAt) failure('challenge_replayed', 409);
  if (existing.expiresAt <= now) failure('challenge_expired', 410);
  failure('challenge_mismatch', 400);
}
async function loginPasskey(
  req: Parameters<typeof authedRequest>[0],
  res: Response,
  user: typeof users.$inferSelect,
  accountId: string,
  credentialId: string,
) {
  const authUser = await resolveAuthUserForAccount(user, accountId);
  const authenticatedUser = { ...authUser, authority: 'full' as const, credentialId };

  await new Promise<void>((resolve, reject) =>
    req.login(authenticatedUser, (error) => (error ? reject(error) : resolve())),
  );
  req.session.authority = 'full';
  req.session.authenticatedAt = Date.now();
  req.session.cookie.maxAge = env.SESSION_MAX_AGE_MS;
  delete req.session.restrictedAuth;
  setSessionHintCookie(res);

  return authenticatedUser;
}

const passkeyRouter = Router();

passkeyRouter.use(csrfProtection);
passkeyRouter.use(passkeyRateLimit);

passkeyRouter.post('/registration/begin', validateRequest({ body: registrationBeginSchema }), async (req, res) => {
  const { label } = getValidated<{ body: typeof registrationBeginSchema }>(req).body!;

  if (!req.isAuthenticated() || !req.session?.authority) {
    failure('restricted_session_required', 401, 'Verify the email before registering a passkey.');
  }
  if (req.session.authority === 'full') requireFreshSecurityReauthentication(req);
  const session = requireRestrictedSession(req);
  const user = await findUserByEmail(session.email);

  if (!user) failure(PASSKEY_ACCOUNT_UNAVAILABLE, 404);
  if (!user.emailVerifiedAt) failure('email_unverified', 403, 'Verify the email address before using a passkey.');
  const enrollment = await createPasskeyEnrollment(session.email, session.accountId, user);
  const membership = enrollment.membership;
  const enrollmentId = enrollment.enrollmentId;

  const existing = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, membership.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    );
  const challenge = randomBytes(32).toString('base64url');
  const options = await generateRegistrationOptions({
    rpName: 'Visomi Stack',
    rpID: rpId,
    userName: user.email,
    userID: Buffer.from(user.id),
    challenge,
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: existing.map((item) => ({ id: item.credentialId, transports: item.transports as never[] })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
  });
  const stored = await createChallenge(membership.accountId, user.id, 'registration', options.challenge, req.sessionID);

  if (req.session)
    req.session.passkeyRegistration = {
      accountId: membership.accountId,
      challengeId: stored.id,
      email: user.email,
      label,
      ...(enrollmentId ? { enrollmentId } : {}),
    };
  res.json({
    data: { challengeId: stored.id, verificationChallengeId: null, enrollmentId, options },
    message: 'Passkey registration options created.',
  });
});

passkeyRouter.post(
  '/registration/complete',
  validateRequest({ body: registrationCompleteSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof registrationCompleteSchema }>(req).body!;
    const pending = req.session?.passkeyRegistration;

    if (!pending || pending.challengeId !== body.challengeId) failure('challenge_mismatch', 400);
    const user = await findUserByEmail(pending.email);

    if (!user) failure(PASSKEY_ACCOUNT_UNAVAILABLE, 404);
    if (req.user?.id !== user.id || req.user.accountId !== pending.accountId) failure('challenge_mismatch', 400);
    const [challenge] = await db
      .select()
      .from(accountWebAuthnChallenges)
      .where(eq(accountWebAuthnChallenges.id, body.challengeId))
      .limit(1);

    if (!challenge) failure('challenge_mismatch', 400);
    let verified;

    try {
      verified = await verifyRegistrationResponse({
        response: body.response as never,
        expectedChallenge: (candidate) => hashChallenge(candidate) === challenge.challengeHash,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserPresence: true,
        requireUserVerification: true,
      });
    } catch {
      failure('platform_error', 400);
    }
    if (!verified.verified) failure('platform_error', 400);
    const credential = verified.registrationInfo.credential;
    const value = {
      id: randomUUID(),
      accountId: pending.accountId,
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      rpId,
      label: pending.label,
      transports: body.response.response.transports ?? [],
      signCount: credential.counter,
      backupEligible: verified.registrationInfo.credentialDeviceType === 'multiDevice',
      backupState: verified.registrationInfo.credentialBackedUp,
      status: 'pending',
      enrollmentFlowId: pending.enrollmentId ?? null,
      createdAt: new Date(),
      activatedAt: null,
      lastUsedAt: null,
      revokedAt: null,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      const now = new Date();
      const [consumed] = await tx
        .update(accountWebAuthnChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(accountWebAuthnChallenges.id, body.challengeId),
            eq(accountWebAuthnChallenges.purpose, 'registration'),
            eq(accountWebAuthnChallenges.challengeHash, hashChallenge(decodeChallengeFromResponse(body.response))),
            eq(accountWebAuthnChallenges.sessionBinding, req.sessionID),
            isNull(accountWebAuthnChallenges.consumedAt),
            gt(accountWebAuthnChallenges.expiresAt, now),
          ),
        )
        .returning();

      if (!consumed) failure('challenge_mismatch', 400);
      await tx.insert(accountPasskeyCredentials).values(value);
      if (pending.enrollmentId) {
        const [linked] = await tx
          .update(accountPasskeyEnrollments)
          .set({
            credentialId: credential.id,
            updatedAt: now,
            status: 'pending',
            activatedAt: null,
          })
          .where(eq(accountPasskeyEnrollments.id, pending.enrollmentId))
          .returning();

        if (!linked) throw new Error('Passkey enrollment linkage failed.');
      }
    });
    const verificationOptions = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      timeout: 60000,
      challenge: randomBytes(32).toString('base64url'),
      allowCredentials: [{ id: credential.id, transports: credential.transports as never[] }],
    });
    const verification = await createChallenge(
      pending.accountId,
      user.id,
      'authentication',
      verificationOptions.challenge,
      req.sessionID,
      { credentialId: credential.id, flowId: pending.enrollmentId },
    );

    res.status(201).json({
      data: {
        credential: credentialView(value),
        restrictedSession: {
          kind: 'restricted' as const,
          user: await resolveAuthUserForAccount(user, pending.accountId),
          verificationOptions,
          verificationChallengeId: verification.id,
        },
      },
      message: 'Passkey registered.',
    });
  },
);

function decodeChallengeFromResponse(response: { response: { clientDataJSON: string } }): string {
  try {
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')) as {
      challenge?: string;
    };

    if (!data.challenge) failure('challenge_mismatch', 400);

    return data.challenge;
  } catch {
    failure('challenge_mismatch', 400);
  }
}

passkeyRouter.post('/authentication/begin', validateRequest({ body: authenticationBeginSchema }), async (req, res) => {
  const { email: requestedEmail, retryRequested } = getValidated<{
    body: typeof authenticationBeginSchema;
  }>(req).body!;

  if (!requestedEmail) {
    const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required', timeout: 60000 });
    const stored = await createChallenge(null, null, 'discoverable_authentication', options.challenge, req.sessionID);

    res.json({
      data: { challengeId: stored.id, options, attempt: nextPasskeyAttempt({ retryRequested }) },
      message: 'Passkey authentication options created.',
    });

    return;
  }
  const email = requestedEmail;
  const { user, membership } = await requireVerifiedEmail(email);

  const credentials = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, membership.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    );

  if (!credentials.length) failure(PASSKEY_ACCOUNT_UNAVAILABLE, 404);
  const challenge = randomBytes(32).toString('base64url');
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    timeout: 60000,
    challenge,
    allowCredentials: credentials.map((item) => ({ id: item.credentialId, transports: item.transports as never[] })),
  });
  const stored = await createChallenge(
    membership.accountId,
    user.id,
    'authentication',
    options.challenge,
    req.sessionID,
  );

  res.json({
    data: { challengeId: stored.id, options, attempt: nextPasskeyAttempt({ retryRequested }) },
    message: 'Passkey authentication options created.',
  });
});

passkeyRouter.post(
  ['/authentication/complete', '/registration/verify'],
  validateRequest({ body: authenticationCompleteSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof authenticationCompleteSchema }>(req).body!;

    if (req.path === '/registration/verify' && req.session?.authority !== 'restricted') {
      failure('restricted_session_required', 401);
    }
    const [pending] = await db
      .select()
      .from(accountWebAuthnChallenges)
      .where(eq(accountWebAuthnChallenges.id, body.challengeId))
      .limit(1);
    const challenge = pending;

    if (!challenge) failure('challenge_mismatch', 400);
    const [credential] = await db
      .select()
      .from(accountPasskeyCredentials)
      .where(eq(accountPasskeyCredentials.credentialId, body.response.id))
      .limit(1);

    if (
      !credential ||
      (challenge.userId && (credential.accountId !== challenge.accountId || credential.userId !== challenge.userId))
    )
      failure('credential_not_found', 401);
    if (credential.revokedAt) failure('credential_revoked', 401);
    const verifiesRegistration = req.path === '/registration/verify';
    const enrollmentId = challenge.flowId;

    if (verifiesRegistration && (credential.status !== 'pending' || challenge.credentialId !== credential.credentialId))
      failure('credential_not_found', 401);
    if (!verifiesRegistration && credential.status !== 'active') {
      failure('credential_not_found', 401);
    }
    let verified;

    try {
      verified = await verifyAuthenticationResponse({
        response: body.response as never,
        expectedChallenge: (candidate) => hashChallenge(candidate) === challenge.challengeHash,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.signCount,
        } as unknown as WebAuthnCredential,
      });
    } catch {
      failure('platform_error', 401);
    }
    if (!verified.verified) failure('platform_error', 401);
    if (verified.authenticationInfo.newCounter < credential.signCount) failure('sign_count_regression', 401);
    const now = new Date();
    const responseChallenge = decodeChallengeFromResponse(body.response);

    if (verifiesRegistration) {
      if (!enrollmentId) failure('credential_not_found', 401);

      await db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(accountWebAuthnChallenges)
          .set({ consumedAt: now, updatedAt: now })
          .where(
            and(
              eq(accountWebAuthnChallenges.id, body.challengeId),
              eq(accountWebAuthnChallenges.purpose, 'authentication'),
              eq(accountWebAuthnChallenges.challengeHash, hashChallenge(responseChallenge)),
              eq(accountWebAuthnChallenges.sessionBinding, req.sessionID),
              eq(accountWebAuthnChallenges.credentialId, credential.credentialId),
              isNull(accountWebAuthnChallenges.consumedAt),
              gt(accountWebAuthnChallenges.expiresAt, now),
            ),
          )
          .returning();
        const [activated] = await tx
          .update(accountPasskeyEnrollments)
          .set({ status: 'active', activatedAt: now, updatedAt: now })
          .where(
            and(
              eq(accountPasskeyEnrollments.id, enrollmentId),
              eq(accountPasskeyEnrollments.accountId, credential.accountId),
              eq(accountPasskeyEnrollments.userId, credential.userId),
              eq(accountPasskeyEnrollments.credentialId, credential.credentialId),
              eq(accountPasskeyEnrollments.status, 'pending'),
            ),
          )
          .returning();

        if (!consumed || !activated) failure('challenge_mismatch', 400);
        const [activatedCredential] = await tx
          .update(accountPasskeyCredentials)
          .set({
            signCount: verified.authenticationInfo.newCounter,
            lastUsedAt: now,
            updatedAt: now,
            status: 'active',
            activatedAt: now,
          })
          .where(and(eq(accountPasskeyCredentials.id, credential.id), eq(accountPasskeyCredentials.status, 'pending')))
          .returning();

        if (!activatedCredential) failure('challenge_mismatch', 400);
      });
      delete req.session.passkeyRegistration;
    } else {
      await consumeChallenge(
        body.challengeId,
        responseChallenge,
        challenge.purpose as 'authentication' | 'discoverable_authentication',
        req.sessionID,
      );
      await db
        .update(accountPasskeyCredentials)
        .set({ signCount: verified.authenticationInfo.newCounter, lastUsedAt: now, updatedAt: now })
        .where(eq(accountPasskeyCredentials.id, credential.id));
    }
    const user = await findUserById(credential.userId);

    if (!user) failure('credential_not_found', 401);
    const wasAuthenticated = req.isAuthenticated() && req.user?.id === user.id;
    const authUser = await loginPasskey(req, res, user, credential.accountId, credential.credentialId);

    if (wasAuthenticated) req.session.passkeySecurityReauthenticatedAt = Date.now();

    res.json({ data: { authenticated: true, user: authUser }, message: 'Passkey authentication complete.' });
  },
);

passkeyRouter.use('/credentials', authed({ authority: 'full' }));
passkeyRouter.get('/credentials', async (req, res) => {
  const user = authedRequest(req).user;
  const values = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(and(eq(accountPasskeyCredentials.accountId, user.accountId), eq(accountPasskeyCredentials.userId, user.id)));

  res.json({
    data: { credentials: values.filter((value) => !value.revokedAt).map(credentialView) },
    message: 'Passkeys retrieved.',
  });
});
passkeyRouter.patch(
  '/credentials/:credentialId',
  validateRequest({ params: credentialIdPathSchema, body: credentialMutationSchema }),
  async (req, res) => {
    const user = authedRequest(req).user;
    const credentialId = pathCredentialId(req);
    const body = getValidated<{ body: typeof credentialMutationSchema }>(req).body!;

    requireFreshSecurityReauthentication(req);
    if ('label' in body) {
      const [conflict] = await db
        .select({ id: accountPasskeyCredentials.id })
        .from(accountPasskeyCredentials)
        .where(
          and(
            eq(accountPasskeyCredentials.accountId, user.accountId),
            eq(accountPasskeyCredentials.label, body.label),
            ne(accountPasskeyCredentials.credentialId, credentialId),
            isNull(accountPasskeyCredentials.revokedAt),
          ),
        )
        .limit(1);

      if (conflict) failure('credential_name_conflict', 409, 'Choose a different passkey name.');
      const [value] = await db
        .update(accountPasskeyCredentials)
        .set({ label: body.label, updatedAt: new Date() })
        .where(
          and(
            eq(accountPasskeyCredentials.accountId, user.accountId),
            eq(accountPasskeyCredentials.userId, user.id),
            eq(accountPasskeyCredentials.credentialId, credentialId),
            isNull(accountPasskeyCredentials.revokedAt),
          ),
        )
        .returning();

      if (!value) failure('credential_not_found', 404);
      delete req.session?.passkeySecurityReauthenticatedAt;
      res.json({ data: credentialView(value), message: 'Passkey renamed.' });

      return;
    }
    const revoked = await revokeCredential(req, credentialId);

    if (revoked) {
      res.json({ data: credentialView(revoked), message: 'Passkey revoked.' });
    } else {
      res.status(204).send();
    }
  },
);
passkeyRouter.delete(
  '/credentials/:credentialId',
  validateRequest({ params: credentialIdPathSchema }),
  async (req, res) => {
    requireFreshSecurityReauthentication(req);
    await revokeCredential(req, pathCredentialId(req));
    res.status(204).send();
  },
);

function pathCredentialId(req: Parameters<typeof authedRequest>[0]): string {
  const value = req.params.credentialId;

  return typeof value === 'string' ? value : (value[0] ?? '');
}

async function revokeCredential(
  req: Parameters<typeof authedRequest>[0],
  credentialId: string,
): Promise<typeof accountPasskeyCredentials.$inferSelect | null> {
  const user = authedRequest(req).user;
  const active = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, user.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        eq(accountPasskeyCredentials.credentialId, credentialId),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    )
    .limit(1);

  if (!active.length) return null;
  const activeCredentials = await db
    .select({ id: accountPasskeyCredentials.id })
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, user.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    );

  if (activeCredentials.length <= 1)
    failure('last_access_method', 409, 'Keep another active passkey before revoking this credential.');
  await db
    .update(accountPasskeyCredentials)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, user.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        eq(accountPasskeyCredentials.credentialId, credentialId),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    );
  delete req.session?.passkeySecurityReauthenticatedAt;

  return { ...active[0], revokedAt: new Date(), updatedAt: new Date() };
}

export { PASSKEY_ACCOUNT_UNAVAILABLE, passkeyOpenApiPaths, passkeyRouter };
