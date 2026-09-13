import { createHmac, randomUUID } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';
import { Router, type Request } from 'express';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';

import { getValidated, validateRequest } from '../shared/http/route-schemas';
import { env } from '../shared/env';

import { authed, authedRequest } from './auth-middleware';
import { generateVerificationPin, hashSecret, verifySecret } from './auth-crypto';
import { establishFullSession } from './auth-session';
import { sendRecoveryNotification } from './auth-mail';
import {
  clientContextHash,
  findUserById,
  requestEmailOtp,
  resendEmailOtp,
  verifyEmailOtp,
  createRecoveryChallenge,
  normalizeEmail,
  findUserByEmail,
  findOrCreateUserByEmail,
  resolveAuthUserForAccount,
  consumeChallenge,
  markChallengeConsumed,
  listMembershipsForUser,
  startPasswordSignIn,
  startPasswordSignUp,
  verifyPasswordSignUp,
  startPasswordReset,
  completePasswordReset,
  verifyPasswordEmailOtp,
  verifyPasswordTotp,
  setUserPassword,
  consumeRecoveryCode,
  replaceRecoveryCodes,
  createOperationGrant,
  consumeOperationGrant,
} from './auth-service';
import {
  authOpenApiPaths,
  emailOtpRequestSchema,
  emailOtpResendSchema,
  emailOtpVerifySchema,
  restrictedAccountSelectSchema,
  identityIdentifySchema,
  identityStatusSchema,
  recoveryVerifySchema,
  googleCompleteSchema,
  passwordSignInSchema,
  passwordVerifySchema,
  passwordResendSchema,
  passwordSignUpSchema,
  passwordSignUpVerifySchema,
  passwordResetRequestSchema,
  passwordResetCompleteSchema,
  passwordSetSchema,
  passwordSetResponseSchema,
  totpConfirmSchema,
  approvalCreateSchema,
  approvalIdSchema,
  approvalConsumeSchema,
  securityIdentityPathSchema,
  securityDevicePathSchema,
  passwordChangeSchema,
  passwordRemoveSchema,
  reauthStartSchema,
  reauthCompleteSchema,
  operationGrantSchema,
  googleLinkSchema,
} from './auth-schemas';
import {
  consumePasswordRateLimit,
  csrfProtection,
  emailOtpDeliveryRateLimit,
  emailOtpVerificationRateLimit,
} from './passkey-security';
import { clearSessionHintCookie, setSessionHintCookie } from './session-cookie';
import { assertPasswordAuthenticationAvailable, verifyPassword } from './password';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpCode } from './totp';

import {
  HttpError,
  httpResponse,
  authAuditEvents,
  authIdentityFlows,
  userFederatedIdentities,
  authVerificationChallenges,
  authDeviceApprovalRequests,
  authEnrollmentGrants,
  accountPasskeyCredentials,
  userDevices,
  userTotpEnrollments,
  authOperationGrants,
  users,
  db,
} from 'shared';

const router = Router();
const FLOW_TTL_MS = 15 * 60_000;

function flowHash(email: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(normalizeEmail(email)).digest('hex');
}

async function identityFlow(req: Request, id: string) {
  const [flow] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, id)).limit(1);

  if (!flow || flow.sessionBinding !== req.sessionID || flow.expiresAt <= new Date() || flow.terminalAt)
    throw new HttpError({
      code: 'identity_flow_unavailable',
      message: 'The identity flow is no longer available.',
      statusCode: 410,
    });

  return flow;
}

async function establishRestrictedSession(
  req: Request,
  flowId: string,
  identity: Awaited<ReturnType<typeof verifyEmailOtp>>,
) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 15 * 60_000;

  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  const restrictedAuth = {
    allowedOperations: ['accounts:read', 'accounts:select', 'passkeys:enroll', 'passkeys:verify', 'password:set'],
    eligibleAccounts: identity.accounts,
    expiresAt,
    flowId,
    issuedAt,
    isNewUser: identity.isNewUser,
    purpose: 'bootstrap_recovery' as const,
    selectedAccountId: identity.accounts.length === 1 ? identity.accounts[0]?.accountId : undefined,
    userId: identity.userId,
    verifiedEmail: identity.email,
  };
  const selectedAccountId = restrictedAuth.selectedAccountId;

  if (selectedAccountId) {
    const user = await findUserById(identity.userId);

    if (user) {
      const authUser = {
        ...(await resolveAuthUserForAccount(user, selectedAccountId)),
        authority: 'restricted' as const,
      };

      await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    }
  }
  req.session.restrictedAuth = restrictedAuth;
  req.session.authority = 'restricted';
  req.session.cookie.maxAge = 15 * 60_000;

  return expiresAt;
}

router.post('/identity/start', csrfProtection, async (req, res) => {
  const now = new Date();
  const id = randomUUID();
  const nonce = randomUUID();

  await db.insert(authIdentityFlows).values({
    id,
    state: 'passkey',
    expiresAt: new Date(now.getTime() + FLOW_TTL_MS),
    sessionBinding: req.sessionID,
    createdAt: now,
    updatedAt: now,
  });
  req.session.identityFlowId = id;
  req.session.googleNonce = nonce;
  httpResponse.json(res, {
    data: {
      flowId: id,
      state: 'passkey',
      google: { enabled: Boolean(env.GOOGLE_AUTH_CLIENT_ID), clientId: env.GOOGLE_AUTH_CLIENT_ID || null },
      nonce,
    },
    status: 201,
    message: 'Identity flow created.',
  });
});

