import { Router } from 'express';
import type { Request } from 'express';

import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import { csrfProtection } from './passkey-security';
import { sessionRevokeOthersSchema, sessionRevokeSchema } from './session-schemas';

import { env, HttpError, isManagedSessionStore } from 'shared';
import type { SessionScope } from 'shared';

function context(req: Request) {
  const { user } = authedRequest(req);
  const authVersion = user.authVersion;

  if (
    !authVersion ||
    req.session.passport?.user?.id !== user.id ||
    req.session.passport.user.authVersion !== authVersion
  ) {
    throw new HttpError({ code: 'authentication_required', message: 'Sign in again.', statusCode: 401 });
  }
  if (!isManagedSessionStore(req.sessionStore)) {
    throw new HttpError({
      code: 'sessions_unavailable',
      message: 'Session management is unavailable.',
      statusCode: 503,
    });
  }
  const scope: SessionScope = { userId: user.id, authVersion, currentSid: req.sessionID, secret: env.SESSION_SECRET };

  return { store: req.sessionStore, scope };
}

export const sessionRouter = Router();
sessionRouter.use(csrfProtection, authed({ authority: 'full' }));
sessionRouter.get('/', async (req, res) => {
  const { store, scope } = context(req);

  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: await store.listManagedSessions(scope), message: 'Active sessions.' });
});
sessionRouter.post(
  '/revoke',
  validateRequest({ body: sessionRevokeSchema }),
  authed({ operation: { purpose: 'sessions_revoke', grantSource: 'body' } }),
  async (req, res) => {
    const { store, scope } = context(req);
    const { body } = getValidated<{ body: typeof sessionRevokeSchema }>(req);
    const revoked = await store.revokeManagedSessions(scope, body.id);

    res.json({ data: { revoked }, message: 'Session revocation completed.' });
  },
);
sessionRouter.post(
  '/revoke-others',
  validateRequest({ body: sessionRevokeOthersSchema }),
  authed({ operation: { purpose: 'sessions_revoke', grantSource: 'body' } }),
  async (req, res) => {
    const { store, scope } = context(req);
    const revoked = await store.revokeManagedSessions(scope);

    res.json({ data: { revoked }, message: 'Other sessions revoked.' });
  },
);
