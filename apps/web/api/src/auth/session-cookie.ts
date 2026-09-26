import type { Response } from 'express';

import { env } from '../shared/env';

const SESSION_HINT_COOKIE = 'themis.hasSession';

function sessionHintCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: false,
    maxAge: maxAgeMs,
    path: '/',
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };
}

function clearSessionHintCookie(res: Response): void {
  res.clearCookie(SESSION_HINT_COOKIE, sessionHintCookieOptions(0));
}

function setSessionHintCookie(res: Response): void {
  res.cookie(SESSION_HINT_COOKIE, '1', sessionHintCookieOptions(env.SESSION_MAX_AGE_MS));
}

export { clearSessionHintCookie, setSessionHintCookie };
