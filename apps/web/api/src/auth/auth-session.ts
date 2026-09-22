import type { Request, Response } from 'express';

import { env } from '../shared/env';

import { setSessionHintCookie } from './session-cookie';

type FullAuthenticationMethod = 'google' | 'passkey';

type FullAuthUser = Express.User & {
  authority: 'full';
  authenticationMethod: FullAuthenticationMethod;
  authVersion: number;
};

async function establishFullSession(req: Request, res: Response, user: FullAuthUser): Promise<void> {
  if (
    user.authenticationMethod === 'passkey' &&
    req.isAuthenticated() &&
    req.session.authority === 'full' &&
    req.user?.authority === 'full' &&
    req.user.id === user.id &&
    req.user.accountId === user.accountId &&
    req.user.authVersion === user.authVersion
  ) {
    return;
  }
  await new Promise<void>((resolve, reject) => req.login(user, (error) => (error ? reject(error) : resolve())));
  req.session.authority = 'full';
  req.session.authenticationMethod = user.authenticationMethod;
  req.session.authVersion = user.authVersion;
  req.session.authenticatedAt = Date.now();
  req.session.cookie.maxAge = env.SESSION_MAX_AGE_MS;
  delete req.session.secondFactor;
  // Passport saves before this metadata is assigned. Persist the complete authority
  // before the caller can finish its mutation and release the authorization lease.
  await new Promise<void>((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  setSessionHintCookie(res);
}

function refreshSessionAuthVersion(req: Request, authVersion: number): void {
  if (req.user && req.session.passport?.user?.id === req.user.id) {
    req.user.authVersion = authVersion;
    req.session.passport.user.authVersion = authVersion;
    req.session.authVersion = authVersion;
  }
}

export { establishFullSession, refreshSessionAuthVersion };
export type { FullAuthUser };
