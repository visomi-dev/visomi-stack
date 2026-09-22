import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { and, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { consumeAuthenticationVerificationLimit } from './passkey-security';

import { authOperationGrants, db, HttpError, isSessionAuthorityStore, users } from 'shared';

export function hasCurrentAuthVersion(serializedVersion: number | undefined, currentVersion: number): boolean {
  return (serializedVersion ?? 1) === currentVersion;
}

async function consumeOperationGrant(
  id: string,
  userId: string,
  purpose: string,
  sessionBinding: string,
): Promise<boolean> {
  const [grant] = await db
    .update(authOperationGrants)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authOperationGrants.id, id),
        eq(authOperationGrants.userId, userId),
        eq(authOperationGrants.purpose, purpose),
        eq(authOperationGrants.sessionBinding, sessionBinding),
        isNotNull(authOperationGrants.verifiedAt),
        isNull(authOperationGrants.consumedAt),
        gt(authOperationGrants.expiresAt, new Date()),
      ),
    )
    .returning();

  return Boolean(grant);
}

type AuthenticatedContext = {
  accountId: string;
  role: string;
  userId: string;
};

type AuthenticatedRequest = Request & {
  user: Express.User;
};

type AuthenticatedOptions = {
  authority?: 'full';
  roles?: string[];
  operation?: { purpose: string; grantSource: 'body' | 'session' };
};

export function authed(options?: AuthenticatedOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const proceed = async () => {
      if (!req.isAuthenticated?.() || !req.user) {
        next(
          new HttpError({
            code: 'authentication_required',
            message: 'Sign in to access this resource.',
            statusCode: 401,
          }),
        );

        return;
      }

      if (
        (options?.authority === 'full' || options?.operation) &&
        (req.session?.authority !== 'full' || req.user.authority !== 'full')
      ) {
        next(
          new HttpError({
            code: 'full_session_required',
            message: 'Complete passkey verification to access this resource.',
            statusCode: 403,
          }),
        );

        return;
      }

      if (req.user.authority === 'restricted') {
        requireRestrictedAuthority(req);
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

      if (options?.operation) {
        const grantId: unknown =
          options.operation.grantSource === 'body' ? req.body?.grantId : req.session.reauthGrantId;

        if (
          typeof grantId !== 'string' ||
          !(await consumeOperationGrant(grantId, req.user.id, options.operation.purpose, req.sessionID))
        ) {
          throw new HttpError({
            code: 'reauthentication_required',
            message: 'Reauthenticate before changing security settings.',
            statusCode: 401,
          });
        }
      }
      next();
    };

    if (!req.isAuthenticated?.() || !req.user) {
      await proceed();

      return;
    }
    if (options?.operation || !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      await withMutationLease(req, res, proceed);
    } else await proceed();
  };
}

const leasedRequests = new WeakSet<Request>();

/** Mixed public/authenticated routers use this before dispatching mutable authenticated work. */
export const authenticatedMutation: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated?.() || !req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();

    return;
  }

  return withMutationLease(req, res, async () => {
    next();
  });
};