router.post(
  '/device-approval/request',
  csrfProtection,
  authed(),
  validateRequest({ body: approvalCreateSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { accountId } = getValidated<{ body: typeof approvalCreateSchema }>(req).body!;

    if (current.accountId !== accountId)
      throw new HttpError({ code: 'account_unavailable', message: 'The account is not available.', statusCode: 404 });
    const userCode = generateVerificationPin();
    const now = new Date();
    const requestId = randomUUID();

    await db.insert(authDeviceApprovalRequests).values({
      id: requestId,
      userCodeHash: await hashSecret(userCode),
      requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
      userId: current.id,
      accountId,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      createdAt: now,
      updatedAt: now,
    });
    httpResponse.json(res, {
      data: { requestId, userCode, expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString() },
      status: 201,
      message: 'Device approval request created.',
    });
  },
);

router.post(
  '/device-approval/status',
  csrfProtection,
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const [request] = await db
      .select()
      .from(authDeviceApprovalRequests)
      .where(eq(authDeviceApprovalRequests.id, requestId))
      .limit(1);

    if (
      !request ||
      request.requesterSessionHash !== clientContextHash(req.sessionID, req.get('user-agent')) ||
      request.expiresAt <= new Date()
    )
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 410,
      });
    httpResponse.json(res, {
      data: {
        requestId,
        status: request.consumedAt
          ? 'consumed'
          : request.deniedAt
            ? 'denied'
            : request.approvedAt
              ? 'approved'
              : 'pending',
        expiresAt: request.expiresAt.toISOString(),
      },
      message: 'Device approval status retrieved.',
    });
  },
);

router.post(
  '/device-approval/approve',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const current = authedRequest(req).user;

    if (
      !req.session.passkeySecurityReauthenticatedAt ||
      Date.now() - req.session.passkeySecurityReauthenticatedAt > 10 * 60_000
    )
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'Confirm an existing passkey before approving a device.',
        statusCode: 401,
      });
    const [approved] = await db
      .update(authDeviceApprovalRequests)
      .set({ approvedAt: new Date(), approvalCredentialId: current.credentialId ?? null, updatedAt: new Date() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.accountId, current.accountId),
          isNull(authDeviceApprovalRequests.approvedAt),
          isNull(authDeviceApprovalRequests.consumedAt),
        ),
      )
      .returning();

    if (!approved)
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 409,
      });
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'device_approval',
      outcome: 'accepted',
      userId: current.id,
      accountId: current.accountId,
      contextHash: requestContext(req),
      createdAt: new Date(),
    });
    httpResponse.json(res, { data: { requestId, status: 'approved' }, message: 'Device approved.' });
  },
);

router.post(
  '/device-approval/consume',
  csrfProtection,
  validateRequest({ body: approvalConsumeSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof approvalConsumeSchema }>(req).body!;
    const [request] = await db
      .select()
      .from(authDeviceApprovalRequests)
      .where(
        and(
          eq(authDeviceApprovalRequests.id, body.requestId),
          eq(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.consumedAt),
        ),
      )
      .limit(1);

    if (
      !request ||
      !request.approvedAt ||
      request.expiresAt <= new Date() ||
      !(await verifySecret(body.userCode, request.userCodeHash))
    )
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 401,
      });
    const [consumed] = await db
      .update(authDeviceApprovalRequests)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(authDeviceApprovalRequests.id, request.id), isNull(authDeviceApprovalRequests.consumedAt)))
      .returning();

    if (!consumed)
      throw new HttpError({
        code: 'approval_replayed',
        message: 'The approval request was already consumed.',
        statusCode: 409,
      });
    const [grant] = await db
      .insert(authEnrollmentGrants)
      .values({
        id: randomUUID(),
        userId: request.userId,
        accountId: request.accountId,
        requesterSessionHash: request.requesterSessionHash,
        source: 'device_approval',
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
        createdAt: new Date(),
      })
      .returning();

    req.session.enrollmentGrantId = grant?.id;
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'device_approval_consumed',
      outcome: 'accepted',
      userId: request.userId,
      accountId: request.accountId,
      contextHash: request.requesterSessionHash,
      createdAt: new Date(),
    });
    httpResponse.json(res, {
      data: { requestId: request.id, accountId: request.accountId, userId: request.userId, grant: 'enrollment' },
      message: 'Device approval consumed.',
    });
  },
);

router.post(
  '/identity/identify',
  csrfProtection,
  validateRequest({ body: identityIdentifySchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof identityIdentifySchema }>(req).body!;
    const flow = await identityFlow(req, body.flowId);
    const user = await findUserByEmail(body.email);
    const now = new Date();
    const state = user ? 'authorize_existing_account' : 'verify_new_email';

    await db
      .update(authIdentityFlows)
      .set({ emailHash: flowHash(body.email), state, updatedAt: now })
      .where(eq(authIdentityFlows.id, flow.id));
    if (user)
      await db.insert(authAuditEvents).values({
        id: randomUUID(),
        event: 'identity_email_requested',
        outcome: 'accepted',
        userId: user.id,
        accountId: null,
        contextHash: requestContext(req),
        createdAt: now,
      });
    httpResponse.json(res, {
      data: { flowId: flow.id, state: 'identify' as const },
      status: 202,
      message: 'If the address can be used, a verification code has been sent.',
    });
  },
);

router.post('/identity/status', csrfProtection, validateRequest({ body: identityStatusSchema }), async (req, res) => {
  const body = getValidated<{ body: typeof identityStatusSchema }>(req).body!;
  const flow = await identityFlow(req, body.flowId);
  const state =
    flow.state === 'verify_new_email' || flow.state === 'authorize_existing_account' ? 'identify' : flow.state;

  httpResponse.json(res, {
    data: { flowId: flow.id, state, expiresAt: flow.expiresAt.toISOString() },
    message: 'Identity flow status retrieved.',
  });
});

router.post(
  '/identity/recovery/request',
  csrfProtection,
  validateRequest({ body: identityIdentifySchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof identityIdentifySchema }>(req).body!;
    const flow = await identityFlow(req, body.flowId);
    const user = await findUserByEmail(body.email);

    if (user && flow.state === 'authorize_existing_account' && flow.emailHash === flowHash(body.email)) {
      await createRecoveryChallenge(user, flow.id as `${string}-${string}-${string}-${string}-${string}`);
      await db
        .update(authIdentityFlows)
        .set({
          emailHash: flowHash(body.email),
          state: 'authorize_existing_account',
          authorizationMethod: 'email_recovery',
          updatedAt: new Date(),
        })
        .where(eq(authIdentityFlows.id, flow.id));
    } else if (!user && flow.state === 'verify_new_email' && flow.emailHash === flowHash(body.email)) {
      await requestEmailOtp(
        body.email,
        requestContext(req),
        flow.id as `${string}-${string}-${string}-${string}-${string}`,
      );
    }
    httpResponse.json(res, {
      data: { flowId: flow.id, state: 'identify' as const },
      status: 202,
      message: 'If the address can be recovered, a verification code has been sent.',
    });
  },
);

