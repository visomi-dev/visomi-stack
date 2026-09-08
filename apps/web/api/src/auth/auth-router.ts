import { Router, type Request } from 'express';

import { getValidated, validateRequest } from '../shared/http/route-schemas';

import {
  clientContextHash,
  findUserById,
  resolveAuthUserForAccount,
  requestEmailOtp,
  resendEmailOtp,
  verifyEmailOtp,
} from './auth-service';
import {
  authOpenApiPaths,
  emailOtpRequestSchema,
  emailOtpResendSchema,
  emailOtpVerifySchema,
  restrictedAccountSelectSchema,
} from './auth-schemas';
import { csrfProtection, emailOtpDeliveryRateLimit, emailOtpVerificationRateLimit } from './passkey-security';
import { clearSessionHintCookie } from './session-cookie';

import { HttpError, httpResponse } from 'shared';

const router = Router();

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
