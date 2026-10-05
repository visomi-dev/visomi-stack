import { createECDH, randomBytes } from 'node:crypto';

import { pushSubscriptionInput } from './push-contract';

function subscription(endpoint = 'https://fcm.googleapis.com/fcm/send/test-token') {
  const key = createECDH('prime256v1');

  key.generateKeys();

  return {
    endpoint,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

describe('push provider boundary', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/test-token',
    'https://updates.push.services.mozilla.com/wpush/v2/test-token',
    'https://web.push.apple.com/test-token',
    'https://a.web.push.apple.com/test-token',
  ])('accepts canonical vendor endpoint %s with valid non-padded browser keys', (endpoint) => {
    const input = subscription(endpoint);

    expect(pushSubscriptionInput.parse(input)).toEqual(input);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/test-token',
    'https://127.0.0.1/push',
    'https://[::1]/push',
    'https://169.254.169.254/push',
    'https://push.example.test/push',
    'https://fcm.googleapis.com.attacker.test/push',
    'https://notpush.apple.com/push',
    'https://push.apple.com/push',
    'https://web.push.apple.com.attacker.test/push',
    'https://user:password@fcm.googleapis.com/push',
    'https://fcm.googleapis.com:8443/push',
    'https://fcm.googleapis.com:443/push',
    'https://fcm.googleapis.com/push?redirect=https://127.0.0.1',
    'https://fcm.googleapis.com/push#token',
    'https://fcm.googleapis.com/',
    'https://%66cm.googleapis.com/push',
    'https://FCM.googleapis.com/push',
    'https://fcm.googleapis.com./push',
    'https://fcm.googleapis.com\\@attacker.test/push',
    'https://fcm.googleapis.com/push/../token',
    `https://fcm.googleapis.com/${'a'.repeat(2048)}`,
  ])('rejects endpoint aliases and non-vendor destinations: %s', (endpoint) => {
    expect(pushSubscriptionInput.safeParse(subscription(endpoint)).success).toBe(false);
  });

  it('rejects off-curve, compressed and truncated keys, noncanonical auth bits and extra fields', () => {
    const input = subscription();
    const invalidPoint = Buffer.alloc(65);

    invalidPoint[0] = 4;
    const invalidKeys = [
      { ...input.keys, p256dh: invalidPoint.toString('base64url') },
      { ...input.keys, p256dh: Buffer.alloc(33).toString('base64url') },
      { ...input.keys, p256dh: input.keys.p256dh.slice(1) },
      { ...input.keys, p256dh: `${input.keys.p256dh}=` },
      { ...input.keys, auth: `${input.keys.auth}==` },
      { ...input.keys, auth: 'A'.repeat(21) + 'B' },
      { ...input.keys, auth: 'A'.repeat(21) },
      { ...input.keys, rawPrivateKey: 'not-accepted' },
    ];

    for (const keys of invalidKeys) expect(pushSubscriptionInput.safeParse({ ...input, keys }).success).toBe(false);
    expect(pushSubscriptionInput.safeParse({ ...input, expirationTime: null }).success).toBe(false);
    expect(pushSubscriptionInput.safeParse({ ...input, accountId: 'attacker-account' }).success).toBe(false);
  });
});