router.post(
  '/identity/recovery/verify',
  csrfProtection,
  validateRequest({ body: recoveryVerifySchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof recoveryVerifySchema }>(req).body!;
    const flow = await identityFlow(req, body.flowId);

    if (flow.state === 'verify_new_email') {
      const identity = await verifyEmailOtp(body.flowId, body.pin, requestContext(req));

      if (!identity.isNewUser)
        throw new HttpError({
          code: 'recovery_unavailable',
          message: 'The recovery request could not be completed.',
          statusCode: 401,
        });
      const expiresAt = await establishRestrictedSession(req, body.flowId, identity);

      httpResponse.json(res, {
        data: {
          kind: 'restricted' as const,
          flowId: body.flowId,
          authenticated: false as const,
          expiresAt: new Date(expiresAt).toISOString(),
          user: null,
          verifiedEmail: identity.email,
        },
        message: 'Email verified. Create and verify a passkey to finish signing in.',
      });

      return;
    }
    const [challenge] = await db
      .select()
      .from(authVerificationChallenges)
      .where(and(eq(authVerificationChallenges.id, body.flowId), isNull(authVerificationChallenges.consumedAt)))
      .limit(1);

    if (
      flow.state !== 'authorize_existing_account' ||
      flow.authorizationMethod !== 'email_recovery' ||
      !challenge ||
      challenge.purpose !== 'existing_account_recovery'
    )
      throw new HttpError({
        code: 'recovery_unavailable',
        message: 'The recovery request could not be completed.',
        statusCode: 401,
      });
    await consumeChallenge(body.flowId, body.pin);
    await markChallengeConsumed(body.flowId);
    if (!challenge.userId)
      throw new HttpError({
        code: 'recovery_unavailable',
        message: 'The recovery request could not be completed.',
        statusCode: 401,
      });
    const user = await findUserById(challenge.userId);

    if (!user)
      throw new HttpError({
        code: 'recovery_unavailable',
        message: 'The recovery request could not be completed.',
        statusCode: 401,
      });
    const memberships = await listMembershipsForUser(user.id);
    const selected = memberships[0];

    if (!selected)
      throw new HttpError({
        code: 'recovery_unavailable',
        message: 'The recovery request could not be completed.',
        statusCode: 401,
      });
    const authUser = {
      ...(await resolveAuthUserForAccount(user, selected.accountId)),
      authority: 'restricted' as const,
    };
    const expiresAt = Date.now() + FLOW_TTL_MS;

    await db
      .update(authEnrollmentGrants)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authEnrollmentGrants.userId, user.id),
          eq(authEnrollmentGrants.accountId, selected.accountId),
          isNull(authEnrollmentGrants.consumedAt),
          isNull(authEnrollmentGrants.revokedAt),
        ),
      );

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    req.session.authority = 'restricted';
    req.session.restrictedAuth = {
      allowedOperations: ['passkeys:enroll', 'passkeys:verify', 'password:set'],
      eligibleAccounts: memberships.map((membership) => ({
        accountId: membership.accountId,
        name: membership.accountId,
        role: membership.role,
      })),
      expiresAt,
      flowId: flow.id,
      issuedAt: Date.now(),
      isNewUser: false,
      purpose: 'existing_account_recovery',
      selectedAccountId: selected.accountId,
      userId: user.id,
      verifiedEmail: user.email,
    };
    const [grant] = await db
      .insert(authEnrollmentGrants)
      .values({
        id: randomUUID(),
        userId: user.id,
        accountId: selected.accountId,
        requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
        source: 'email_recovery',
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
        createdAt: new Date(),
      })
      .returning();

    req.session.enrollmentGrantId = grant?.id;
    await db
      .update(authIdentityFlows)
      .set({
        state: 'enroll_passkey',
        authorizationMethod: 'email_recovery',
        userId: user.id,
        accountId: selected?.accountId,
        updatedAt: new Date(),
      })
      .where(eq(authIdentityFlows.id, flow.id));
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'email_recovery_verified',
      outcome: 'accepted',
      userId: user.id,
      accountId: selected.accountId,
      contextHash: requestContext(req),
      createdAt: new Date(),
    });
    try {
      await sendRecoveryNotification(user.email);
    } catch {
      /* Recovery remains complete if notification delivery is unavailable. */
    }
    httpResponse.json(res, {
      data: {
        kind: 'restricted' as const,
        flowId: flow.id,
        authenticated: false as const,
        expiresAt: new Date(expiresAt).toISOString(),
        user: null,
        verifiedEmail: user.email,
      },
      message: 'Recovery verified. Create a new passkey to finish.',
    });
  },
);

router.get('/identity/providers', (_req, res) => {
  httpResponse.json(res, {
    data: {
      google: { enabled: Boolean(env.GOOGLE_AUTH_CLIENT_ID), clientId: env.GOOGLE_AUTH_CLIENT_ID || null },
      password: { enabled: env.AUTH_PASSWORD_ENABLED },
    },
    message: 'Authentication providers retrieved.',
  });
});

router.post(
  ['/password/sign-up', '/sign-up'],
  csrfProtection,
  validateRequest({ body: passwordSignUpSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof passwordSignUpSchema }>(req).body!;
    const pending = await startPasswordSignUp(body.email, body.password, requestContext(req), req.sessionID);

    await bindPasswordFlowToNewSession(req, pending.flowId);
    req.session.passwordFlowId = pending.flowId;
    req.session.cookie.maxAge = 10 * 60_000;
    httpResponse.json(res, { data: pending, status: 202, message: 'Check your email to verify your account.' });
  },
);

