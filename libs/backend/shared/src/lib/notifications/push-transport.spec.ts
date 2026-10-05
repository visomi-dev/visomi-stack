import { createECDH, randomBytes } from 'node:crypto';

// eslint-disable-next-line import-x/default -- Exercise the production-required CommonJS default import.
import webPush, { generateVAPIDKeys } from 'web-push';

import { deliverPush, vapidConfiguration } from './push-transport';

const vapid = { ...generateVAPIDKeys(), subject: 'mailto:push@example.test' };

function subscription() {
  const key = createECDH('prime256v1');

  key.generateKeys();

  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/transport-test',
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

describe('bounded encrypted push transport', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('encrypts generic content, binds VAPID and explicitly disables redirects', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({ status: 201, body: { cancel } });
    expect(await deliverPush(subscription(), vapid)).toBe('sent');
    const [endpoint, request] = fetchMock.mock.calls[0];

    expect(endpoint).toBe('https://fcm.googleapis.com/fcm/send/transport-test');
    expect(request).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(request.headers.Authorization).toContain('vapid ');
    expect(Buffer.from(request.body).toString()).not.toContain('Account activity');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    [204, 'sent'],
    [302, 'rejected'],
    [307, 'rejected'],
    [400, 'rejected'],
    [401, 'rejected'],
    [404, 'expired'],
    [410, 'expired'],
    [429, 'retry'],
    [503, 'retry'],
  ])('classifies status %s without following provider instructions', async (status, expected) => {
    fetchMock.mockResolvedValue({ status, body: null });
    expect(await deliverPush(subscription(), vapid)).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('revalidates persisted endpoints and keys and rejects mismatched VAPID without network access', async () => {
    expect(await deliverPush({ ...subscription(), endpoint: 'https://127.0.0.1/private' }, vapid)).toBe('rejected');
    expect(await deliverPush({ ...subscription(), keys: { auth: 'bad', p256dh: 'bad' } }, vapid)).toBe('rejected');
    expect(await deliverPush(subscription(), { ...vapid, privateKey: generateVAPIDKeys().privateKey })).toBe(
      'rejected',
    );
    expect(vapidConfiguration.safeParse({ ...vapid, subject: 'http://example.test' }).success).toBe(false);
    expect(vapidConfiguration.safeParse({ ...vapid, subject: 'mailto:' }).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns only a bounded retry outcome for network failures and caller cancellation', async () => {
    fetchMock.mockRejectedValue(new Error('Provider error containing secret material'));
    expect(await deliverPush(subscription(), vapid)).toBe('retry');
    const controller = new AbortController();

    controller.abort();
    expect(await deliverPush(subscription(), vapid, controller.signal)).toBe('retry');
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it('uses localized static copy and a fixed inbox action without caller-controlled navigation or content', async () => {
    const prepare = jest.spyOn(webPush, 'generateRequestDetails');

    try {
      fetchMock.mockResolvedValue({ status: 201, body: null });
      expect(await deliverPush(subscription(), vapid, undefined, 'es')).toBe('sent');
      const payload = prepare.mock.calls[0][1];

      expect(typeof payload).toBe('string');
      expect(JSON.parse(String(payload))).toEqual({
        notification: {
          title: 'Actividad de la cuenta',
          body: 'Abre tu bandeja de notificaciones.',
          tag: 'visomi-account-update',
          data: { onActionClick: { default: { operation: 'openWindow', url: '/app/es/notifications' } } },
        },
      });
    } finally {
      prepare.mockRestore();
    }
  });
});
