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
  await new Promise<void>((resolve, reject) => req.login(user, (error) => (error ? reject(error) : resolve())));
  req.session.authority = 'full';
  req.session.authenticationMethod = user.authenticationMethod;
  req.session.authVersion = user.authVersion;
  req.session.authenticatedAt = Date.now();
  req.session.cookie.maxAge = env.SESSION_MAX_AGE_MS;
  delete req.session.secondFactor;
  setSessionHintCookie(res);
}

export { establishFullSession };
export type { FullAuthUser };