router.post(
  ['/password/sign-up/verify', '/sign-up/verify'],
  csrfProtection,
  validateRequest({ body: passwordSignUpVerifySchema }),
  async (req, res) => {
    assertPasswordAuthenticationAvailable();
    const body = getValidated<{ body: typeof passwordSignUpVerifySchema }>(req).body!;

    if (req.session.passwordFlowId !== body.flowId)
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password signup flow is unavailable.',
        statusCode: 401,
      });
    const identity = await verifyPasswordSignUp(body.flowId, body.code, requestContext(req), req.sessionID);
    const expiresAt = await establishRestrictedSession(req, body.flowId, identity);

    httpResponse.json(res, {
      data: {
        authenticated: false,
        kind: 'restricted',
        expiresAt: new Date(expiresAt).toISOString(),
        user: null,
        verifiedEmail: identity.email,
      },
      message: 'Email verified. Your account is ready for secure setup.',
    });
  },
);

router.post(
  ['/password/reset/request', '/password-reset/request'],
  csrfProtection,
  validateRequest({ body: passwordResetRequestSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof passwordResetRequestSchema }>(req).body!;
    const pending = await startPasswordReset(body.email, requestContext(req), req.sessionID);

    await bindPasswordFlowToNewSession(req, pending.flowId);
    req.session.passwordFlowId = pending.flowId;
    req.session.cookie.maxAge = 10 * 60_000;
    httpResponse.json(res, {
      data: pending,
      status: 202,
      message: 'If the account is eligible, a reset code has been sent.',
    });
  },
);

router.post(
  ['/password/reset/complete', '/password-reset/complete'],
  csrfProtection,
  validateRequest({ body: passwordResetCompleteSchema }),
  async (req, res) => {
    assertPasswordAuthenticationAvailable();
    const body = getValidated<{ body: typeof passwordResetCompleteSchema }>(req).body!;

    if (req.session.passwordFlowId !== body.flowId)
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password reset flow is unavailable.',
        statusCode: 401,
      });
    await completePasswordReset(
      body.flowId,
      body.emailCode,
      body.factor,
      body.password,
      requestContext(req),
      req.sessionID,
    );
    delete req.session.passwordFlowId;
    httpResponse.json(res, { data: { passwordReset: true }, message: 'Password reset completed. Sign in again.' });
  },
);

router.post(
  ['/password/sign-in', '/sign-in/password'],
  csrfProtection,
  validateRequest({ body: passwordSignInSchema }),
  async function passwordSignInHandler(req, res) {
    assertPasswordAuthenticationAvailable();
    let passwordLimit;

    try {
      passwordLimit = await consumePasswordRateLimit(req);
    } catch {
      throw new HttpError({
        code: 'auth_limiter_unavailable',
        message: 'Authentication is temporarily unavailable.',
        statusCode: 503,
      });
    }
    if (!passwordLimit.allowed)
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many password attempts; retry after the cooldown.',
        statusCode: 429,
        data: { retryAfter: passwordLimit.retryAfter },
      });
    const { email, password } = getValidated<{ body: typeof passwordSignInSchema }>(req).body!;
    const pending = await startPasswordSignIn(email, password, requestContext(req), req.sessionID);

    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    await db
      .update(authIdentityFlows)
      .set({ sessionBinding: req.sessionID, updatedAt: new Date() })
      .where(eq(authIdentityFlows.id, pending.flowId));
    req.session.passwordFlowId = pending.flowId;
    req.session.cookie.maxAge = 10 * 60_000;
    httpResponse.json(res, {
      data: pending,
      status: 202,
      message: 'Password accepted. Check your email for a verification code.',
    });
  },
);

router.post(
  ['/password/verify', '/sign-in/verify'],
  csrfProtection,
  validateRequest({ body: passwordVerifySchema }),
  async function passwordVerifyHandler(req, res) {
    assertPasswordAuthenticationAvailable();
    const body = getValidated<{ body: typeof passwordVerifySchema }>(req).body!;

    if (req.session.passwordFlowId !== body.flowId)
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password sign-in flow is unavailable.',
        statusCode: 401,
      });
    const result =
      body.kind === 'email'
        ? await verifyPasswordEmailOtp(body.flowId, body.code, requestContext(req), req.sessionID)
        : body.kind === 'totp'
          ? await verifyPasswordTotp(body.flowId, body.code, req.sessionID)
          : (() => {
              throw new HttpError({
                code: 'password_factor_invalid',
                message: 'The selected verification factor is not available.',
                statusCode: 401,
              });
            })();
    const { flow, user } = result;
    const membership = await resolveAuthUserForAccount(user, flow.accountId ?? undefined);
    const authUser = {
      ...membership,
      authority: 'full' as const,
      authenticationMethod: 'password' as const,
      secondFactor: body.kind,
      authVersion: user.authVersion,
    };

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    req.session.authority = 'full';
    req.session.authenticationMethod = 'password';
    req.session.secondFactor = body.kind;
    req.session.authVersion = user.authVersion;
    req.session.authenticatedAt = Date.now();
    req.session.cookie.maxAge = env.SESSION_MAX_AGE_MS;
    delete req.session.passwordFlowId;
    setSessionHintCookie(res);
    httpResponse.json(res, {
      data: { authenticated: true, user: authUser },
      message: 'Password authentication complete.',
    });
  },
);

router.post('/totp/setup', csrfProtection, authed({ authority: 'full' }), async function totpSetupHandler(req, res) {
  if (!env.AUTH_TOTP_ENROLLMENT_ENABLED)
    throw new HttpError({ code: 'totp_enrollment_disabled', message: 'TOTP enrollment is disabled.', statusCode: 404 });
  const current = authedRequest(req).user;

  if (
    !req.session.passkeySecurityReauthenticatedAt ||
    Date.now() - req.session.passkeySecurityReauthenticatedAt > 10 * 60_000
  )
    throw new HttpError({
      code: 'reauthentication_required',
      message: 'Reauthenticate before changing security settings.',
      statusCode: 401,
    });
  const secret = generateTotpSecret();
  const now = new Date();
  const enrollmentId = randomUUID();

  await db
    .update(userTotpEnrollments)
    .set({ status: 'revoked', updatedAt: now })
    .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'pending')));
  await db.insert(userTotpEnrollments).values({
    id: enrollmentId,
    userId: current.id,
    encryptedSecret: encryptTotpSecret(secret),
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    createdAt: now,
    updatedAt: now,
  });
  res.setHeader('Cache-Control', 'no-store');
  httpResponse.json(res, { data: { enrollmentId, secret }, status: 201, message: 'TOTP enrollment started.' });
});

