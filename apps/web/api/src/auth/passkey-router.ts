import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { Router } from 'express';

import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authenticatedMutation, restrictedOperation } from './auth-middleware';
import { APP_NAME } from './auth-brand';
import { createPasskeyEnrollment, findUserByEmail, findUserById, resolveAuthUserForAccount } from './auth-identity';
import { clientContextHash } from './auth-service';
import {
  authenticationBeginSchema,
  authenticationCompleteSchema,
  passkeyOpenApiPaths,
  registrationBeginSchema,
  registrationCompleteSchema,
} from './passkey-schemas';
import { nextPasskeyAttempt } from './passkey-contract';
import { passkeyCredentialsRouter } from './passkey-credentials-router';
import {
  createChallenge,
  credentialView,
  failure,
  hashChallenge,
  loginPasskey,
  origin,
  PASSKEY_ACCOUNT_UNAVAILABLE,
  requireFreshSecurityReauthentication,
  requireRestrictedSession,
  requireVerifiedEmail,
  rpId,
} from './passkey-ceremony';
import { csrfProtection, passkeyRateLimit } from './passkey-security';
import { passkeySignupRouter } from './passkey-signup';
import { authorizePasskeyAssertion } from './passkey-authorization';

import {
  accountPasskeyCredentials,
  accountPasskeyEnrollments,
  accounts,
  accountWebAuthnChallenges,
  authEnrollmentGrants,
  db,
  users,
} from 'shared';

const passkeyRouter = Router();

passkeyRouter.use(csrfProtection);
passkeyRouter.use(passkeyRateLimit);
passkeyRouter.use(authenticatedMutation);
passkeyRouter.use('/sign-up', passkeySignupRouter);
passkeyRouter.use('/registration', (req, res, next) => {
  if (req.isAuthenticated?.() && req.user?.authority === 'restricted') {
    return restrictedOperation(req.path === '/verify' ? 'passkeys:verify' : 'passkeys:enroll')(req, res, next);
  }
  next();
});

