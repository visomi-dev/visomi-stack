import { createHmac, randomUUID } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';
import { Router, type Request } from 'express';
import { and, eq, gt, isNull, isNotNull, lt, ne, sql } from 'drizzle-orm';

import { getValidated, validateRequest } from '../shared/http/route-schemas';
import { env } from '../shared/env';

import { authed, authedRequest, authenticationVerification, restrictedOperation } from './auth-middleware';
import { generateVerificationPin, hashSecret, verifySecret } from './auth-crypto';
import { establishFullSession, refreshSessionAuthVersion } from './auth-session';
import { removeAccessMethod } from './access-methods';
import { sendRecoveryNotification } from './auth-mail';
import {
  clientContextHash,
  findUserById,
  requestEmailOtp,
  resendEmailOtp,
  verifyEmailOtp,
  createRecoveryChallenge,
  consumeRecoveryAuthorization,
  bindRecoveryEnrollmentSession,
  normalizeEmail,
  findUserByEmail,
  resolveAuthUserForAccount,
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
  emailOtpVerificationRateLimit,
  authenticationRateLimit,
} from './passkey-security';
import { clearSessionHintCookie, setSessionHintCookie } from './session-cookie';
import { verifyPassword } from './password';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpCode } from './totp';

import {
  HttpError,
  httpResponse,
  regenerateSession,
  authAuditEvents,
  authIdentityFlows,
  userFederatedIdentities,
  authDeviceApprovalRequests,
  authEnrollmentGrants,
  accountPasskeyCredentials,
  userDevices,
  userTotpEnrollments,
  userRecoveryCodes,
  authOperationGrants,
  users,
  db,
} from 'shared';

const router = Router();
const FLOW_TTL_MS = 15 * 60_000;

function approvalStatus(request: typeof authDeviceApprovalRequests.$inferSelect) {
  if (request.consumedAt) return 'consumed' as const;
  if (request.cancelledAt) return 'cancelled' as const;
  if (request.deniedAt) return 'denied' as const;
  if (request.expiresAt <= new Date()) return 'expired' as const;

  return request.approvedAt ? ('approved' as const) : ('pending' as const);
}

async function securityMethods(userId: string, accountId: string) {
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

  if (passkeys.length) methods.push('passkey');
  if (env.GOOGLE_AUTH_CLIENT_ID && google.length) methods.push('google');
  if (user?.passwordHash) methods.push('password');
  if (totp.length) methods.push('totp');
  if (recovery.length) methods.push('recovery_code');

  return {
    methods,
    passwordEnabled: Boolean(user?.passwordHash),
    totpEnabled: totp.length > 0,
    recoveryCodesRemaining: recovery.length,
  };
}

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

  await regenerateSession(req);
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

    if (!user || user.authVersion !== identity.authVersion || user.email !== identity.email) {
      throw new HttpError({ code: 'authentication_required', message: 'Verify your identity again.', statusCode: 401 });
    }
    const authUser = {
      ...(await resolveAuthUserForAccount(user, selectedAccountId)),
      authority: 'restricted' as const,
    };

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
  }
  req.session.restrictedAuth = restrictedAuth;
  req.session.authority = 'restricted';
  req.session.authVersion = identity.authVersion;
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
  authenticationRateLimit,
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

    if (!request || request.requesterSessionHash !== clientContextHash(req.sessionID, req.get('user-agent')))
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 410,
      });
    httpResponse.json(res, {
      data: {
        requestId,
        status: approvalStatus(request),
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
          eq(authDeviceApprovalRequests.userId, current.id),
          ne(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          gt(authDeviceApprovalRequests.expiresAt, new Date()),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.cancelledAt),
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
  '/device-approval/review',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const [request] = await db
      .select()
      .from(authDeviceApprovalRequests)
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.userId, current.id),
          eq(authDeviceApprovalRequests.accountId, current.accountId),
        ),
      )
      .limit(1);

    if (!request)
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 404,
      });
    httpResponse.json(res, {
      data: {
        requestId,
        status: approvalStatus(request),
        accountId: current.accountId,
        createdAt: request.createdAt.toISOString(),
        expiresAt: request.expiresAt.toISOString(),
        requester: request.requesterSessionHash === clientContextHash(req.sessionID, req.get('user-agent')),
      },
      message: 'Approval request reviewed.',
    });
  },
);