router.post(
  '/totp/confirm',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: totpConfirmSchema }),
  async function totpConfirmHandler(req, res) {
    const current = authedRequest(req).user;
    const { enrollmentId, code } = getValidated<{ body: typeof totpConfirmSchema }>(req).body!;
    const [enrollment] = await db
      .select()
      .from(userTotpEnrollments)
      .where(
        and(
          eq(userTotpEnrollments.id, enrollmentId),
          eq(userTotpEnrollments.userId, current.id),
          eq(userTotpEnrollments.status, 'pending'),
        ),
      )
      .limit(1);

    if (!enrollment || enrollment.expiresAt <= new Date())
      throw new HttpError({
        code: 'totp_enrollment_unavailable',
        message: 'The TOTP enrollment is unavailable.',
        statusCode: 410,
      });
    let valid: boolean;

    try {
      valid = await verifyTotpCode(decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion), code);
    } catch {
      valid = false;
    }
    if (!valid)
      throw new HttpError({ code: 'totp_code_invalid', message: 'The TOTP code is invalid.', statusCode: 401 });
    await db.transaction(async (tx) => {
      await tx
        .update(userTotpEnrollments)
        .set({ status: 'active', confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(userTotpEnrollments.id, enrollment.id), eq(userTotpEnrollments.status, 'pending')));
      await tx
        .update(userTotpEnrollments)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(
          and(
            eq(userTotpEnrollments.userId, current.id),
            eq(userTotpEnrollments.status, 'active'),
            ne(userTotpEnrollments.id, enrollment.id),
          ),
        );
      await tx
        .update(users)
        .set({ authVersion: sql`${users.authVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, current.id));
    });
    req.session.authVersion = (current.authVersion ?? 1) + 1;
    const recoveryCodes = await replaceRecoveryCodes(current.id);

    delete req.session.passkeySecurityReauthenticatedAt;
    httpResponse.json(res, { data: { enabled: true, recoveryCodes }, message: 'TOTP enrollment confirmed.' });
  },
);

router.post(
  '/totp/disable',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: operationGrantSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { grantId } = getValidated<{ body: typeof operationGrantSchema }>(req).body!;

    await requireFullOperation(req, 'totp_disable', grantId);
    const [passkey] = await db
      .select({ id: accountPasskeyCredentials.id })
      .from(accountPasskeyCredentials)
      .where(
        and(
          eq(accountPasskeyCredentials.userId, current.id),
          eq(accountPasskeyCredentials.accountId, current.accountId),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      )
      .limit(1);
    const [federated] = await db
      .select({ id: userFederatedIdentities.id })
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.userId, current.id), isNull(userFederatedIdentities.revokedAt)))
      .limit(1);
    const user = await findUserById(current.id);

    if (!passkey && !federated && !user?.passwordHash)
      throw new HttpError({
        code: 'last_access_method',
        message: 'Keep another sign-in method before disabling TOTP.',
        statusCode: 409,
      });
    await db.transaction(async (tx) => {
      await tx
        .update(userTotpEnrollments)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'active')));
      await tx
        .update(users)
        .set({ authVersion: sql`${users.authVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, current.id));
    });
    res.status(204).send();
  },
);

router.post(
  '/google/link',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: googleLinkSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof googleLinkSchema }>(req).body!;

    await requireFullOperation(req, 'google_link', body.grantId);
    if (!env.GOOGLE_AUTH_CLIENT_ID || !req.session.googleNonce)
      throw new HttpError({ code: 'google_disabled', message: 'Google linking is not configured.', statusCode: 404 });
    let payload;

    try {
      payload = (
        await new OAuth2Client(env.GOOGLE_AUTH_CLIENT_ID).verifyIdToken({
          idToken: body.idToken,
          audience: env.GOOGLE_AUTH_CLIENT_ID,
        })
      ).getPayload();
    } catch {
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google identity could not be verified.',
        statusCode: 401,
      });
    }
    if (
      !payload?.sub ||
      payload.iss !== 'https://accounts.google.com' ||
      payload.nonce !== req.session.googleNonce ||
      !payload.email ||
      payload.email_verified !== true ||
      normalizeEmail(payload.email) !== normalizeEmail(current.email)
    )
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google identity could not be verified.',
        statusCode: 401,
      });
    const [existing] = await db
      .select()
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.issuer, payload.iss), eq(userFederatedIdentities.subject, payload.sub)))
      .limit(1);

    if (existing && existing.userId !== current.id)
      throw new HttpError({
        code: 'google_identity_in_use',
        message: 'This Google identity is already linked.',
        statusCode: 409,
      });
    if (existing)
      await db
        .update(userFederatedIdentities)
        .set({ revokedAt: null, emailAtLink: normalizeEmail(payload.email), lastUsedAt: new Date() })
        .where(eq(userFederatedIdentities.id, existing.id));
    else
      await db.insert(userFederatedIdentities).values({
        id: randomUUID(),
        provider: 'google',
        issuer: payload.iss,
        subject: payload.sub,
        userId: current.id,
        emailAtLink: normalizeEmail(payload.email),
      });
    delete req.session.googleNonce;
    httpResponse.json(res, { data: { linked: true }, message: 'Google identity linked.' });
  },
);

router.post(
  ['/password/resend', '/sign-in/resend'],
  csrfProtection,
  validateRequest({ body: passwordResendSchema }),
  async function passwordResendHandler(req, res) {
    assertPasswordAuthenticationAvailable();
    const { flowId } = getValidated<{ body: typeof passwordResendSchema }>(req).body!;

    if (req.session.passwordFlowId !== flowId)
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password sign-in flow is unavailable.',
        statusCode: 401,
      });
    const flow = await identityFlow(req, flowId);

    if (flow.requiredFactor !== 'email')
      throw new HttpError({
        code: 'password_factor_invalid',
        message: 'Email verification is not available for this sign-in flow.',
        statusCode: 409,
      });
    const challenge = await resendEmailOtp(flowId, requestContext(req));

    httpResponse.json(res, { data: challenge, status: 202, message: 'Password verification code resent.' });
  },
);