passkeyRouter.post('/registration/begin', validateRequest({ body: registrationBeginSchema }), async (req, res) => {
  const { label } = getValidated<{ body: typeof registrationBeginSchema }>(req).body!;

  if (!req.isAuthenticated() || !req.session?.authority) {
    failure('restricted_session_required', 401, 'Verify the email before registering a passkey.');
  }
  const session = requireRestrictedSession(req);
  let approvedDeviceEnrollment = false;
  const requiresEnrollmentGrant =
    req.session.authority === 'restricted' && req.session.restrictedAuth?.isNewUser !== true;

  if (requiresEnrollmentGrant && !req.session.enrollmentGrantId) {
    failure('enrollment_grant_required', 401, 'Authorize recovery before enrolling a passkey.');
  }
  if (req.session.enrollmentGrantId) {
    const sessionHash = clientContextHash(req.sessionID, req.get('user-agent'));
    const [grant] = await db
      .select()
      .from(authEnrollmentGrants)
      .where(
        and(
          eq(authEnrollmentGrants.id, req.session.enrollmentGrantId),
          eq(authEnrollmentGrants.userId, session.userId),
          eq(authEnrollmentGrants.accountId, session.accountId),
          eq(authEnrollmentGrants.requesterSessionHash, sessionHash),
          isNull(authEnrollmentGrants.consumedAt),
          isNull(authEnrollmentGrants.revokedAt),
          gt(authEnrollmentGrants.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!grant) failure('enrollment_grant_unavailable', 401, 'The enrollment authorization has expired.');
    approvedDeviceEnrollment =
      grant.source === 'device_approval' ||
      grant.source === 'password_enrollment' ||
      grant.source === 'identity_enrollment';
  }
  if (req.session.authority === 'full' && !approvedDeviceEnrollment) requireFreshSecurityReauthentication(req);
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
        eq(accountPasskeyCredentials.status, 'active'),
        isNull(accountPasskeyCredentials.revokedAt),
      ),
    );
  const challenge = randomBytes(32).toString('base64url');
  const options = await generateRegistrationOptions({
    rpName: APP_NAME,
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

      // Match activation and account security mutations: account → user → flow → challenge.
      await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, pending.accountId)).for('update');
      const [currentUser] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');

      if (
        !currentUser ||
        currentUser.authVersion !== (req.user?.authVersion ?? 1) ||
        currentUser.email !== pending.email
      )
        failure('authentication_required', 401);
      if (pending.enrollmentId) {
        const [flow] = await tx
          .select()
          .from(accountPasskeyEnrollments)
          .where(eq(accountPasskeyEnrollments.id, pending.enrollmentId))
          .for('update');

        if (
          !flow ||
          flow.userId !== user.id ||
          flow.accountId !== pending.accountId ||
          flow.status !== 'pending' ||
          flow.terminalAt ||
          flow.expiresAt <= now
        )
          failure('challenge_mismatch', 400);
      }
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

    const authUser = await resolveAuthUserForAccount(user, pending.accountId);

    res.status(201).json({
      data: {
        credential: credentialView(value),
        restrictedSession: {
          kind: 'restricted' as const,
          user: authUser,
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
      data: {
        challengeId: stored.id,
        expiresAt: stored.expiresAt.toISOString(),
        options,
        attempt: nextPasskeyAttempt({ retryRequested }),
      },
      message: 'Passkey authentication options created.',
    });

    return;
  }
  const email = requestedEmail;
  const currentAccountId =
    req.session?.authority === 'full' && req.user?.email.toLowerCase() === email.toLowerCase()
      ? req.user.accountId
      : undefined;
  const { user, membership } = await requireVerifiedEmail(email, currentAccountId);

  const credentials = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(
      and(
        eq(accountPasskeyCredentials.accountId, membership.accountId),
        eq(accountPasskeyCredentials.userId, user.id),
        eq(accountPasskeyCredentials.status, 'active'),
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
    data: {
      challengeId: stored.id,
      expiresAt: stored.expiresAt.toISOString(),
      options,
      attempt: nextPasskeyAttempt({ retryRequested }),
    },
    message: 'Passkey authentication options created.',
  });
});

passkeyRouter.post(
  ['/authentication/complete', '/registration/verify'],
  validateRequest({ body: authenticationCompleteSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof authenticationCompleteSchema }>(req).body!;

    if (
      req.path === '/registration/verify' &&
      req.session?.authority !== 'restricted' &&
      req.session?.authority !== 'full'
    ) {
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
    const requiresEnrollmentGrant =
      verifiesRegistration && req.session?.authority === 'restricted' && req.session.restrictedAuth?.isNewUser !== true;
    const enrollmentGrantId = req.session?.enrollmentGrantId;

    if (requiresEnrollmentGrant && !enrollmentGrantId) failure('enrollment_grant_required', 401);

    if (verifiesRegistration && (credential.status !== 'pending' || challenge.credentialId !== credential.credentialId))
      failure('credential_not_found', 401);
    if (!verifiesRegistration && credential.status !== 'active') {
      failure('credential_not_found', 401);
    }
    const proofUser = await findUserById(credential.userId);

    if (!proofUser) failure('credential_not_found', 401);
    if (verifiesRegistration && (req.user?.id !== credential.userId || req.user.accountId !== credential.accountId))
      failure('credential_not_found', 401);
    if (verifiesRegistration && req.session?.authority === 'full' && !enrollmentGrantId)
      requireFreshSecurityReauthentication(req);
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
    const responseChallenge = decodeChallengeFromResponse(body.response);

    if (verifiesRegistration && !enrollmentId) failure('credential_not_found', 401);
    const user = await authorizePasskeyAssertion({
      credential,
      user: proofUser,
      challengeId: body.challengeId,
      challengeHash: hashChallenge(responseChallenge),
      sessionBinding: req.sessionID,
      newCounter: verified.authenticationInfo.newCounter,
      ...(verifiesRegistration
        ? {
            registration: {
              enrollmentId: enrollmentId!,
              authVersion: req.user?.authVersion ?? 1,
              grantId: enrollmentGrantId,
              requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
              requiresGrant: requiresEnrollmentGrant,
            },
          }
        : {}),
    });

    if (verifiesRegistration) {
      delete req.session.passkeyRegistration;
      delete req.session.enrollmentGrantId;
    }
    const wasAuthenticated = req.isAuthenticated() && req.user?.id === user.id;

    if (wasAuthenticated && req.user?.accountId !== credential.accountId) failure('credential_not_found', 401);
    const authUser = await loginPasskey(req, res, user, credential.accountId, credential.credentialId);

    if (wasAuthenticated && !verifiesRegistration) req.session.passkeySecurityReauthenticatedAt = Date.now();

    res.json({ data: { authenticated: true, user: authUser }, message: 'Passkey authentication complete.' });
  },
);

passkeyRouter.use(passkeyCredentialsRouter);

export { PASSKEY_ACCOUNT_UNAVAILABLE, passkeyOpenApiPaths, passkeyRouter };
