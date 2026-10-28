import { inject, InjectionToken } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { requireAnonymousSession, requirePrincipal } from './http';
import { requireFull, type Principal } from './identity';

export type AuthorizationContext = { principal: Principal; request: Request };
export type AuthorizationRequirement =
  readonly string[] | ((context: AuthorizationContext) => boolean | Promise<boolean>);
export type AuthorizationPolicy = (permission: string, context: AuthorizationContext) => boolean | Promise<boolean>;

export const AUTHORIZATION_POLICY = new InjectionToken<AuthorizationPolicy>('authorization policy');

export function denyPermissions(): boolean {
  return false;
}

export function anonymous(request: Request, _response: Response, next: NextFunction): void {
  try {
    requireAnonymousSession(request);
    next();
  } catch (error) {
    next(error);
  }
}

export function identified(request: Request, _response: Response, next: NextFunction): void {
  try {
    requirePrincipal(request);
    next();
  } catch (error) {
    next(error);
  }
}

export class Authorization {
  private readonly policy = inject<AuthorizationPolicy>(AUTHORIZATION_POLICY);

  authenticated(requirements: AuthorizationRequirement = []): RequestHandler {
    return this.authorized(requirements);
  }

  authorized(requirements: AuthorizationRequirement): RequestHandler {
    const policy = this.policy;
    const checks =
      typeof requirements === 'function'
        ? [requirements]
        : requirements.map((permission) => (context: AuthorizationContext) => policy(permission, context));

    return async function authorizeRequest(request, _response, next) {
      try {
        // This local prerequisite also fails closed if the upstream guard was omitted.
        // Passport's database-backed identity/session loading is not repeated here.
        const context = { principal: requireFull(request.user), request };

        for (const check of checks) {
          const allowed = await check(context);

          if (allowed !== true) {
            throw new AuthHttpError(403, 'permission_denied');
          }
        }

        next();
      } catch (error) {
        next(HttpError.is(error) ? error : new HttpError(503, 'authorization_unavailable'));
      }
    };
  }
}
