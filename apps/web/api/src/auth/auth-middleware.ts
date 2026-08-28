import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { HttpError } from 'shared';

type AuthenticatedContext = {
  accountId: string;
  role: string;
  userId: string;
};

type AuthenticatedRequest = Request & {
  user: Express.User;
};

type AuthenticatedOptions = {
  roles?: string[];
};

export function authed(options?: AuthenticatedOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      next(
        new HttpError({
          code: 'authentication_required',
          message: 'Sign in to access this resource.',
          statusCode: 401,
        }),
      );

      return;
    }

    if (options?.roles && !options.roles.includes(req.user.role)) {
      next(
        new HttpError({
          code: 'forbidden',
          message: 'You do not have access to this resource.',
          statusCode: 403,
        }),
      );

      return;
    }

    next();
  };
}

export function authedRequest(req: Request): AuthenticatedRequest {
  if (!req.user) {
    throw new HttpError({
      code: 'authentication_required',
      message: 'Sign in to access this resource.',
      statusCode: 401,
    });
  }

  return req as AuthenticatedRequest;
}

export function authedContext(req: Request): AuthenticatedContext {
  const $req = authedRequest(req);

  return {
    accountId: $req.user.accountId,
    role: $req.user.role,
    userId: $req.user.id,
  };
}

export type { AuthenticatedContext, AuthenticatedOptions, AuthenticatedRequest };
