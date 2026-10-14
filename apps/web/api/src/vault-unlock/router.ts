import { Router } from 'express';
import type { Request } from 'express';

import { authed, authedRequest } from '../auth/auth-middleware';
import { csrfProtection } from '../auth/passkey-security';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { browserUnlockRouter } from './browser-router';
import {
  localPinInput,
  pinAttemptInput,
  recoveryExportInput,
  localPinDeleteInput,
  unlockScopeParams,
} from './contract';
import {
  authorizePinProfile,
  consumePinAttempt,
  lockUnlockScope,
  readPinProfile,
  readPinMethodId,
  revokePinProfile,
} from './pin-profile';
import { prfUnlockRouter } from './prf-router';

import { env, HttpError, withAccountContext } from 'shared';

export const vaultUnlockRouter = Router();

function owner(req: Request) {
  const { user } = authedRequest(req);

  if (!user.authVersion)
    throw new HttpError({ code: 'vault_access_denied', message: 'Sign in again.', statusCode: 403 });

  return { userId: user.id, accountId: user.accountId, authVersion: user.authVersion };
}

vaultUnlockRouter.use(
  (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  },
  csrfProtection,
  authed({ authority: 'full' }),
);
vaultUnlockRouter.use(prfUnlockRouter);
vaultUnlockRouter.use(browserUnlockRouter);
vaultUnlockRouter.get('/:scopeId/config', validateRequest({ params: unlockScopeParams }), async (req, res) => {
  const { params } = getValidated<{ params: typeof unlockScopeParams }>(req);
  const pinMethodId = await readPinMethodId(owner(req), params.scopeId);

  res.json({ data: { prf: env.VAULT_PRF_ENABLED, pin: true, browser: env.VAULT_BROWSER_ENABLED, pinMethodId } });
});
vaultUnlockRouter.get('/:scopeId/pin-profile', validateRequest({ params: unlockScopeParams }), async (req, res) => {
  const { params } = getValidated<{ params: typeof unlockScopeParams }>(req);

  res.json({ data: await readPinProfile(owner(req), params.scopeId) });
});
vaultUnlockRouter.post(
  '/:scopeId/pin-attempt',
  validateRequest({ params: unlockScopeParams, body: pinAttemptInput }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof pinAttemptInput }>(req);

    res.json({ data: await consumePinAttempt(owner(req), params.scopeId, body.methodId) });
  },
);
vaultUnlockRouter.post(
  '/:scopeId/local-method',
  validateRequest({ params: unlockScopeParams, body: localPinInput }),
  authed({ operation: { purpose: 'vault_unlock_manage', grantSource: 'body' } }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof localPinInput }>(req);

    await authorizePinProfile(owner(req), params.scopeId, body.expectedMethodId, body.profile);
    res.json({ data: { authorized: true } });
  },
);
vaultUnlockRouter.delete(
  '/:scopeId/local-method',
  validateRequest({ params: unlockScopeParams, body: localPinDeleteInput }),
  authed({ operation: { purpose: 'vault_unlock_manage', grantSource: 'body' } }),
  async (req, res) => {
    const { params, body } = getValidated<{ params: typeof unlockScopeParams; body: typeof localPinDeleteInput }>(req);

    await revokePinProfile(owner(req), params.scopeId, body.expectedMethodId);
    res.sendStatus(204);
  },
);
vaultUnlockRouter.post(
  '/:scopeId/recovery-export',
  validateRequest({ params: unlockScopeParams, body: recoveryExportInput }),
  authed({ operation: { purpose: 'vault_recovery_export', grantSource: 'body' } }),
  async (req, res) => {
    const { params } = getValidated<{ params: typeof unlockScopeParams }>(req);
    const current = owner(req);

    await withAccountContext(current, (tx) => lockUnlockScope(tx, current, params.scopeId));
    res.json({ data: { authorized: true } });
  },
);
