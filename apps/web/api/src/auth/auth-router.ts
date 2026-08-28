import passport from 'passport';
import { Router, type CookieOptions, type NextFunction, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import {
  createUserDevice,
  signUp,
  verifyChallenge,
  findUserById,
  beginSignIn,
  resendChallenge,
  requestPasswordReset,
  resolveAuthUser,
  submitPasswordReset,
} from './auth-service';
import {
  authOpenApiPaths,
  challengeVerificationSchema,
  credentialsSchema,
  forgottenPasswordSchema,
  passwordResetSchema,
  passwordResetVerifySchema,
  resendVerificationSchema,
  securityPasswordSchema,
} from './auth-schemas';
import { csrfProtection, passwordRateLimit } from './passkey-security';
import { hashSecret } from './auth-crypto';

import { db, HttpError, httpResponse, users } from 'shared';

const router = Router();

const REMEMBERED_DEVICE_COOKIE = 'themis.remembered_device';
const SESSION_HINT_COOKIE = 'themis.hasSession';

function parseCookie(req: Request, name: string) {
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

function rememberedDeviceCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    maxAge: env.REMEMBERED_DEVICE_MAX_AGE_MS,
    path: '/',
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
  };
}

function sessionHintCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: false,
    maxAge: maxAgeMs,
    path: '/',
    sameSite: 'lax',
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

router.get('/security/password', authed(), async function passwordStatusHandler(req, res) {
  const user = await findUserById(authedRequest(req).user.id);

  if (!user || !user.emailVerifiedAt)
    throw new HttpError({
      code: 'account_pending',
      message: 'Verify your account before changing security settings.',
      statusCode: 403,
    });
  httpResponse.json(res, {
    data: { configured: user.passwordConfigured, setupAvailable: !user.passwordConfigured },
    message: 'Password status retrieved.',
  });
});

router.post('/security/password/reauthenticate', authed(), csrfProtection, async (req, res) => {
  const authenticatedAt = req.session?.authenticatedAt;

  if (!authenticatedAt || Date.now() - authenticatedAt > 10 * 60 * 1000)
    throw new HttpError({
      code: 'reauthentication_required',
      message: 'Confirm your recent sign-in before changing security settings.',
      statusCode: 401,
    });
  req.session.reauthenticatedAt = Date.now();
  res.status(204).send();
});

router.post(
  '/security/password',
  authed(),
  csrfProtection,
  passwordRateLimit,
  validateRequest({ body: securityPasswordSchema }),
  async (req, res) => {
    const session = req.session;
    const user = await findUserById(authedRequest(req).user.id);

    if (!user || !user.emailVerifiedAt)
      throw new HttpError({
        code: 'account_pending',
        message: 'Verify your account before changing security settings.',
        statusCode: 403,
      });
    if (!session?.reauthenticatedAt || Date.now() - session.reauthenticatedAt > 10 * 60 * 1000)
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'Confirm your recent sign-in before changing security settings.',
        statusCode: 401,
      });
    if (user.passwordConfigured)
      throw new HttpError({
        code: 'password_already_configured',
        message: 'A password is already configured for this account.',
        statusCode: 409,
      });
    const { password } = getValidated<{ body: typeof securityPasswordSchema }>(req).body!;
    const passwordHash = await hashSecret(password);
    const [updated] = await db
      .update(users)
      .set({ passwordHash, passwordConfigured: true, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.passwordConfigured, false)))
      .returning();

    if (!updated)
      throw new HttpError({
        code: 'password_already_configured',
        message: 'A password is already configured for this account.',
        statusCode: 409,
      });
    delete session.reauthenticatedAt;
    res.status(204).send();
  },
);

router.post('/sign-up', validateRequest({ body: credentialsSchema }), async function signUpHandler(req, res) {
  const { email, password } = getValidated<{ body: typeof credentialsSchema }>(req).body!;

  const challenge = await signUp(email, password);

  httpResponse.json(res, { data: challenge, status: 201, message: 'Verification code sent.' });
});

router.post(
  '/sign-up/verify',
  validateRequest({ body: challengeVerificationSchema }),
  async function verifySignUpHandler(req, res) {
    const { challengeId, pin } = getValidated<{ body: typeof challengeVerificationSchema }>(req).body!;

    const user = await verifyChallenge(challengeId, pin, 'sign_up');

    await new Promise<void>((resolve, reject) => {
      req.login(user, (error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve();
      });
    });

    req.session.authenticatedAt = Date.now();
    setSessionHintCookie(res);

    httpResponse.json(res, { data: { authenticated: true, user }, message: 'Sign-up complete.' });
  },
);

