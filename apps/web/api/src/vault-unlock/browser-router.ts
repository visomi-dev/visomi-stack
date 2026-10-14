import { Router } from 'express';
import type { Request } from 'express';

import { authed, authedRequest } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import {
  browserApprovalInput,
  browserConsumptionInput,
  browserEnrollmentInput,
  browserEnrollmentParams,
} from './browser-contract';
import {
  approveBrowserEnrollment,
  beginBrowserEnrollment,
  cancelBrowserEnrollment,
  consumeBrowserEnrollment,
  inspectBrowserEnrollment,
} from './browser-enrollments';
import { unlockScopeParams } from './contract';

import { env, fail } from 'shared';

// The parent router owns full-session authority, CSRF and no-store middleware.
export const browserUnlockRouter = Router();

browserUnlockRouter.use('/:scopeId/browser-enrollments', (_req, _res, next) => {
  if (!env.VAULT_BROWSER_ENABLED) fail('vault_browser_unavailable', 'Browser key delivery is unavailable.', 503);
  next();
});

function owner(req: Request) {
  const { user } = authedRequest(req);

  if (!user.authVersion || !req.sessionID) fail('vault_access_denied', 'Sign in again.', 403);

  return { userId: user.id, accountId: user.accountId, authVersion: user.authVersion, sessionId: req.sessionID };
}

browserUnlockRouter.post(
  '/:scopeId/browser-enrollments',
  validateRequest({ params: unlockScopeParams, body: browserEnrollmentInput }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof browserEnrollmentInput }>(
      req,
    );

    res.status(201).json({ data: await beginBrowserEnrollment(owner(req), params.scopeId, body.pairing) });
  },
);
browserUnlockRouter.get(
  '/:scopeId/browser-enrollments/:requestId',
  validateRequest({ params: browserEnrollmentParams }),
  async (req, res) => {
    const { params } = getValidated<{ params: typeof browserEnrollmentParams }>(req);

    res.json({ data: await inspectBrowserEnrollment(owner(req), params.scopeId, params.requestId) });
  },
);
browserUnlockRouter.delete(
  '/:scopeId/browser-enrollments/:requestId',
  validateRequest({ params: browserEnrollmentParams }),
  async (req, res) => {
    const { params } = getValidated<{ params: typeof browserEnrollmentParams }>(req);

    await cancelBrowserEnrollment(owner(req), params.scopeId, params.requestId);
    res.sendStatus(204);
  },
);
browserUnlockRouter.post(
  '/:scopeId/browser-enrollments/:requestId/approve',
  validateRequest({ params: browserEnrollmentParams, body: browserApprovalInput }),
  authed({ operation: { purpose: 'vault_unlock_manage', grantSource: 'body' } }),
  async (req, res) => {
    const { params, body } = getValidated<{
      params: typeof browserEnrollmentParams;
      body: typeof browserApprovalInput;
    }>(req);

    await approveBrowserEnrollment(owner(req), params.scopeId, params.requestId, body.fingerprint, body.envelope);
    res.sendStatus(204);
  },
);
browserUnlockRouter.post(
  '/:scopeId/browser-enrollments/:requestId/consume',
  validateRequest({ params: browserEnrollmentParams, body: browserConsumptionInput }),
  async (req, res) => {
    const { params, body } = getValidated<{
      params: typeof browserEnrollmentParams;
      body: typeof browserConsumptionInput;
    }>(req);

    res.json({ data: await consumeBrowserEnrollment(owner(req), params.scopeId, params.requestId, body) });
  },
);