router.post(
  '/password/set',
  csrfProtection,
  validateRequest({ body: passwordSetSchema }),
  async function passwordSetHandler(req, res) {
    const restricted = req.session?.restrictedAuth;

    if (
      req.session?.authority !== 'restricted' ||
      req.user?.authority !== 'restricted' ||
      !restricted ||
      restricted.expiresAt <= Date.now() ||
      restricted.userId !== req.user.id ||
      !restricted.allowedOperations.includes('password:set')
    ) {
      throw new HttpError({
        code: 'restricted_session_required',
        message: 'Verify an email code before setting a password.',
        statusCode: 401,
      });
    }

    const { password } = getValidated<{ body: typeof passwordSetSchema }>(req).body!;

    await setUserPassword(restricted.userId, password);
    httpResponse.json(res, {
      data: passwordSetResponseSchema.parse({ passwordSet: true }),
      message: 'Password set successfully.',
    });
  },
);

function requireFullOperation(req: Request, purpose: string, grantId: string): Promise<void> {
  const current = authedRequest(req).user;

  if (req.session.authority !== 'full')
    throw new HttpError({ code: 'full_session_required', message: 'A full session is required.', statusCode: 403 });

  return consumeOperationGrant(grantId, current.id, purpose, req.sessionID).then((valid) => {
    if (!valid)
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'Reauthenticate before changing security settings.',
        statusCode: 401,
      });
  });
}

router.post(
  '/reauth/start',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: reauthStartSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { purpose } = getValidated<{ body: typeof reauthStartSchema }>(req).body!;
    const grantId = await createOperationGrant(current.id, purpose, req.sessionID);

    req.session.reauthGrantId = grantId;
    if (purpose === 'google_link') req.session.googleNonce = randomUUID();
    httpResponse.json(res, {
      data: { grantId, methods: ['passkey', 'password', 'totp', 'recovery_code'] },
      status: 201,
      message: 'Reauthentication started.',
    });
  },
);

router.post(
  '/reauth/complete',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: reauthCompleteSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof reauthCompleteSchema }>(req).body!;

    if (req.session.reauthGrantId !== body.grantId)
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'The reauthentication request is unavailable.',
        statusCode: 401,
      });
    let valid = Boolean(
      req.session.passkeySecurityReauthenticatedAt &&
      Date.now() - req.session.passkeySecurityReauthenticatedAt <= 10 * 60_000 &&
      body.method === 'passkey',
    );
    const user = await findUserById(current.id);

    if (!user) valid = false;
    if (body.method === 'password' && body.password && user?.passwordHash)
      valid = await verifyPassword(body.password, user.passwordHash);
    if (body.method === 'password' && user) {
      const [enrollment] = await db
        .select()
        .from(userTotpEnrollments)
        .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'active')))
        .limit(1);

      if (enrollment) {
        valid = false;
        if (body.code)
          valid =
            (await verifyPassword(body.password ?? '', user.passwordHash ?? '')) &&
            (await verifyTotpCode(decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion), body.code));
      }
    }
    if (body.method === 'totp' && body.code) {
      const [enrollment] = await db
        .select()
        .from(userTotpEnrollments)
        .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'active')))
        .limit(1);

      if (enrollment)
        valid = await verifyTotpCode(decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion), body.code);
    }
    if (body.method === 'recovery_code' && body.code) valid = await consumeRecoveryCode(current.id, body.code);
    if (!valid)
      throw new HttpError({
        code: 'reauthentication_failed',
        message: 'Reauthentication could not be completed.',
        statusCode: 401,
      });
    const [grant] = await db
      .update(authOperationGrants)
      .set({ createdAt: new Date() })
      .where(
        and(
          eq(authOperationGrants.id, body.grantId),
          eq(authOperationGrants.userId, current.id),
          isNull(authOperationGrants.consumedAt),
          gt(authOperationGrants.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!grant)
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'The reauthentication request is unavailable.',
        statusCode: 401,
      });
    httpResponse.json(res, {
      data: { grantId: body.grantId, authenticated: true },
      message: 'Reauthentication completed.',
    });
  },
);

router.post(
  '/recovery-codes/regenerate',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: operationGrantSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { grantId } = getValidated<{ body: typeof operationGrantSchema }>(req).body!;

    await requireFullOperation(req, 'recovery_codes_regenerate', grantId);
    const recoveryCodes = await replaceRecoveryCodes(current.id);

    httpResponse.json(res, { data: { recoveryCodes }, message: 'Recovery codes regenerated.' });
  },
);

router.post(
  '/password/change',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: passwordChangeSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof passwordChangeSchema }>(req).body!;

    await requireFullOperation(req, 'password_change', req.session.reauthGrantId ?? '');
    const user = await findUserById(current.id);

    if (!user?.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash)))
      throw new HttpError({ code: 'password_invalid', message: 'The current password is invalid.', statusCode: 401 });
    await setUserPassword(current.id, body.password);
    httpResponse.json(res, { data: { passwordChanged: true }, message: 'Password changed.' });
  },
);

