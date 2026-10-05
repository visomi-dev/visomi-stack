import { Router } from 'express';
import { DateTime } from 'luxon';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { removeAccessMethod } from './access-methods';
import { authed, authedRequest, authenticationVerification, restrictedOperation } from './auth-middleware';
import { bindPasswordFlowToNewSession, identityFlow, requestContext } from './auth-route-session';
import {
  passwordSignUpSchema,
  passwordSignUpVerifySchema,
  passwordResetRequestSchema,
  passwordResetCompleteSchema,
  passwordSignInSchema,
  passwordVerifySchema,
  passwordResendSchema,
  passwordSetSchema,
  passwordSetResponseSchema,
  passwordChangeSchema,
  passwordRemoveSchema,
} from './auth-schemas';
import { resendEmailOtp } from './auth-service';
import { findUserById, resolveAuthUserForAccount } from './auth-identity';
import { establishFullSession, refreshSessionAuthVersion } from './auth-session';
import {
  startPasswordSignUp,
  verifyPasswordSignUp,
  startPasswordReset,
  completePasswordReset,
} from './password-account';
import { consumePasswordRateLimit, csrfProtection } from './passkey-security';
import { verifyPassword } from './password';
import { startPasswordSignIn, verifyPasswordEmailOtp, verifyPasswordTotp, setUserPassword } from './password-session';
import { setSessionHintCookie } from './session-cookie';

import { HttpError, httpResponse } from 'shared';

export const passwordFlowRouter = Router();

passwordFlowRouter.post(
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

passwordFlowRouter.post(
  ['/password/sign-up/verify', '/sign-up/verify'],
  csrfProtection,
  validateRequest({ body: passwordSignUpVerifySchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof passwordSignUpVerifySchema }>(req).body!;

    if (req.session.passwordFlowId !== body.flowId) {
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password signup flow is unavailable.',
        statusCode: 401,
      });
    }
    const identity = await verifyPasswordSignUp(body.flowId, body.code, requestContext(req), req.sessionID);
    const user = await findUserById(identity.userId);
    const accountId = identity.accounts[0]?.accountId;

    if (!user || !accountId) {
      throw new HttpError({ code: 'signup_session_unavailable', message: 'Sign in to continue.', statusCode: 500 });
    }
    const membership = await resolveAuthUserForAccount(user, accountId);
    const authUser = {
      ...membership,
      authority: 'full' as const,
      authenticationMethod: 'password' as const,
      authVersion: user.authVersion,
    };

    delete req.session.passwordFlowId;
    await establishFullSession(req, res, authUser);
    httpResponse.json(res, {
      data: { authenticated: true, kind: 'full', user: authUser },
      message: 'Email verified. Your account is ready.',
    });
  },
);

passwordFlowRouter.post(
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

passwordFlowRouter.post(
  ['/password/reset/complete', '/password-reset/complete'],
  csrfProtection,
  validateRequest({ body: passwordResetCompleteSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof passwordResetCompleteSchema }>(req).body!;

    if (req.session.passwordFlowId !== body.flowId) {
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password reset flow is unavailable.',
        statusCode: 401,
      });
    }
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

passwordFlowRouter.post(
  ['/password/sign-in', '/sign-in/password'],
  csrfProtection,
  validateRequest({ body: passwordSignInSchema }),
  async function passwordSignInHandler(req, res) {
    let passwordLimit;

    try {
      const limit = await consumePasswordRateLimit(req);

      passwordLimit = limit;
    } catch {
      throw new HttpError({
        code: 'auth_limiter_unavailable',
        message: 'Authentication is temporarily unavailable.',
        statusCode: 503,
      });
    }
    if (!passwordLimit.allowed) {
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many password attempts; retry after the cooldown.',
        statusCode: 429,
        data: { retryAfter: passwordLimit.retryAfter },
      });
    }
    const { email, password } = getValidated<{ body: typeof passwordSignInSchema }>(req).body!;
    const pending = await startPasswordSignIn(email, password, requestContext(req), req.sessionID, req.ip);

    await bindPasswordFlowToNewSession(req, pending.flowId);
    req.session.passwordFlowId = pending.flowId;
    req.session.cookie.maxAge = 10 * 60_000;
    httpResponse.json(res, {
      data: pending,
      status: 202,
      message: 'Password accepted. Check your email for a verification code.',
    });
  },
);

passwordFlowRouter.post(
  ['/password/verify', '/sign-in/verify'],
  csrfProtection,
  validateRequest({ body: passwordVerifySchema }),
  authenticationVerification('password'),
  async function passwordVerifyHandler(req, res) {
    const body = getValidated<{ body: typeof passwordVerifySchema }>(req).body!;
    const verification =
      body.kind === 'email'
        ? verifyPasswordEmailOtp(body.flowId, body.code, requestContext(req), req.sessionID)
        : verifyPasswordTotp(body.flowId, body.code, req.sessionID, body.kind);
    const result = await verification;
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
    req.session.authenticatedAt = DateTime.utc().toMillis();
    req.session.cookie.maxAge = env.SESSION_MAX_AGE_MS;
    delete req.session.passwordFlowId;
    setSessionHintCookie(res);
    httpResponse.json(res, {
      data: { authenticated: true, user: authUser },
      message: 'Password authentication complete.',
    });
  },
);

passwordFlowRouter.post(
  ['/password/resend', '/sign-in/resend'],
  csrfProtection,
  validateRequest({ body: passwordResendSchema }),
  async function passwordResendHandler(req, res) {
    const { flowId } = getValidated<{ body: typeof passwordResendSchema }>(req).body!;

    if (req.session.passwordFlowId !== flowId) {
      throw new HttpError({
        code: 'password_flow_unavailable',
        message: 'The password sign-in flow is unavailable.',
        statusCode: 401,
      });
    }
    const flow = await identityFlow(req, flowId);

    if (flow.requiredFactor !== 'email') {
      throw new HttpError({
        code: 'password_factor_invalid',
        message: 'Email verification is not available for this sign-in flow.',
        statusCode: 409,
      });
    }
    const challenge = await resendEmailOtp(flowId, requestContext(req), req.ip);

    httpResponse.json(res, { data: challenge, status: 202, message: 'Password verification code resent.' });
  },
);

passwordFlowRouter.post(
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

passwordFlowRouter.post(
  '/password/change',
  csrfProtection,
  validateRequest({ body: passwordChangeSchema }),
  authed({ authority: 'full', operation: { purpose: 'password_change', grantSource: 'session' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof passwordChangeSchema }>(req).body!;
    const user = await findUserById(current.id);

    if (!user?.passwordHash) {
      throw new HttpError({ code: 'password_invalid', message: 'The current password is invalid.', statusCode: 401 });
    }
    const valid = await verifyPassword(body.currentPassword, user.passwordHash);

    if (!valid) {
      throw new HttpError({ code: 'password_invalid', message: 'The current password is invalid.', statusCode: 401 });
    }
    await setUserPassword(current.id, body.password);
    httpResponse.json(res, { data: { passwordChanged: true }, message: 'Password changed.' });
  },
);

passwordFlowRouter.post(
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
