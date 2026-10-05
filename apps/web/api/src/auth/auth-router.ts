import { createHmac, randomUUID } from 'node:crypto';

import { Router, type Request } from 'express';
import { eq } from 'drizzle-orm';

import { getValidated, validateRequest } from '../shared/http/route-schemas';
import { env } from '../shared/env';

import { sendRecoveryNotification } from './auth-mail';
import { googleRouter } from './google-router';
import { reauthRouter } from './reauth-router';
import { passwordFlowRouter } from './password-flow-router';
import { deviceApprovalRouter } from './device-approval-router';
import { totpRouter } from './totp-router';
import { securityRouter } from './security-router';
import { authOpenApiPaths } from './auth-openapi';
import { createRecoveryChallenge, consumeRecoveryAuthorization, bindRecoveryEnrollmentSession } from './auth-recovery';
import { identityFlow, requestContext, restrictedSession } from './auth-route-session';
import { clientContextHash, requestEmailOtp, resendEmailOtp, verifyEmailOtp } from './auth-service';
import { findUserById, normalizeEmail, findUserByEmail, resolveAuthUserForAccount } from './auth-identity';
import {
  emailOtpRequestSchema,
  emailOtpResendSchema,
  emailOtpVerifySchema,
  restrictedAccountSelectSchema,
  identityIdentifySchema,
  identityStatusSchema,
  recoveryVerifySchema,
} from './auth-schemas';
import { csrfProtection, emailOtpVerificationRateLimit } from './passkey-security';
import { clearSessionHintCookie } from './session-cookie';

import { HttpError, httpResponse, regenerateSession, authAuditEvents, authIdentityFlows, db } from 'shared';

const router = Router();

router.use(googleRouter, reauthRouter, passwordFlowRouter, deviceApprovalRouter, totpRouter, securityRouter);
const FLOW_TTL_MS = 15 * 60_000;

function flowHash(email: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(normalizeEmail(email)).digest('hex');
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
    const membership = await resolveAuthUserForAccount(user, selectedAccountId);
    const authUser = {
      ...membership,
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

router.get('/session', async function sessionHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

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
    const membership = await resolveAuthUserForAccount(user, account.accountId);
    const authUser = {
      ...membership,
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