router.post(
  '/password/remove',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: passwordRemoveSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;

    await requireFullOperation(req, 'password_remove', req.session.reauthGrantId ?? '');
    const user = await findUserById(current.id);

    if (!user?.passwordHash || !(await verifyPassword(req.body.currentPassword, user.passwordHash)))
      throw new HttpError({ code: 'password_invalid', message: 'The current password is invalid.', statusCode: 401 });
    await db
      .update(users)
      .set({
        passwordHash: null,
        passwordChangedAt: new Date(),
        authVersion: sql`${users.authVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, current.id));
    res.status(204).send();
  },
);

router.get('/security/overview', authed({ authority: 'full' }), async (req, res) => {
  const current = authedRequest(req).user;
  const [credentials, federated, devices, audit] = await Promise.all([
    db
      .select()
      .from(accountPasskeyCredentials)
      .where(
        and(
          eq(accountPasskeyCredentials.userId, current.id),
          eq(accountPasskeyCredentials.accountId, current.accountId),
          eq(accountPasskeyCredentials.status, 'active'),
          isNull(accountPasskeyCredentials.revokedAt),
        ),
      ),
    db
      .select()
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.userId, current.id), isNull(userFederatedIdentities.revokedAt))),
    db
      .select()
      .from(userDevices)
      .where(and(eq(userDevices.userId, current.id), gt(userDevices.expiresAt, new Date()))),
    db
      .select()
      .from(authAuditEvents)
      .where(and(eq(authAuditEvents.userId, current.id), eq(authAuditEvents.accountId, current.accountId))),
  ]);

  httpResponse.json(res, {
    data: {
      passkeys: credentials.map((item) => ({
        id: item.credentialId,
        label: item.label,
        createdAt: item.createdAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      })),
      federatedIdentities: federated.map((item) => ({
        id: item.id,
        provider: item.provider,
        emailAtLink: item.emailAtLink,
        linkedAt: item.linkedAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      })),
      trustedDevices: devices.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
        expiresAt: item.expiresAt.toISOString(),
      })),
      recoveryEvents: audit
        .filter((item) => item.event.includes('recovery'))
        .map((item) => ({ event: item.event, outcome: item.outcome, createdAt: item.createdAt.toISOString() })),
    },
    message: 'Security overview retrieved.',
  });
});

router.delete(
  '/security/federated/:identityId',
  authed({ authority: 'full' }),
  validateRequest({ params: securityIdentityPathSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const identityId = typeof req.params.identityId === 'string' ? req.params.identityId : req.params.identityId[0];
    const [revoked] = await db
      .update(userFederatedIdentities)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userFederatedIdentities.id, identityId),
          eq(userFederatedIdentities.userId, current.id),
          isNull(userFederatedIdentities.revokedAt),
        ),
      )
      .returning();

    if (!revoked)
      throw new HttpError({
        code: 'federated_identity_not_found',
        message: 'The federated identity was not found.',
        statusCode: 404,
      });
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'federated_identity_revoked',
      outcome: 'accepted',
      userId: current.id,
      accountId: current.accountId,
      contextHash: requestContext(req),
      createdAt: new Date(),
    });
    res.status(204).send();
  },
);

router.delete(
  '/security/devices/:deviceId',
  authed({ authority: 'full' }),
  validateRequest({ params: securityDevicePathSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { deviceId } = getValidated<{ params: typeof securityDevicePathSchema }>(req).params!;
    const [revoked] = await db
      .update(userDevices)
      .set({ expiresAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(userDevices.id, deviceId), eq(userDevices.userId, current.id), gt(userDevices.expiresAt, new Date())),
      )
      .returning();

    if (!revoked)
      throw new HttpError({
        code: 'trusted_device_not_found',
        message: 'The trusted device was not found.',
        statusCode: 404,
      });
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'trusted_device_revoked',
      outcome: 'accepted',
      userId: current.id,
      accountId: current.accountId,
      contextHash: requestContext(req),
      createdAt: new Date(),
    });
    res.status(204).send();
  },
);

router.post('/google/complete', csrfProtection, validateRequest({ body: googleCompleteSchema }), async (req, res) => {
  const body = getValidated<{ body: typeof googleCompleteSchema }>(req).body!;
  const flow = await identityFlow(req, body.flowId);

  if (!env.GOOGLE_AUTH_CLIENT_ID || req.session.googleNonce === undefined)
    throw new HttpError({ code: 'google_disabled', message: 'Google sign-in is not configured.', statusCode: 404 });
  const client = new OAuth2Client(env.GOOGLE_AUTH_CLIENT_ID);
  let payload;

  try {
    const ticket = await client.verifyIdToken({ idToken: body.idToken, audience: env.GOOGLE_AUTH_CLIENT_ID });

    payload = ticket.getPayload();
  } catch {
    await db.insert(authAuditEvents).values({
      id: randomUUID(),
      event: 'google_authentication',
      outcome: 'rejected',
      userId: null,
      accountId: null,
      contextHash: requestContext(req),
      createdAt: new Date(),
    });
    throw new HttpError({
      code: 'google_token_invalid',
      message: 'Google sign-in could not be verified.',
      statusCode: 401,
    });
  }
  if (
    !payload?.sub ||
    payload.iss !== 'https://accounts.google.com' ||
    payload.nonce !== req.session.googleNonce ||
    !payload.email ||
    payload.email_verified !== true
  )
    throw new HttpError({
      code: 'google_token_invalid',
      message: 'Google sign-in could not be verified.',
      statusCode: 401,
    });
  const [linked] = await db
    .select()
    .from(userFederatedIdentities)
    .where(
      and(
        eq(userFederatedIdentities.issuer, payload.iss),
        eq(userFederatedIdentities.subject, payload.sub),
        isNull(userFederatedIdentities.revokedAt),
      ),
    )
    .limit(1);
  let user = linked ? await findUserById(linked.userId) : undefined;

  if (!linked && (await findUserByEmail(payload.email)))
    throw new HttpError({
      code: 'google_link_required',
      message: 'This Google account must be explicitly linked from an authenticated session.',
      statusCode: 409,
    });
  user ??= await findOrCreateUserByEmail(payload.email);
  const membership = await resolveAuthUserForAccount(user);
  const authUser = {
    ...membership,
    authority: 'full' as const,
    authenticationMethod: 'google' as const,
    authVersion: user.authVersion,
  };

  if (!linked)
    await db.insert(userFederatedIdentities).values({
      id: randomUUID(),
      provider: 'google',
      issuer: payload.iss,
      subject: payload.sub,
      userId: user.id,
      emailAtLink: normalizeEmail(payload.email),
    });
  else
    await db
      .update(userFederatedIdentities)
      .set({ lastUsedAt: new Date() })
      .where(eq(userFederatedIdentities.id, linked.id));
  await db
    .update(authIdentityFlows)
    .set({
      state: 'complete',
      authorizationMethod: 'google',
      userId: user.id,
      accountId: membership.accountId,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(authIdentityFlows.id, flow.id));
  await establishFullSession(req, res, authUser);
  delete req.session.googleNonce;
  httpResponse.json(res, {
    data: { authenticated: true, user: authUser },
    message: 'Google authentication complete.',
  });
});

function requestContext(req: Request): string {
  return clientContextHash(req.ip, req.get('user-agent'));
}

async function bindPasswordFlowToNewSession(req: Request, flowId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  await db
    .update(authIdentityFlows)
    .set({ sessionBinding: req.sessionID, updatedAt: new Date() })
    .where(eq(authIdentityFlows.id, flowId));
}

function restrictedSession(req: Request) {
  const restricted = req.session?.restrictedAuth;

  if (!restricted || restricted.expiresAt <= Date.now()) {
    if (restricted) delete req.session.restrictedAuth;
    throw new HttpError({
      code: 'restricted_session_required',
      message: 'Verify an email code before continuing.',
      statusCode: 401,
    });
  }

  return restricted;
}

router.get('/session', async function sessionHandler(req, res) {
  if (req.isAuthenticated() && req.user && req.user.authority !== 'restricted') {
    httpResponse.json(res, {
      data: { authenticated: true, kind: 'full' as const, user: req.user },
      message: 'Session retrieved.',
    });

    return;
  }
  const restricted = req.session?.restrictedAuth;

  if (restricted && restricted.expiresAt > Date.now()) {
    httpResponse.json(res, {
      data: {
        authenticated: false as const,
        kind: 'restricted' as const,
        expiresAt: new Date(restricted.expiresAt).toISOString(),
        user: null,
        verifiedEmail: restricted.verifiedEmail,
      },
      message: 'Session retrieved.',
    });

    return;
  }
  httpResponse.json(res, {
    data: { authenticated: false as const, kind: 'anonymous' as const, user: null },
    message: 'Session retrieved.',
  });
});

router.post(
  '/email-otp/request',
  csrfProtection,
  validateRequest({ body: emailOtpRequestSchema }),
  emailOtpDeliveryRateLimit,
  async function requestEmailOtpHandler(req, res) {
    const { email } = getValidated<{ body: typeof emailOtpRequestSchema }>(req).body!;

    const challenge = await requestEmailOtp(email, requestContext(req));

    httpResponse.json(res, {
      data: {
        flowId: challenge.flowId,
        resendAvailableAt: challenge.resendAvailableAt,
      },
      status: 202,
      message: 'Verification code sent.',
    });
  },
);

router.post(
  '/email-otp/verify',
  csrfProtection,
  validateRequest({ body: emailOtpVerifySchema }),
  emailOtpVerificationRateLimit,
  async function verifyEmailOtpHandler(req, res) {
    const { flowId, pin } = getValidated<{ body: typeof emailOtpVerifySchema }>(req).body!;

    const identity = await verifyEmailOtp(flowId, pin, requestContext(req));
    const expiresAt = await establishRestrictedSession(req, flowId, identity);

    httpResponse.json(res, {
      data: {
        kind: 'restricted' as const,
        authenticated: false as const,
        expiresAt: new Date(expiresAt).toISOString(),
        user: null,
        verifiedEmail: identity.email,
      },
      message: 'Email verified. Create and verify a passkey to finish signing in.',
    });
  },
);

router.post(
  '/restricted/accounts/select',
  csrfProtection,
  validateRequest({ body: restrictedAccountSelectSchema }),
  async function selectRestrictedAccountHandler(req, res) {
    const restricted = restrictedSession(req);
    const { accountId } = getValidated<{ body: typeof restrictedAccountSelectSchema }>(req).body!;
    const account = restricted.eligibleAccounts.find((candidate) => candidate.accountId === accountId);

    if (!account || (restricted.selectedAccountId && restricted.selectedAccountId !== accountId)) {
      res.status(404).send({ code: 'account_unavailable', message: 'The account is not available.' });

      return;
    }

    restricted.selectedAccountId = account.accountId;
    const user = await findUserById(restricted.userId);

    if (!user) {
      throw new HttpError({ code: 'account_unavailable', message: 'The account is not available.', statusCode: 404 });
    }
    const authUser = {
      ...(await resolveAuthUserForAccount(user, account.accountId)),
      authority: 'restricted' as const,
    };

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    req.session.restrictedAuth = restricted;
    req.session.authority = 'restricted';
    req.session.cookie.maxAge = Math.max(0, restricted.expiresAt - Date.now());
    httpResponse.json(res, { data: { ...account, selected: true }, message: 'Account selected.' });
  },
);

router.get('/restricted/accounts', function restrictedAccountsHandler(req, res) {
  const restricted = restrictedSession(req);

  httpResponse.json(res, {
    data: {
      accounts: restricted.eligibleAccounts.map((account) => ({
        ...account,
        selected: account.accountId === restricted.selectedAccountId,
      })),
    },
    message: 'Eligible accounts retrieved.',
  });
});

router.post(
  '/email-otp/resend',
  csrfProtection,
  validateRequest({ body: emailOtpResendSchema }),
  emailOtpDeliveryRateLimit,
  async function resendEmailOtpHandler(req, res) {
    const { flowId } = getValidated<{ body: typeof emailOtpResendSchema }>(req).body!;

    const challenge = await resendEmailOtp(flowId, requestContext(req));

    httpResponse.json(res, {
      data: challenge,
      status: 202,
      message: 'Verification code resent.',
    });
  },
);

router.post('/sign-out', csrfProtection, async function signOutHandler(req, res) {
  if (req.isAuthenticated()) {
    await new Promise<void>((resolve, reject) => req.logout((error) => (error ? reject(error) : resolve())));
  }

  req.session.destroy(() => undefined);
  res.clearCookie('connect.sid');
  clearSessionHintCookie(res);
  res.status(204).send();
});

export { authOpenApiPaths, router as authRouter };