router.post(
  '/device-approval/cancel',
  csrfProtection,
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const [cancelled] = await db
      .update(authDeviceApprovalRequests)
      .set({ cancelledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.consumedAt),
          gt(authDeviceApprovalRequests.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!cancelled)
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 409,
      });
    httpResponse.json(res, { data: { requestId, status: 'cancelled' }, message: 'Approval request cancelled.' });
  },
);

router.post(
  '/device-approval/deny',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: approvalIdSchema }),
  async (req, res) => {
    const { requestId } = getValidated<{ body: typeof approvalIdSchema }>(req).body!;
    const current = authedRequest(req).user;
    const [denied] = await db
      .update(authDeviceApprovalRequests)
      .set({ deniedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, requestId),
          eq(authDeviceApprovalRequests.userId, current.id),
          eq(authDeviceApprovalRequests.accountId, current.accountId),
          ne(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.approvedAt),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNull(authDeviceApprovalRequests.consumedAt),
          gt(authDeviceApprovalRequests.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!denied)
      throw new HttpError({
        code: 'approval_unavailable',
        message: 'The approval request is unavailable.',
        statusCode: 409,
      });
    httpResponse.json(res, { data: { requestId, status: 'denied' }, message: 'Approval request denied.' });
  },
);

router.post(
  '/device-approval/consume',
  csrfProtection,
  authenticationRateLimit,
  validateRequest({ body: approvalConsumeSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof approvalConsumeSchema }>(req).body!;
    const [request] = await db
      .update(authDeviceApprovalRequests)
      .set({ attemptCount: sql`${authDeviceApprovalRequests.attemptCount} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(authDeviceApprovalRequests.id, body.requestId),
          eq(authDeviceApprovalRequests.requesterSessionHash, clientContextHash(req.sessionID, req.get('user-agent'))),
          isNull(authDeviceApprovalRequests.consumedAt),
          isNull(authDeviceApprovalRequests.deniedAt),
          isNull(authDeviceApprovalRequests.cancelledAt),
          isNotNull(authDeviceApprovalRequests.approvedAt),
          gt(authDeviceApprovalRequests.expiresAt, new Date()),
          lt(authDeviceApprovalRequests.attemptCount, 5),
        ),
      )
      .returning();

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
    const grant = await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(authDeviceApprovalRequests)
        .set({ consumedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(authDeviceApprovalRequests.id, request.id),
            isNull(authDeviceApprovalRequests.consumedAt),
            isNull(authDeviceApprovalRequests.deniedAt),
            isNull(authDeviceApprovalRequests.cancelledAt),
            gt(authDeviceApprovalRequests.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!consumed)
        throw new HttpError({
          code: 'approval_replayed',
          message: 'The approval request was already consumed.',
          statusCode: 409,
        });
      const [createdGrant] = await tx
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

      return createdGrant;
    });

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
      await createRecoveryChallenge(
        user,
        flow.id as `${string}-${string}-${string}-${string}-${string}`,
        req.sessionID,
        req.ip,
      );
    } else if (!user && flow.state === 'verify_new_email' && flow.emailHash === flowHash(body.email)) {
      await requestEmailOtp(
        body.email,
        requestContext(req),
        flow.id as `${string}-${string}-${string}-${string}-${string}`,
        'bootstrap_recovery',
        req.ip,
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
    const authorization = await consumeRecoveryAuthorization(
      body.flowId,
      body.pin,
      req.sessionID,
      clientContextHash(req.sessionID, req.get('user-agent')),
      body.factor,
    );
    const { user, memberships, selected, grant, expiresAt } = authorization;
    const authUser = {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      accountId: selected.accountId,
      role: selected.role,
      authVersion: user.authVersion,
      authority: 'restricted' as const,
    };

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    await bindRecoveryEnrollmentSession(authorization, clientContextHash(req.sessionID, req.get('user-agent')));
    req.session.authority = 'restricted';
    req.session.authVersion = user.authVersion;
    req.session.cookie.maxAge = Math.max(0, expiresAt - Date.now());
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
    req.session.enrollmentGrantId = grant.id;
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
      password: { enabled: true },
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
    const pending = await startPasswordSignUp(body.email, body.password, requestContext(req), req.sessionID, req.ip);

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
    const pending = await startPasswordReset(body.email, requestContext(req), req.sessionID, req.ip);

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
      req.ip,
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
    const pending = await startPasswordSignIn(email, password, requestContext(req), req.sessionID, req.ip);

    await regenerateSession(req);
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
  authenticationVerification('password'),
  async function passwordVerifyHandler(req, res) {
    const body = getValidated<{ body: typeof passwordVerifySchema }>(req).body!;

    const result =
      body.kind === 'email'
        ? await verifyPasswordEmailOtp(body.flowId, body.code, requestContext(req), req.sessionID)
        : await verifyPasswordTotp(body.flowId, body.code, req.sessionID, body.kind);
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

router.post(
  '/totp/setup',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'totp_change', grantSource: 'body' } }),
  async function totpSetupHandler(req, res) {
    if (!env.AUTH_TOTP_ENROLLMENT_ENABLED)
      throw new HttpError({
        code: 'totp_enrollment_disabled',
        message: 'TOTP enrollment is disabled.',
        statusCode: 404,
      });
    const current = authedRequest(req).user;

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
  },
);

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
      await tx.select({ id: users.id }).from(users).where(eq(users.id, current.id)).for('update');
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
    refreshSessionAuthVersion(req, (current.authVersion ?? 1) + 1);
    const recoveryCodes = await replaceRecoveryCodes(current.id);

    delete req.session.passkeySecurityReauthenticatedAt;
    httpResponse.json(res, { data: { enabled: true, recoveryCodes }, message: 'TOTP enrollment confirmed.' });
  },
);

router.post(
  '/totp/disable',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'totp_disable', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
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
      await tx.select({ id: users.id }).from(users).where(eq(users.id, current.id)).for('update');
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
  validateRequest({ body: googleLinkSchema }),
  authed({ authority: 'full', operation: { purpose: 'google_link', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof googleLinkSchema }>(req).body!;

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
    const challenge = await resendEmailOtp(flowId, requestContext(req), req.ip);

    httpResponse.json(res, { data: challenge, status: 202, message: 'Password verification code resent.' });
  },
);

router.post(
  '/password/set',
  csrfProtection,
  validateRequest({ body: passwordSetSchema }),
  restrictedOperation('password:set'),
  async function passwordSetHandler(req, res) {
    const { password } = getValidated<{ body: typeof passwordSetSchema }>(req).body!;

    const authVersion = await setUserPassword(authedRequest(req).user.id, password);

    refreshSessionAuthVersion(req, authVersion);
    httpResponse.json(res, {
      data: passwordSetResponseSchema.parse({ passwordSet: true }),
      message: 'Password set successfully.',
    });
  },
);

router.post(
  '/reauth/start',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: reauthStartSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { purpose } = getValidated<{ body: typeof reauthStartSchema }>(req).body!;
    const grantId = await createOperationGrant(current.id, purpose, req.sessionID);
    const available = await securityMethods(current.id, current.accountId);
    const [grant] = await db
      .select({ expiresAt: authOperationGrants.expiresAt })
      .from(authOperationGrants)
      .where(eq(authOperationGrants.id, grantId));

    req.session.reauthGrantId = grantId;
    const methods =
      purpose === 'passkey_enroll'
        ? available.methods.filter((method) => method === 'google' || method === 'passkey')
        : available.methods;
    const nonce = randomUUID();
    const session = req.session as typeof req.session & {
      reauthChallenge?: { grantId: string; purpose: string; methods: string[]; nonce: string };
    };

    session.reauthChallenge = { grantId, purpose, methods, nonce };
    delete req.session.passkeySecurityReauthenticatedAt;
    if (purpose === 'google_link') req.session.googleNonce = randomUUID();
    httpResponse.json(res, {
      data: {
        grantId,
        methods,
        ...(methods.includes('google') ? { google: { clientId: env.GOOGLE_AUTH_CLIENT_ID, nonce } } : {}),
        expiresAt: grant.expiresAt.toISOString(),
        passwordRequiresTotp: available.passwordEnabled && available.totpEnabled,
      },
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
  authenticationVerification('reauth'),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof reauthCompleteSchema }>(req).body!;
    const session = req.session as typeof req.session & {
      reauthChallenge?: { grantId: string; purpose: string; methods: string[]; nonce: string };
    };
    const challenge = session.reauthChallenge;
    const [operation] = await db
      .select()
      .from(authOperationGrants)
      .where(
        and(
          eq(authOperationGrants.id, body.grantId),
          eq(authOperationGrants.userId, current.id),
          eq(authOperationGrants.sessionBinding, req.sessionID),
          isNull(authOperationGrants.verifiedAt),
          isNull(authOperationGrants.consumedAt),
          gt(authOperationGrants.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const available = await securityMethods(current.id, current.accountId);

    if (
      !operation ||
      !challenge ||
      challenge.grantId !== operation.id ||
      challenge.purpose !== operation.purpose ||
      !challenge.methods.includes(body.method) ||
      !available.methods.includes(body.method) ||
      (operation.purpose === 'passkey_enroll' && body.method !== 'google' && body.method !== 'passkey')
    )
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
    if (body.method === 'google' && body.idToken && env.GOOGLE_AUTH_CLIENT_ID) {
      try {
        const ticket = await new OAuth2Client(env.GOOGLE_AUTH_CLIENT_ID).verifyIdToken({
          idToken: body.idToken,
          audience: env.GOOGLE_AUTH_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        if (
          payload?.sub &&
          payload.iss === 'https://accounts.google.com' &&
          payload.email &&
          payload.email_verified === true &&
          payload.nonce === challenge.nonce
        ) {
          const [linked] = await db
            .select({ id: userFederatedIdentities.id })
            .from(userFederatedIdentities)
            .where(
              and(
                eq(userFederatedIdentities.userId, current.id),
                eq(userFederatedIdentities.provider, 'google'),
                eq(userFederatedIdentities.issuer, payload.iss),
                eq(userFederatedIdentities.subject, payload.sub),
                isNull(userFederatedIdentities.revokedAt),
              ),
            )
            .limit(1);

          valid = Boolean(linked);
        }
      } catch {
        valid = false;
      }
    }
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
      .set({ verifiedAt: new Date() })
      .where(
        and(
          eq(authOperationGrants.id, body.grantId),
          eq(authOperationGrants.userId, current.id),
          eq(authOperationGrants.sessionBinding, req.sessionID),
          isNull(authOperationGrants.verifiedAt),
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
    delete session.reauthChallenge;
    httpResponse.json(res, {
      data: { grantId: body.grantId, authenticated: true },
      message: 'Reauthentication completed.',
    });
  },
);

router.post(
  '/recovery-codes/regenerate',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'recovery_codes_regenerate', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const recoveryCodes = await replaceRecoveryCodes(current.id);

    httpResponse.json(res, { data: { recoveryCodes }, message: 'Recovery codes regenerated.' });
  },
);

router.post(
  '/password/change',
  csrfProtection,
  validateRequest({ body: passwordChangeSchema }),
  authed({ authority: 'full', operation: { purpose: 'password_change', grantSource: 'session' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof passwordChangeSchema }>(req).body!;

    const user = await findUserById(current.id);

    if (!user?.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash)))
      throw new HttpError({ code: 'password_invalid', message: 'The current password is invalid.', statusCode: 401 });
    await setUserPassword(current.id, body.password);
    httpResponse.json(res, { data: { passwordChanged: true }, message: 'Password changed.' });
  },
);

router.post(
  '/passkey/enrollment/identity',
  csrfProtection,
  validateRequest({ body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'passkey_enroll', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const grantId = randomUUID();

    await db.insert(authEnrollmentGrants).values({
      id: grantId,
      userId: current.id,
      accountId: current.accountId,
      requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
      source: 'identity_enrollment',
      expiresAt: new Date(Date.now() + 5 * 60_000),
      createdAt: new Date(),
    });
    req.session.enrollmentGrantId = grantId;
    httpResponse.json(res, { data: { authorized: true }, message: 'Passkey enrollment authorized.' });
  },
);

router.post(
  '/passkey/enrollment/start',
  csrfProtection,
  authed({ authority: 'full' }),
  authenticationRateLimit,
  validateRequest({ body: passwordRemoveSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const available = await securityMethods(current.id, current.accountId);

    if (available.methods.includes('passkey'))
      throw new HttpError({
        code: 'existing_passkey_required',
        message: 'Confirm an existing passkey to add another.',
        statusCode: 409,
      });
    const pending = await startPasswordSignIn(
      current.email,
      req.body.currentPassword,
      requestContext(req),
      req.sessionID,
      req.ip,
    );

    if (req.session.passkeyEnrollmentFlowId)
      await db
        .update(authIdentityFlows)
        .set({ terminalAt: new Date() })
        .where(
          and(eq(authIdentityFlows.id, req.session.passkeyEnrollmentFlowId), eq(authIdentityFlows.userId, current.id)),
        );

    await db
      .update(authIdentityFlows)
      .set({ intent: 'passkey_enroll', accountId: current.accountId })
      .where(eq(authIdentityFlows.id, pending.flowId));
    req.session.passkeyEnrollmentFlowId = pending.flowId;
    httpResponse.json(res, {
      data: pending,
      status: 202,
      message: 'Confirm the selected factor before enrolling your first passkey.',
    });
  },
);

router.post(
  '/passkey/enrollment/complete',
  csrfProtection,
  authed({ authority: 'full' }),
  authenticationRateLimit,
  validateRequest({ body: passwordVerifySchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof passwordVerifySchema }>(req).body!;
    const [flow] = await db
      .select()
      .from(authIdentityFlows)
      .where(
        and(
          eq(authIdentityFlows.id, body.flowId),
          eq(authIdentityFlows.userId, current.id),
          eq(authIdentityFlows.accountId, current.accountId),
          eq(authIdentityFlows.intent, 'passkey_enroll'),
          eq(authIdentityFlows.sessionBinding, req.sessionID),
          gt(authIdentityFlows.expiresAt, new Date()),
          isNull(authIdentityFlows.completedAt),
          isNull(authIdentityFlows.terminalAt),
        ),
      )
      .limit(1);

    if (!flow || req.session.passkeyEnrollmentFlowId !== body.flowId || flow.requiredFactor !== body.kind)
      throw new HttpError({
        code: 'verification_failed',
        message: 'This enrollment verification is unavailable.',
        statusCode: 401,
      });
    const verified =
      body.kind === 'email'
        ? await verifyPasswordEmailOtp(body.flowId, body.code, requestContext(req), req.sessionID)
        : await verifyPasswordTotp(body.flowId, body.code, req.sessionID);

    if (verified.user.id !== current.id || verified.user.authVersion !== current.authVersion)
      throw new HttpError({
        code: 'verification_failed',
        message: 'Confirm your current identity again.',
        statusCode: 401,
      });
    const grantId = randomUUID();

    await db.insert(authEnrollmentGrants).values({
      id: grantId,
      userId: current.id,
      accountId: current.accountId,
      requesterSessionHash: clientContextHash(req.sessionID, req.get('user-agent')),
      source: 'password_enrollment',
      expiresAt: new Date(Date.now() + 5 * 60_000),
      createdAt: new Date(),
    });
    req.session.enrollmentGrantId = grantId;
    delete req.session.passkeyEnrollmentFlowId;
    httpResponse.json(res, { data: { authorized: true }, message: 'First-passkey enrollment authorized.' });
  },
);

router.post(
  '/password/remove',
  csrfProtection,
  validateRequest({ body: passwordRemoveSchema }),
  authed({ authority: 'full', operation: { purpose: 'password_remove', grantSource: 'session' } }),
  async (req, res) => {
    const current = authedRequest(req).user;

    await removeAccessMethod(current, { kind: 'password', currentPassword: req.body.currentPassword });
    res.status(204).send();
  },
);

router.get('/security/overview', authed({ authority: 'full' }), async (req, res) => {
  const current = authedRequest(req).user;
  const available = await securityMethods(current.id, current.accountId);
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
      passwordEnabled: available.passwordEnabled,
      googleLinkEnabled: Boolean(env.GOOGLE_AUTH_CLIENT_ID),
      totpEnabled: available.totpEnabled,
      recoveryCodesRemaining: available.recoveryCodesRemaining,
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
  csrfProtection,
  validateRequest({ params: securityIdentityPathSchema, body: operationGrantSchema }),
  authed({ authority: 'full', operation: { purpose: 'google_unlink', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const identityId = typeof req.params.identityId === 'string' ? req.params.identityId : req.params.identityId[0];

    await removeAccessMethod(current, { kind: 'google', identityId });
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
  if (!linked) {
    const email = normalizeEmail(payload.email);
    const issuer = payload.iss;
    const subject = payload.sub;

    user = await db.transaction(async (tx) => {
      const now = new Date();
      // Only this insert may verify the primary email. Never adopt a concurrent email match.
      const [created] = await tx
        .insert(users)
        .values({ id: randomUUID(), email, emailVerifiedAt: now, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: users.email })
        .returning();

      if (!created)
        throw new HttpError({
          code: 'google_link_required',
          message: 'This Google account must be explicitly linked from an authenticated session.',
          statusCode: 409,
        });
      const accountId = randomUUID();
      const name = email.split('@')[0];
      const baseSlug = name
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

      // Keep account, membership and identity creation in the same transaction as verified email ownership.
      await tx.execute(sql`
        with inserted as (
          insert into accounts (id, name, slug, owner_user_id)
          values (${accountId}, ${name}, ${baseSlug}, ${created.id})
          on conflict (slug) do nothing
          returning id
        )
        insert into accounts (id, name, slug, owner_user_id)
        select ${accountId}, ${name}, ${`${baseSlug}-${accountId.slice(0, 8)}`}, ${created.id}
        where not exists (select 1 from inserted)
      `);
      await tx.execute(sql`
        insert into account_memberships (id, account_id, user_id, role)
        values (${randomUUID()}, ${accountId}, ${created.id}, 'owner')
      `);
      const [identity] = await tx
        .insert(userFederatedIdentities)
        .values({ id: randomUUID(), provider: 'google', issuer, subject, userId: created.id, emailAtLink: email })
        .onConflictDoNothing()
        .returning();

      if (!identity)
        throw new HttpError({
          code: 'google_link_required',
          message: 'This Google account must be explicitly linked from an authenticated session.',
          statusCode: 409,
        });

      return created;
    });
  }
  if (!user)
    throw new HttpError({
      code: 'google_token_invalid',
      message: 'Google sign-in could not be verified.',
      statusCode: 401,
    });
  const membership = await resolveAuthUserForAccount(user);
  const authUser = {
    ...membership,
    authority: 'full' as const,
    authenticationMethod: 'google' as const,
    authVersion: user.authVersion,
  };

  if (linked)
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
  await regenerateSession(req);
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
  async function requestEmailOtpHandler(req, res) {
    const { email } = getValidated<{ body: typeof emailOtpRequestSchema }>(req).body!;

    const challenge = await requestEmailOtp(email, requestContext(req), undefined, undefined, req.ip);

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

    const proofVersion = req.session.authVersion;
    const user = await findUserById(restricted.userId);

    if (
      !user ||
      proofVersion === undefined ||
      user.authVersion !== proofVersion ||
      user.email !== restricted.verifiedEmail ||
      req.session.authority !== 'restricted' ||
      !restricted.allowedOperations.includes('accounts:select')
    ) {
      throw new HttpError({ code: 'authentication_required', message: 'Verify your identity again.', statusCode: 401 });
    }
    restricted.selectedAccountId = account.accountId;
    const authUser = {
      ...(await resolveAuthUserForAccount(user, account.accountId)),
      authVersion: proofVersion,
      authority: 'restricted' as const,
    };

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    req.session.restrictedAuth = restricted;
    req.session.authority = 'restricted';
    req.session.authVersion = proofVersion;
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
  async function resendEmailOtpHandler(req, res) {
    const { flowId } = getValidated<{ body: typeof emailOtpResendSchema }>(req).body!;

    const challenge = await resendEmailOtp(flowId, requestContext(req), req.ip);

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
