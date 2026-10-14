import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import express, { json } from 'express';
import session from 'express-session';

import { authRouter } from './auth-router';
import { passport } from './passport';
import { establishFullSession } from './auth-session';
import { authed } from './auth-middleware';
import { findOrCreateUserByEmail, resolveAuthUserForAccount } from './auth-identity';
import { setUserPassword } from './password-session';

import { db, errorHandler, ManagedMemorySessionStore, users } from 'shared';

export const store = new ManagedMemorySessionStore();

export const password = 'a secure test password';

export function appFor(user: Express.User) {
  const app = express();

  app.use(json());
  app.use(
    session({ secret: 'authentication-regression-session-secret', resave: false, saveUninitialized: false, store }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.post('/test/login', (req, res, next) => {
    req.login(user, (error) => {
      if (error) {
        return next(error);
      }
      req.session.authority = user.authority;
      if (user.authority === 'restricted') {
        req.session.restrictedAuth = {
          allowedOperations: ['password:set', 'passkeys:enroll'],
          eligibleAccounts: [{ accountId: user.accountId, role: user.role, name: 'Test' }],
          expiresAt: Date.now() + 60_000,
          flowId: randomUUID(),
          issuedAt: Date.now(),
          isNewUser: true,
          purpose: 'bootstrap_recovery',
          selectedAccountId: user.accountId,
          userId: user.id,
          verifiedEmail: user.email,
        };
      }
      res.sendStatus(204);
    });
  });
  // Simulate the verified assertion boundary; Passport and session storage stay real.
  app.post('/test/passkey', authed({ authority: 'full' }), async (req, res) => {
    await establishFullSession(req, res, {
      ...req.user!,
      authority: 'full',
      authenticationMethod: 'passkey',
      authVersion: req.user!.authVersion!,
    });
    req.session.passkeySecurityReauthenticatedAt = Date.now();
    res.json({ sessionId: req.sessionID, grantId: req.session.reauthGrantId, nonce: req.session.googleNonce });
  });
  app.get('/test/context', authed(), (req, res) =>
    res.json({
      user: req.user,
      sessionId: req.sessionID,
      restricted: req.session.restrictedAuth,
      nonce: req.session.googleNonce,
    }),
  );
  app.use('/auth', authRouter);
  app.use(errorHandler);

  return app;
}

export async function identity(authority: 'full' | 'restricted' = 'full') {
  const user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);

  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  const authVersion = await setUserPassword(user.id, password);

  const resolvedUser = await resolveAuthUserForAccount({ ...user, authVersion });

  return { ...resolvedUser, authority };
}
