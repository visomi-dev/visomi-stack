import { responseEnvelope, z } from '../shared/http/route-schemas';

import { notificationFeed, notificationPreferenceInput, pushSubscriptionInput, pushCapabilities } from 'shared';

export const notificationParams = z.strictObject({ id: z.uuid() });
export const notificationPaths = {
  '/notifications': {
    get: {
      responses: {
        200: {
          description: 'Account- and user-scoped generic inbox, newest first, at most 100 records.',
          content: {
            'application/json': { schema: responseEnvelope(notificationFeed, 'NotificationFeedEnvelope') },
          },
        },
      },
    },
  },
  '/notifications/preferences': {
    post: {
      requestBody: { content: { 'application/json': { schema: notificationPreferenceInput } } },
      responses: { 204: { description: 'Preferences stored. Push remains unavailable until delivery is configured.' } },
    },
  },
  '/notifications/{id}/read': {
    post: {
      requestParams: { path: notificationParams },
      responses: { 204: { description: 'Read state updated without disclosing foreign records.' } },
    },
  },
  '/notifications/subscriptions': {
    get: {
      responses: {
        200: {
          description: 'Current session device state and public VAPID capability only.',
          content: { 'application/json': { schema: responseEnvelope(pushCapabilities, 'PushCapabilitiesEnvelope') } },
        },
      },
    },
    post: {
      requestBody: { content: { 'application/json': { schema: pushSubscriptionInput } } },
      responses: {
        204: { description: 'Current full session/account device registered.' },
        503: { description: 'Push registration disabled or VAPID configuration unavailable.' },
        409: { description: 'Device endpoint conflict or per-owner capacity exceeded.' },
      },
    },
    delete: {
      responses: {
        204: {
          description: 'Current session/account registration removed idempotently; no endpoints or keys disclosed.',
        },
      },
    },
  },
};
