import { env } from '../shared/env';

import { consumeEmailOtpDeliveryLimit, resetPasskeySecurityState } from './passkey-security';

jest.mock('../shared/env', () => {
  const actual = jest.requireActual('../shared/env');

  return { ...actual, env: { ...actual.env, DATABASE_DRIVER: 'memory' } };
});

describe('email delivery limits', () => {
  beforeEach(() => resetPasskeySecurityState());
  afterEach(() => jest.restoreAllMocks());

  it('enforces a normalized destination cooldown across different IPs and sessions', async () => {
    let now = 1_000_000;

    jest.spyOn(Date, 'now').mockImplementation(() => now);
    expect((await consumeEmailOtpDeliveryLimit('ip-a', ' Person@Example.test ', true)).allowed).toBe(true);
    expect(await consumeEmailOtpDeliveryLimit('ip-b', 'person@example.test', true)).toEqual({
      allowed: false,
      retryAfter: env.PIN_RESEND_COOLDOWN_SECONDS,
    });
    now += env.PIN_RESEND_COOLDOWN_SECONDS * 1000;
    expect((await consumeEmailOtpDeliveryLimit('ip-b', 'person@example.test', true)).allowed).toBe(true);
  });

  it('shares destination quotas with existing OTP delivery and resets after the configured window', async () => {
    let now = 1_000_000;

    jest.spyOn(Date, 'now').mockImplementation(() => now);
    for (let index = 0; index < env.EMAIL_OTP_DELIVERY_EMAIL_MAX; index += 1) {
      expect((await consumeEmailOtpDeliveryLimit(`ip-${index}`, 'person@example.test')).allowed).toBe(true);
    }
    expect((await consumeEmailOtpDeliveryLimit('new-ip', 'person@example.test', true)).allowed).toBe(false);
    now += env.EMAIL_OTP_DELIVERY_WINDOW_MS;
    expect((await consumeEmailOtpDeliveryLimit('new-ip', 'person@example.test', true)).allowed).toBe(true);
  });

  it('limits one IP even when each signup has a different email', async () => {
    for (let index = 0; index < env.EMAIL_OTP_DELIVERY_IP_MAX; index += 1) {
      expect((await consumeEmailOtpDeliveryLimit('same-ip', `person-${index}@example.test`, true)).allowed).toBe(true);
    }
    expect((await consumeEmailOtpDeliveryLimit('same-ip', 'another@example.test', true)).allowed).toBe(false);
  });
});
