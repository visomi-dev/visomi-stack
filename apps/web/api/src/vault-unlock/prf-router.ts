import { Router } from 'express';
import type { Request } from 'express';

import { authed, authedRequest } from '../auth/auth-middleware';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { unlockScopeParams } from './contract';
import { beginUnlockAssertion, completeUnlockAssertion } from './prf-assertions';
import {
  assertionBeginInput,
  assertionCompleteInput,
  methodCreateInput,
  methodDeleteInput,
  unlockMethodParams,
} from './prf-contract';
import { createUnlockMethod, listUnlockMethods, revokeUnlockMethod } from './prf-store';

import { env, fail } from 'shared';

// Mounted behind the parent router's full-session, CSRF and no-store middleware.
export const prfUnlockRouter = Router();

prfUnlockRouter.use(['/:scopeId/methods', '/:scopeId/assertions'], (_req, _res, next) => {
  if (!env.VAULT_PRF_ENABLED) fail('vault_prf_unavailable', 'Passkey vault unlock is unavailable.', 503);
  next();
});

function owner(req: Request) {
  const { user } = authedRequest(req);

  if (!user.authVersion || !req.sessionID) fail('vault_access_denied', 'Sign in again.', 403);

  return { userId: user.id, accountId: user.accountId, authVersion: user.authVersion, sessionId: req.sessionID };
}

prfUnlockRouter.get('/:scopeId/methods', validateRequest({ params: unlockScopeParams }), async (req, res) => {
  const { params } = getValidated<{ params: typeof unlockScopeParams }>(req);

  res.json({ data: await listUnlockMethods(owner(req), params.scopeId) });
});
prfUnlockRouter.post(
  '/:scopeId/assertions/begin',
  validateRequest({ params: unlockScopeParams, body: assertionBeginInput }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof assertionBeginInput }>(req);

    res.status(201).json({ data: await beginUnlockAssertion(owner(req), params.scopeId, body) });
  },
);
prfUnlockRouter.post(
  '/:scopeId/assertions/complete',
  validateRequest({ params: unlockScopeParams, body: assertionCompleteInput }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof assertionCompleteInput }>(
      req,
    );

    res.json({ data: await completeUnlockAssertion(owner(req), params.scopeId, body) });
  },
);
prfUnlockRouter.post(
  '/:scopeId/methods',
  validateRequest({ params: unlockScopeParams, body: methodCreateInput }),
  authed({ operation: { purpose: 'vault_unlock_manage', grantSource: 'body' } }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof methodCreateInput }>(req);

    res.status(201).json({ data: await createUnlockMethod(owner(req), params.scopeId, body) });
  },
);
prfUnlockRouter.delete(
  '/:scopeId/methods/:methodId',
  validateRequest({ params: unlockMethodParams, body: methodDeleteInput }),
  authed({ operation: { purpose: 'vault_unlock_manage', grantSource: 'body' } }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockMethodParams; body: typeof methodDeleteInput }>(req);

    await revokeUnlockMethod(owner(req), params.scopeId, params.methodId, body.expectedRevision);
    res.sendStatus(204);
  },
);
