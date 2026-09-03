import { Router, type Response } from 'express';
import { eq } from 'drizzle-orm';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import {
  consumeChallenge,
  createEmailChallenge,
  createUserDevice,
  findOrCreateUserByEmail,
  findUserById,
  findVerificationChallenge,
  isRememberedDevice,
  listMembershipsForUser,
  markChallengeConsumed,
  resolveAuthUser,
  resolveAuthUserForAccount,
  resendChallenge,
} from './auth-service';
import {
  authOpenApiPaths,
  emailOtpRequestSchema,
  emailOtpResendSchema,
  emailOtpVerifySchema,
  restrictedAccountSelectSchema,
} from './auth-schemas';

import { accounts, db, HttpError, httpResponse, users } from 'shared';

const router = Router();

const REMEMBERED_DEVICE_COOKIE = 'themis.remembered_device';
const SESSION_HINT_COOKIE = 'themis.hasSession';

function parseCookie(req: { headers: { cookie?: string } }, name: string) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;

  const raw = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);

  if (raw === undefined) {
    return undefined;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function rememberedDeviceCookieOptions() {
  return {
    httpOnly: true,
    maxAge: env.REMEMBERED_DEVICE_MAX_AGE_MS,
    path: '/',
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };
}

function sessionHintCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: false,
    maxAge: maxAgeMs,
    path: '/',
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };
}

function setSessionHintCookie(res: Response) {
  res.cookie(SESSION_HINT_COOKIE, '1', sessionHintCookieOptions(env.SESSION_MAX_AGE_MS));
}

function clearSessionHintCookie(res: Response) {
  res.clearCookie(SESSION_HINT_COOKIE, sessionHintCookieOptions(0));
}

router.get('/session', authed(), async function sessionHandler(req, res) {
  const $req = authedRequest(req);

  httpResponse.json(res, { data: { authenticated: true, user: $req.user }, message: 'Session retrieved.' });
});

router.post(
  '/email-otp/request',
  validateRequest({ body: emailOtpRequestSchema }),
  async function requestEmailOtpHandler(req, res) {
    const { email } = getValidated<{ body: typeof emailOtpRequestSchema }>(req).body!;

    const challenge = await createEmailChallenge(email);

    httpResponse.json(res, {
      data: {
        flowId: challenge.challengeId,
        resendAvailableAt: challenge.expiresAt,
      },
      status: 202,
      message: 'Verification code sent.',
    });
  },
);

router.post(
  '/email-otp/verify',
  validateRequest({ body: emailOtpVerifySchema }),
  async function verifyEmailOtpHandler(req, res) {
    const { flowId, pin } = getValidated<{ body: typeof emailOtpVerifySchema }>(req).body!;

    const challenge = await consumeChallenge(flowId, pin);
    const user = challenge.userId
      ? await findUserById(challenge.userId)
      : await findOrCreateUserByEmail(challenge.email);

    if (!user) {
      throw new HttpError({
        code: 'user_not_found',
        message: 'The account could not be found.',
        statusCode: 404,
      });
    }

    await markChallengeConsumed(challenge.id);

    if (!user.emailVerifiedAt) {
      const now = new Date();

      await db.update(users).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(users.id, user.id));
    }

    const memberships = await listMembershipsForUser(user.id);

    if (memberships.length > 1) {
      throw new HttpError({
        code: 'multiple_accounts',
        message: 'Choose an account to continue.',
        statusCode: 409,
        data: {
          accounts: await Promise.all(
            memberships.map(async (membership) => {
              const [account] = await db.select().from(accounts).where(eq(accounts.id, membership.accountId)).limit(1);

              return {
                accountId: membership.accountId,
                name: account?.name ?? membership.accountId,
                role: membership.role,
              };
            }),
          ),
          flowId: challenge.id,
        },
      });
    }

    const authUser = await resolveAuthUser({ ...user, emailVerifiedAt: user.emailVerifiedAt ?? new Date() });

    await new Promise<void>((resolve, reject) => {
      req.login(authUser, (error) => (error ? reject(error) : resolve()));
    });

    if (req.session) {
      req.session.authority = 'restricted';
      req.session.passkeyRegistration = { challengeId: challenge.id, email: user.email, label: '' };
    }

    setSessionHintCookie(res);

    httpResponse.json(res, {
      data: { kind: 'restricted' as const, user: authUser, flowId: challenge.id },
      message: 'Email verified.',
    });
  },
);

