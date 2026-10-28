import { randomUUID } from 'node:crypto';

import { authSchema } from '@visomi-stack/backend-shared';
import { authenticator } from '@visomi-stack/dev-testing';
import { eq } from 'drizzle-orm';
import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';

import { authenticationFixture, password } from './support/auth';

const f = authenticationFixture();

describe('authentication failures and method lifecycle', () => {
  it('requires email before passkey signup and denies entry until its session verifies email', async () => {
    const browser = await f.client();
    const missing = await browser.call('POST', '/passkeys/registration/options', {});

    expect(missing.status).toBe(400);
    const email = `${randomUUID()}@example.test`;
    const options = await browser.call('POST', '/passkeys/registration/options', { email });
    const device = authenticator();
    const registered = await browser.call('POST', '/passkeys/registration/verify', {
      challengeId: options.data.challengeId,
      response: device.register(options.data.options.challenge, f.origin, '127.0.0.1'),
    });

    expect(registered.data.access).toBe('unverified');
    const result1 = await browser.call('GET', '/passkeys');

    expect(result1.status).toBe(403);
    const result2 = await browser.call('POST', '/passkeys/registration/options', {});

    expect(result2.status).toBe(403);
    const verified = await browser.call('POST', '/email/verify', {
      flowId: registered.data.flowId,
      code: f.lastCode(email),
    });

    expect(verified.data.access).toBe('full');
    const result3 = await browser.call('POST', '/password/change', { password });

    expect(result3.status).toBe(409);
    const result4 = await browser.call('POST', '/password/add', { password });

    expect(result4.status).toBe(200);
    const result5 = await browser.call('POST', '/password/add', { password });

    expect(result5.status).toBe(409);
    const result6 = await browser.call('POST', '/password/remove', {});

    expect(result6.status).toBe(200);
    const listed = await browser.call('GET', '/passkeys');
    const result7 = await browser.call('PATCH', `/passkeys/${listed.data.credentials[0].id}`, { label: 'New label' });

    expect(result7.status).toBe(204);
    const result8 = await browser.call('DELETE', `/passkeys/${listed.data.credentials[0].id}`);

    expect(result8.status).toBe(409);
    const result9 = await browser.call('POST', '/email/request', {});

    expect(result9.status).toBe(409);
  });

  it('resets passwords without signing in and provides identical unknown-account responses', async () => {
    const { browser: old, email } = await f.signup();
    const browser = await f.client();
    const pending = await browser.call('POST', '/password/reset/request', { email });
    const replacement = 'Replacement synthetic password!';
    const reset = await browser.call('POST', '/password/reset/complete', {
      flowId: pending.data.flowId,
      code: f.lastCode(email),
      password: replacement,
    });

    expect(reset.status).toBe(200);
    expect(reset.data.passwordReset).toBe(true);
    const result10 = await old.call('GET', '/session');

    expect(result10.data.authenticated).toBe(false);
    const login = await browser.call('POST', '/password/sign-in', { email, password: replacement });

    expect(login.status).toBe(202);
    const unknown = await f.client();
    const hidden = await unknown.call('POST', '/password/reset/request', { email: `${randomUUID()}@example.test` });

    expect(Object.keys(hidden.data)).toEqual(Object.keys(pending.data));
    const result11 = await unknown.call('POST', '/password/reset/complete', {
      flowId: hidden.data.flowId,
      code: '000000',
      password: replacement,
    });

    expect(result11.status).toBe(400);
    const result12 = await unknown.call('POST', '/password/sign-in', {
      email: `${randomUUID()}@example.test`,
      password,
    });

    expect(result12.status).toBe(401);
  });

  it('keeps a reset session revoked if repeated SID destruction is refused', async () => {
    const { browser, email } = await f.signup();
    const pending = await browser.call('POST', '/password/reset/request', { email });
    const replacement = 'New synthetic password 42!';
    const reset = await browser.call('POST', '/password/reset/complete', {
      flowId: pending.data.flowId,
      code: f.lastCode(email),
      password: replacement,
    });

    // The store rejects destroying an already-revoked SID; that cleanup failure must never restore access.
    expect(reset.status).toBe(503);
    expect(reset.data.error).toBe('session_unavailable');
    const session = await browser.call('GET', '/session');

    expect(session.data.authenticated).toBe(false);
    const pendingLogin = await browser.call('POST', '/password/sign-in', { email, password: replacement });

    expect(pendingLogin.status).toBe(202);
  });

  it('reauthenticates with password plus email and invalidates other sessions explicitly', async () => {
    const { browser, email } = await f.signup();
    const result13 = await browser.call('POST', '/reauth/password/start', { password: 'invalid' });

    expect(result13.status).toBe(400);
    const pending = await browser.call('POST', '/reauth/password/start', { password });

    expect(pending.status).toBe(202);
    const wrongKind = await browser.call('POST', '/reauth/password/complete', {
      flowId: pending.data.flowId,
      factor: { kind: 'totp', code: '123456' },
    });

    expect(wrongKind.status).toBe(400);
    const verified = await browser.call('POST', '/reauth/password/complete', {
      flowId: pending.data.flowId,
      factor: { kind: 'email', code: f.lastCode(email) },
    });

    expect(verified.status).toBe(200);
    const other = await f.client();
    const login = await other.call('POST', '/password/sign-in', { email, password });

    await other.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'email', code: f.lastCode(email) },
    });

    const result14 = await browser.call('GET', '/sessions');

    expect(result14.data.sessions).toHaveLength(2);
    const result15 = await browser.call('POST', '/sessions/revoke-others', {});

    expect(result15.status).toBe(204);
    const result16 = await other.call('GET', '/session');

    expect(result16.data.authenticated).toBe(false);
    const result17 = await browser.call('DELETE', '/sessions/' + '0'.repeat(64));

    expect(result17.status).toBe(404);
    const result18 = await browser.call('POST', '/password/sign-up', { email, password });

    expect(result18.status).toBe(403);
  });

  it('enforces resend cooldown and preserves attempts when replacing a delivered code', async () => {
    const { email } = await f.signup();
    const browser = await f.client();
    const login = await browser.call('POST', '/password/sign-in', { email, password });
    const id = login.data.flowId;
    const old = f.lastCode(email);
    const result19 = await browser.call('POST', '/challenges/resend', { flowId: id });

    expect(result19.status).toBe(429);

    await f.db
      .update(authSchema.flows)
      .set({ lastSentAt: new Date(Date.now() - 61_000) })
      .where(eq(authSchema.flows.id, id));

    const result20 = await browser.call('POST', '/challenges/resend', { flowId: id });

    expect(result20.status).toBe(202);
    const result21 = await browser.call('POST', '/password/verify', {
      flowId: id,
      factor: { kind: 'email', code: old },
    });

    expect(result21.status).toBe(400);
    const next = f.lastCode(email);
    const result22 = await browser.call('POST', '/password/verify', {
      flowId: id,
      factor: { kind: 'email', code: next },
    });

    expect(result22.status).toBe(200);
  });

  it('never grants access when SMTP rejects delivery, including recovery and notices', async () => {
    const { email, browser } = await f.signup();

    f.failDelivery();
    const pending = await f.client();
    const result23 = await pending.call('POST', '/password/sign-in', { email, password });

    expect(result23.status).toBe(503);
    const hidden = await pending.call('POST', '/recovery/request', { email });

    expect(hidden.status).toBe(202);
    const result24 = await pending.call('POST', '/recovery/verify', { flowId: hidden.data.flowId, code: '000000' });

    expect(result24.status).toBe(400);
    const changed = await browser.call('POST', '/password/change', { password: 'Synthetic updated password!' });

    expect(changed.status).toBe(200);
    expect(changed.data.notificationSent).toBe(false);
  });

  it('rejects conflicting email claims without changing the original address', async () => {
    const owner = await f.signup();
    const other = await f.signup();
    const pending = await other.browser.call('POST', '/email/change/request', { email: owner.email });
    const result25 = await other.browser.call('POST', '/email/change/verify', {
      flowId: pending.data.flowId,
      code: f.lastCode(owner.email),
    });

    expect(result25.status).toBe(409);
    const result26 = await other.browser.call('GET', '/session');

    expect(result26.data.user.email).toBe(other.email);
  });

  it('regenerates backup codes, disables TOTP, and rejects an inactive enrollment', async () => {
    const { browser, email } = await f.signup();
    const result27 = await browser.call('POST', '/recovery-codes/regenerate', {});

    expect(result27.status).toBe(400);
    const setup = await browser.call('POST', '/totp/setup', {});
    const result28 = await browser.call('POST', '/totp/confirm', {
      enrollmentId: setup.data.enrollmentId,
      code: 'invalid',
    });

    expect(result28.status).toBe(400);
    const code = await generate({ secret: setup.data.secret });
    const confirmed = await browser.call('POST', '/totp/confirm', { enrollmentId: setup.data.enrollmentId, code });
    const newCodes = await browser.call('POST', '/recovery-codes/regenerate', {});

    expect(newCodes.status).toBe(200);
    const outsider = await f.client();
    const login = await outsider.call('POST', '/password/sign-in', { email, password });
    const result29 = await outsider.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'recovery_code', code: confirmed.data.recoveryCodes[0] },
    });

    expect(result29.status).toBe(400);
    const result30 = await browser.call('DELETE', '/totp');

    expect(result30.status).toBe(200);
    const result31 = await browser.call('GET', '/methods');

    expect(result31.data.totp).toBe(false);
    const result32 = await browser.call('POST', '/totp/confirm', { enrollmentId: setup.data.enrollmentId, code });

    expect(result32.status).toBe(400);
  });

  it('rejects cancelled, denied, expired and foreign device requests', async () => {
    const { browser: owner, email } = await f.signup();

    for (const operation of ['cancel', 'deny', 'expire']) {
      const browser = await f.client();
      const pending = await browser.call('POST', '/device-approval/request', { email });
      const { requestId, userCode } = pending.data;
      const other = await f.client();
      const result33 = await other.call('POST', '/device-approval/status', { requestId });

      expect(result33.status).toBe(400);
      if (operation === 'cancel') {
        const result34 = await browser.call('POST', '/device-approval/cancel', { requestId });

        expect(result34.status).toBe(204);
      }

      if (operation === 'deny') {
        const result35 = await owner.call('POST', '/device-approval/deny', { requestId, userCode });

        expect(result35.status).toBe(204);
      }

      if (operation === 'expire') {
        await f.db
          .update(authSchema.deviceApprovals)
          .set({ expiresAt: new Date(0) })
          .where(eq(authSchema.deviceApprovals.id, requestId));

        const result36 = await browser.call('POST', '/device-approval/status', { requestId });

        expect(result36.data.status).toBe('expired');
      }

      const result37 = await browser.call('POST', '/device-approval/consume', { requestId, userCode });

      expect(result37.status).toBe(400);
    }
  });
});