router.post(
  '/sign-in/password',
  validateRequest({ body: credentialsSchema }),
  function signInPasswordHandler(req: Request, res: Response, next: NextFunction) {
    const credentials = getValidated<{ body: typeof credentialsSchema }>(req).body!;

    req.body = credentials;

    passport.authenticate(
      'local',
      { session: false },
      async function passportCallback(error: unknown, user?: Express.User, info?: { message?: string }) {
        if (error) {
          next(error);

          return;
        }

        if (!user) {
          next(
            new HttpError({
              code: 'invalid_credentials',
              message: info?.message ?? 'Incorrect email or password.',
              statusCode: 401,
            }),
          );

          return;
        }

        try {
          const fullUser = await findUserById(user.id);

          if (!fullUser) {
            throw new HttpError({
              code: 'user_not_found',
              message: 'The account could not be found.',
              statusCode: 404,
            });
          }

          const challenge = await beginSignIn(fullUser, parseCookie(req, REMEMBERED_DEVICE_COOKIE));

          if (!challenge) {
            const user = await resolveAuthUser(fullUser);

            await new Promise<void>((resolve, reject) => {
              req.login(user, (error) => {
                if (error) {
                  reject(error);

                  return;
                }

                resolve();
              });
            });

            req.session.authenticatedAt = Date.now();

            setSessionHintCookie(res);

            httpResponse.json(res, { data: { authenticated: true, user }, message: 'Sign-in complete.' });

            return;
          }

          httpResponse.json(res, { data: challenge, message: 'Verification code sent.' });
        } catch (innerError) {
          next(innerError);
        }
      },
    )(req, res, next);
  },
);

router.post(
  '/sign-in/verify',
  validateRequest({ body: challengeVerificationSchema }),
  async function verifySignInHandler(req, res) {
    const { challengeId, pin, rememberDevice } = getValidated<{ body: typeof challengeVerificationSchema }>(req).body!;

    const user = await verifyChallenge(challengeId, pin, 'sign_in');

    if (rememberDevice) {
      res.cookie(REMEMBERED_DEVICE_COOKIE, await createUserDevice(user.id), rememberedDeviceCookieOptions());
    }

    await new Promise<void>((resolve, reject) => {
      req.login(user, (error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve();
      });
    });

    req.session.authenticatedAt = Date.now();
    setSessionHintCookie(res);

    httpResponse.json(res, { data: { authenticated: true, user }, message: 'Sign-in complete.' });
  },
);

router.post(
  '/verification/resend',
  validateRequest({ body: resendVerificationSchema }),
  async function resendVerificationHandler(req, res) {
    const { challengeId } = getValidated<{ body: typeof resendVerificationSchema }>(req).body!;

    const challenge = await resendChallenge(challengeId);

    httpResponse.json(res, { data: challenge, message: 'Verification code resent.' });
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
  clearSessionHintCookie(res);
  res.status(204).send();
});

router.post(
  '/password/forgotten',
  validateRequest({ body: forgottenPasswordSchema }),
  async function forgottenPasswordHandler(req, res) {
    const { email } = getValidated<{ body: typeof forgottenPasswordSchema }>(req).body!;

    const challenge = await requestPasswordReset(email);

    if (!challenge) {
      httpResponse.json(res, {
        data: null,
        message: 'If an account exists for that email, a reset link has been sent.',
      });

      return;
    }

    httpResponse.json(res, { data: challenge, message: 'Recovery code sent.' });
  },
);

router.post(
  '/password/reset/verify',
  validateRequest({ body: passwordResetVerifySchema }),
  async function passwordResetVerifyHandler(req, res) {
    const { challengeId, pin } = getValidated<{ body: typeof passwordResetVerifySchema }>(req).body!;

    const user = await verifyChallenge(challengeId, pin, 'password_reset');

    if (req.session) {
      req.session.resetPassword = {
        challengeId,
        email: user.email,
        userId: user.id,
      };
    }

    httpResponse.json(res, { data: { active: true, email: user.email }, message: 'Reset session established.' });
  },
);

router.get('/password/reset/session', function passwordResetSessionHandler(req, res) {
  const session = req.session?.resetPassword;

  if (!session) {
    httpResponse.json(res, { data: { active: false, email: null }, message: 'No active reset session.' });

    return;
  }

  httpResponse.json(res, { data: { active: true, email: session.email }, message: 'Reset session active.' });
});

router.post(
  '/password/reset',
  validateRequest({ body: passwordResetSchema }),
  async function passwordResetSubmitHandler(req, res, next) {
    const session = req.session?.resetPassword;

    if (!session) {
      next(
        new HttpError({
          code: 'reset_session_missing',
          message: 'The reset session has expired. Restart the recovery flow.',
          statusCode: 401,
        }),
      );

      return;
    }

    try {
      const { password } = getValidated<{ body: typeof passwordResetSchema }>(req).body!;

      await submitPasswordReset(session.userId, password);

      if (req.session) {
        delete req.session.resetPassword;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export { authOpenApiPaths, router as authRouter };