router.post(
  '/restricted/accounts',
  validateRequest({ body: restrictedAccountSelectSchema }),
  async function selectRestrictedAccountHandler(req, res) {
    const { accountId, flowId } = getValidated<{ body: typeof restrictedAccountSelectSchema }>(req).body!;
    const challenge = await findVerificationChallenge(flowId);

    if (!challenge?.consumedAt) {
      throw new HttpError({
        code: 'challenge_mismatch',
        message: 'Verify the email before choosing an account.',
        statusCode: 400,
      });
    }

    if (!challenge.userId) {
      throw new HttpError({
        code: 'challenge_mismatch',
        message: 'Choose an account from the verified email flow.',
        statusCode: 400,
      });
    }

    const user = await findUserById(challenge.userId);

    if (!user)
      throw new HttpError({ code: 'user_not_found', message: 'The account could not be found.', statusCode: 404 });
    const authUser = await resolveAuthUserForAccount(user, accountId);

    await new Promise<void>((resolve, reject) => req.login(authUser, (error) => (error ? reject(error) : resolve())));
    if (req.session) {
      req.session.authority = 'restricted';
      req.session.passkeyRegistration = { challengeId: flowId, email: user.email, label: '' };
    }
    setSessionHintCookie(res);
    httpResponse.json(res, {
      data: { kind: 'restricted' as const, user: authUser, flowId },
      message: 'Account selected.',
    });
  },
);

router.post(
  '/email-otp/resend',
  validateRequest({ body: emailOtpResendSchema }),
  async function resendEmailOtpHandler(req, res) {
    const { flowId } = getValidated<{ body: typeof emailOtpResendSchema }>(req).body!;

    const challenge = await resendChallenge(flowId);

    httpResponse.json(res, {
      data: { flowId: challenge.challengeId, resendAvailableAt: challenge.expiresAt },
      status: 202,
      message: 'Verification code resent.',
    });
  },
);

router.post(
  '/sign-in/remember-device',
  validateRequest({ body: emailOtpVerifySchema }),
  async function rememberDeviceHandler(req, res) {
    const { flowId, pin } = getValidated<{ body: typeof emailOtpVerifySchema }>(req).body!;
    const challenge = await consumeChallenge(flowId, pin);

    if (!req.session) {
      throw new HttpError({
        code: 'session_missing',
        message: 'Sign in again before remembering this device.',
        statusCode: 401,
      });
    }

    if (!challenge.userId) {
      throw new HttpError({
        code: 'authentication_required',
        message: 'Sign in before remembering this device.',
        statusCode: 401,
      });
    }

    const remembered = await isRememberedDevice(challenge.userId, parseCookie(req, REMEMBERED_DEVICE_COOKIE));

    if (!remembered) {
      const token = await createUserDevice(challenge.userId);

      res.cookie(REMEMBERED_DEVICE_COOKIE, token, rememberedDeviceCookieOptions());
    }

    httpResponse.json(res, { data: { remembered: true }, message: 'Device remembered.' });
  },
);

router.post('/sign-out', authed(), async function signOutHandler(req, res) {
  await new Promise<void>((resolve, reject) => {
    req.logout((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });

  req.session.destroy(() => undefined);
  res.clearCookie('connect.sid');
  res.clearCookie(REMEMBERED_DEVICE_COOKIE);
  clearSessionHintCookie(res);
  res.status(204).send();
});

export { authOpenApiPaths, router as authRouter };