async function withMutationLease(req: Request, res: Response, proceed: () => Promise<void>): Promise<void> {
  if (leasedRequests.has(req)) {
    await proceed();

    return;
  }
  if (!isSessionAuthorityStore(req.sessionStore)) {
    throw new HttpError({
      code: 'session_authority_unavailable',
      message: 'Session authorization is unavailable.',
      statusCode: 503,
    });
  }
  const user = authedRequest(req).user;

  try {
    await req.sessionStore.withSessionAuthority(
      {
        userId: user.id,
        authVersion: user.authVersion ?? 1,
        currentSid: req.sessionID,
        authority: user.authority ?? 'full',
      },
      async () => {
        try {
          // Discard the pre-lease snapshot: otherwise a waiting request can restore
          // consumed security state when it saves. Mutations belong after this boundary.
          await new Promise<void>((resolve, reject) =>
            req.session.reload((error) => (error ? reject(error) : resolve())),
          );
          // Use this request's Passport instance (also works across gateway bundles).
          // Deserialization resolves the partial stored identity and current membership.
          const passport = (req as Request & { _passport?: { instance: { session: () => RequestHandler } } })._passport
            ?.instance;

          if (!passport) {
            throw new HttpError({
              code: 'session_authority_unavailable',
              message: 'Session authorization is unavailable.',
              statusCode: 503,
            });
          }
          req.user = undefined;
          await new Promise<void>((resolve, reject) =>
            passport.session()(req, res, (error?: unknown) => (error ? reject(error) : resolve())),
          );
          const current = req.user as Express.User | undefined;

          if (!req.isAuthenticated?.() || !current || current.id !== user.id) {
            throw new HttpError({ code: 'authentication_required', message: 'Sign in again.', statusCode: 401 });
          }
          if (current.authority === 'restricted') requireRestrictedAuthority(req);
          const [fresh] = await db.select({ authVersion: users.authVersion }).from(users).where(eq(users.id, user.id));

          if (!fresh || !hasCurrentAuthVersion(current.authVersion, fresh.authVersion)) {
            throw new HttpError({ code: 'authentication_required', message: 'Sign in again.', statusCode: 401 });
          }
        } catch (error) {
          // A failed refresh must not let express-session auto-save this request's
          // snapshot after the lease releases. Discard it without destroying the SID.
          const request: { session?: Request['session'] } = req;

          delete request.session;
          req.user = undefined;
          throw error;
        }
        let complete!: () => void;
        let fail!: (error: unknown) => void;
        const ended = new Promise<void>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        });
        const originalEnd = res.end;
        let ending = false;
        // End-of-handler boundary, not socket lifetime. A disconnected client's handler may still commit.
        // Handlers must await all mutations before ending their response; never detach protected work.
        const end: Response['end'] = function (this: Response, ...args: unknown[]) {
          if (ending) return this;
          ending = true;
          const finish = (error?: unknown) => {
            res.end = originalEnd;
            if (error) {
              fail(error);

              return;
            }
            try {
              Reflect.apply(originalEnd, this, args);
              complete();
            } catch (error) {
              fail(error);
            }
          };

          // express-session's end returns before its asynchronous save completes.
          // Save first while authority is held, including rotated/restricted sessions.
          if (req.session) req.session.save(finish);
          else finish();

          return this;
        };

        res.end = end;
        leasedRequests.add(req);
        try {
          await proceed();
          await ended;
        } finally {
          leasedRequests.delete(req);
          if (res.end === end) res.end = originalEnd;
        }
      },
    );
  } catch (error) {
    // The store may belong to the separately bundled gateway; do not rely on instanceof.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'session_authority_invalid') {
      throw new HttpError({ code: 'authentication_required', message: 'Sign in again.', statusCode: 401 });
    }
    throw error;
  }
}

function requireRestrictedAuthority(req: Request, operation?: string): void {
  const restricted = req.session?.restrictedAuth;

  if (
    !req.user ||
    req.user.authority !== 'restricted' ||
    req.session?.authority !== 'restricted' ||
    !restricted ||
    restricted.expiresAt <= Date.now() ||
    restricted.userId !== req.user.id ||
    restricted.selectedAccountId !== req.user.accountId ||
    (operation && !restricted.allowedOperations.includes(operation))
  ) {
    throw new HttpError({
      code: 'restricted_session_required',
      message: 'Verify an email code before continuing.',
      statusCode: 401,
    });
  }
}

export function restrictedOperation(operation: string): RequestHandler {
  return (req, _res, next) => {
    requireRestrictedAuthority(req, operation);
    next();
  };
}

export function authenticationVerification(kind: 'password' | 'reauth'): RequestHandler {
  return async (req, res, next) => {
    let limit;

    try {
      limit = await consumeAuthenticationVerificationLimit(req);
    } catch {
      throw new HttpError({
        code: 'auth_limiter_unavailable',
        message: 'Authentication is temporarily unavailable.',
        statusCode: 503,
      });
    }
    if (!limit.allowed) {
      res.setHeader('Retry-After', limit.retryAfter);
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many verification attempts; retry after the cooldown.',
        statusCode: 429,
      });
    }
    if (kind === 'password') {
      if (!req.session?.passwordFlowId || req.session.passwordFlowId !== req.body.flowId) {
        throw new HttpError({
          code: 'password_flow_unavailable',
          message: 'The password sign-in flow is unavailable.',
          statusCode: 401,
        });
      }
    } else {
      const grantId: unknown = req.body.grantId;

      if (typeof grantId !== 'string' || req.session.reauthGrantId !== grantId || !req.user) {
        throw new HttpError({
          code: 'reauthentication_required',
          message: 'The reauthentication request is unavailable.',
          statusCode: 401,
        });
      }
      const [grant] = await db
        .update(authOperationGrants)
        .set({ attemptCount: sql`${authOperationGrants.attemptCount} + 1` })
        .where(
          and(
            eq(authOperationGrants.id, grantId),
            eq(authOperationGrants.userId, req.user.id),
            eq(authOperationGrants.sessionBinding, req.sessionID),
            isNull(authOperationGrants.consumedAt),
            isNull(authOperationGrants.verifiedAt),
            gt(authOperationGrants.expiresAt, new Date()),
            lt(authOperationGrants.attemptCount, 5),
          ),
        )
        .returning();

      if (!grant)
        throw new HttpError({
          code: 'reauthentication_required',
          message: 'The reauthentication request is unavailable.',
          statusCode: 401,
        });
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
