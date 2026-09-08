import { createHmac, randomUUID } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';
import { Router, type Request } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { getValidated, validateRequest } from '../shared/http/route-schemas';
import { env } from '../shared/env';

import { authed, authedRequest } from './auth-middleware';
import { generateVerificationPin, hashSecret, verifySecret } from './auth-crypto';
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
  approvalCreateSchema,
  approvalIdSchema,
  approvalConsumeSchema,
  securityIdentityPathSchema,
  securityDevicePathSchema,
} from './auth-schemas';
import { csrfProtection, emailOtpDeliveryRateLimit, emailOtpVerificationRateLimit } from './passkey-security';
import { clearSessionHintCookie, setSessionHintCookie } from './session-cookie';

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

    await db
      .update(authIdentityFlows)
      .set({ emailHash: flowHash(body.email), state: 'identify', updatedAt: now })
      .where(eq(authIdentityFlows.id, flow.id));
    await requestEmailOtp(
      body.email,
      requestContext(req),
      flow.id as `${string}-${string}-${string}-${string}-${string}`,
    );
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
      data: { flowId: flow.id, state: 'identify' },
      status: 202,
      message: 'If the address can be used, a verification code has been sent.',
    });
  },
);

router.post('/identity/status', csrfProtection, validateRequest({ body: identityStatusSchema }), async (req, res) => {
  const body = getValidated<{ body: typeof identityStatusSchema }>(req).body!;
  const flow = await identityFlow(req, body.flowId);

  httpResponse.json(res, {
    data: { flowId: flow.id, state: flow.state, expiresAt: flow.expiresAt.toISOString() },
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

    if (user) {
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
    }
    httpResponse.json(res, {
      data: { flowId: flow.id, state: 'authorize_existing_account' },
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
    const [challenge] = await db
      .select()
      .from(authVerificationChallenges)
      .where(and(eq(authVerificationChallenges.id, body.flowId), isNull(authVerificationChallenges.consumedAt)))
      .limit(1);

    if (!challenge || challenge.purpose !== 'existing_account_recovery')
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
      allowedOperations: ['passkeys:enroll', 'passkeys:verify'],
      eligibleAccounts: memberships.map((membership) => ({
        accountId: membership.accountId,
        name: membership.accountId,
        role: membership.role,
      })),
      expiresAt: Date.now() + FLOW_TTL_MS,
      flowId: flow.id,
      issuedAt: Date.now(),
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
      data: { flowId: flow.id, state: 'enroll_passkey' },
      message: 'Recovery verified. Create a new passkey to finish.',
    });
  },
);

router.get('/identity/providers', (_req, res) => {
  httpResponse.json(res, {
    data: { google: { enabled: Boolean(env.GOOGLE_AUTH_CLIENT_ID), clientId: env.GOOGLE_AUTH_CLIENT_ID || null } },
    message: 'Authentication providers retrieved.',
  });
});

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
  await new Promise<void>((resolve, reject) =>
    req.login({ ...membership, authority: 'full' as const }, (error) => (error ? reject(error) : resolve())),
  );
  req.session.authority = 'full';
  req.session.authenticatedAt = Date.now();
  req.session.passkeySecurityReauthenticatedAt = Date.now();
  req.session.cookie.maxAge = env.SESSION_MAX_AGE_MS;
  delete req.session.googleNonce;
  setSessionHintCookie(res);
  httpResponse.json(res, {
    data: { authenticated: true, user: { ...membership } },
    message: 'Google authentication complete.',
  });
});

function requestContext(req: Request): string {
  return clientContextHash(req.ip, req.get('user-agent'));
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
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 15 * 60_000;

    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    const restrictedAuth = {
      allowedOperations: ['accounts:read', 'accounts:select', 'passkeys:enroll', 'passkeys:verify'],
      eligibleAccounts: identity.accounts,
      expiresAt,
      flowId,
      issuedAt,
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

        await new Promise<void>((resolve, reject) =>
          req.login(authUser, (error) => (error ? reject(error) : resolve())),
        );
      }
    }
    req.session.restrictedAuth = restrictedAuth;
    req.session.authority = 'restricted';
    req.session.cookie.maxAge = 15 * 60_000;

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
