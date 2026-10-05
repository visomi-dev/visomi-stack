import { Router } from 'express';

import { authed, authedRequest } from '../auth/auth-middleware';
import { csrfProtection } from '../auth/passkey-security';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { notificationParams } from './notification-schemas';

import {
  httpResponse,
  markNotificationRead,
  notificationPreferenceInput,
  readNotifications,
  setNotificationPreferences,
  pushSubscriptionInput,
  removePushSubscription,
  isSessionAuthorityStore,
  HttpError,
  readPushConfiguration,
  hasPushSubscription,
  registerPushSubscription,
} from 'shared';

export const notificationRouter = Router();

notificationRouter.use(
  (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  },
  csrfProtection,
  authed({ authority: 'full' }),
);
notificationRouter.get('/', async (req, res) => {
  const { user } = authedRequest(req);
  const data = await readNotifications({ accountId: user.accountId, userId: user.id });

  httpResponse.json(res, { data, message: 'Notifications retrieved.' });
});
notificationRouter.post('/preferences', validateRequest({ body: notificationPreferenceInput }), async (req, res) => {
  const { user } = authedRequest(req);
  const { body } = getValidated<{ body: typeof notificationPreferenceInput }>(req);

  await setNotificationPreferences({ accountId: user.accountId, userId: user.id }, body!);
  res.sendStatus(204);
});
notificationRouter.get('/subscriptions', async (req, res) => {
  const { user } = authedRequest(req);
  const configuration = readPushConfiguration();

  if (!isSessionAuthorityStore(req.sessionStore) || !user.authVersion) {
    throw new HttpError({ code: 'push_access_denied', message: 'Push registration is unavailable.', statusCode: 403 });
  }
  const registered = await hasPushSubscription(
    { accountId: user.accountId, userId: user.id, sessionId: req.sessionID, authVersion: user.authVersion },
    req.sessionStore,
  );

  httpResponse.json(res, {
    data: { available: Boolean(configuration), publicKey: configuration?.publicKey ?? null, registered },
    message: 'Device push capabilities retrieved.',
  });
});
notificationRouter.post('/subscriptions', validateRequest({ body: pushSubscriptionInput }), async (req, res) => {
  const { user } = authedRequest(req);
  const { body } = getValidated<{ body: typeof pushSubscriptionInput }>(req);

  if (!readPushConfiguration())
    throw new HttpError({
      code: 'push_unavailable',
      message: 'Device push notifications are not available yet.',
      statusCode: 503,
    });
  if (!isSessionAuthorityStore(req.sessionStore) || !user.authVersion) {
    throw new HttpError({ code: 'push_access_denied', message: 'Push registration is unavailable.', statusCode: 403 });
  }
  await registerPushSubscription(
    { accountId: user.accountId, userId: user.id, sessionId: req.sessionID, authVersion: user.authVersion },
    body!,
    req.sessionStore,
  );
  res.sendStatus(204);
});
notificationRouter.delete('/subscriptions', async (req, res) => {
  const { user } = authedRequest(req);

  if (!isSessionAuthorityStore(req.sessionStore) || !user.authVersion) {
    throw new HttpError({ code: 'push_access_denied', message: 'Push registration is unavailable.', statusCode: 403 });
  }
  await removePushSubscription(
    { accountId: user.accountId, userId: user.id, sessionId: req.sessionID, authVersion: user.authVersion },
    req.sessionStore,
  );
  res.sendStatus(204);
});
notificationRouter.post('/:id/read', validateRequest({ params: notificationParams }), async (req, res) => {
  const { user } = authedRequest(req);
  const { params } = getValidated<{ params: typeof notificationParams }>(req);

  await markNotificationRead({ accountId: user.accountId, userId: user.id }, params!.id);
  res.sendStatus(204);
});
