import { randomUUID } from 'node:crypto';

import { authSchema } from '@visomi-stack/backend-shared';
import { authenticator } from '@visomi-stack/dev-testing';
import { eq } from 'drizzle-orm';
import { generate } from 'otplib';
import { expect, it } from 'vitest';

import { authenticationFixture, password } from './support/auth';
const f = authenticationFixture();

it('can finish a pending password signup from a new browser and rejects a conflicting verified owner', async () => {
  const email = `${randomUUID()}@example.test`;
  const pendingBrowser = await f.client();

  await pendingBrowser.call('POST', '/password/sign-up', { email, password });

  const browser = await f.client();
  const login = await browser.call('POST', '/password/sign-in', { email, password });
  const completed = await browser.call('POST', '/password/verify', {
    flowId: login.data.flowId,
    factor: { kind: 'email', code: f.lastCode(email) },
  });

  expect(completed.status).toBe(200);
  expect(completed.data.access).toBe('full');
  const planted = await f.client();

  await planted.call('POST', '/password/sign-up', { email, password });

  const another = await f.client();
  const conflict = await another.call('POST', '/password/sign-in', { email, password });

  // The established identity wins; pending duplicates never replace its methods.
  expect(conflict.status).toBe(202);
  const result1 = await another.call('POST', '/password/verify', {
    flowId: conflict.data.flowId,
    factor: { kind: 'totp', code: '123456' },
  });

  expect(result1.status).toBe(400);
});

it('keeps recovery proof and password enrollment bound to the current TOTP enrollment', async () => {
  const { browser, email, userId } = await f.signup();
  const setup = await browser.call('POST', '/totp/setup', {});
  const code = await generate({ secret: setup.data.secret });
  const confirmed = await browser.call('POST', '/totp/confirm', { enrollmentId: setup.data.enrollmentId, code });
  const reauth = await browser.call('POST', '/reauth/password/start', { password });

  expect(reauth.data.factor).toBe('totp');
  const reauthed = await browser.call('POST', '/reauth/password/complete', {
    flowId: reauth.data.flowId,
    factor: { kind: 'recovery_code', code: confirmed.data.recoveryCodes[0] },
  });

  expect(reauthed.status).toBe(200);
  const pending = await browser.call('POST', '/recovery/request', { email });
  const recovered = await browser.call('POST', '/recovery/verify', {
    flowId: pending.data.flowId,
    code: f.lastCode(email),
  });

  expect(recovered.status).toBe(200);
  const staged = await browser.call('POST', '/recovery/password', { password });

  expect(staged.data.factor).toBe('totp');
  const wrong = await browser.call('POST', '/recovery/password/complete', {
    flowId: staged.data.flowId,
    password: 'Incorrect synthetic password!',
    factor: { kind: 'recovery_code', code: confirmed.data.recoveryCodes[1] },
  });

  expect(wrong.status).toBe(400);
  const changed = await browser.call('POST', '/recovery/password/complete', {
    flowId: staged.data.flowId,
    password,
    factor: { kind: 'recovery_code', code: confirmed.data.recoveryCodes[1] },
  });

  expect(changed.status).toBe(200);
  expect(changed.data.user.id).toBe(userId);
});

it('keeps unknown recovery resend responses uniform even when SMTP is unavailable', async () => {
  const browser = await f.client();
  const pending = await browser.call('POST', '/recovery/request', { email: `${randomUUID()}@example.test` });
  const result2 = await browser.call('POST', '/challenges/resend', { flowId: pending.data.flowId });

  expect(result2.status).toBe(429);

  await f.db
    .update(authSchema.flows)
    .set({ lastSentAt: new Date(0) })
    .where(eq(authSchema.flows.id, pending.data.flowId));

  const result3 = await browser.call('POST', '/challenges/resend', { flowId: pending.data.flowId });

  expect(result3.status).toBe(202);
});

it('preserves a migrated passkey identity and requires adding its missing email', async () => {
  const browser = await f.client();
  const session = await f.pool.query("select sid from auth_sessions where sess->>'csrf' = $1", [browser.csrf]);
  const sid = session.rows[0].sid;
  const device = authenticator();
  const options = await f.runtime.passkeys.registrationOptions(sid);
  const existing = await f.runtime.passkeys.register(
    sid,
    options.challengeId,
    device.register(options.options.challenge, f.origin, '127.0.0.1'),
    'Migrated',
  );
  const pending = await browser.call('POST', '/passkeys/authentication/options', {});
  const login = await browser.call('POST', '/passkeys/authentication/verify', {
    challengeId: pending.data.challengeId,
    response: device.authenticate(pending.data.options.challenge, f.origin, '127.0.0.1', existing.id),
  });

  expect(login.data.nextStep).toBe('add_email');
  const email = `${randomUUID()}@example.test`;
  const requested = await browser.call('POST', '/email/request', { email });

  expect(requested.status).toBe(202);
  const verified = await browser.call('POST', '/email/verify', {
    flowId: requested.data.flowId,
    code: f.lastCode(email),
  });

  expect(verified.data).toMatchObject({ access: 'full', user: { id: existing.id, email } });
});

it('fails ordinary resend closed and keeps recovery delivery failures enumeration-resistant', async () => {
  const { email } = await f.signup();
  const browser = await f.client();
  const login = await browser.call('POST', '/password/sign-in', { email, password });
  const recover = await browser.call('POST', '/recovery/request', { email });

  for (const id of [login.data.flowId, recover.data.flowId]) {
    await f.db
      .update(authSchema.flows)
      .set({ lastSentAt: new Date(0) })
      .where(eq(authSchema.flows.id, id));
  }
  f.failDelivery();
  const result1 = await browser.call('POST', '/challenges/resend', { flowId: login.data.flowId });

  expect(result1.status).toBe(503);
  const result2 = await browser.call('POST', '/challenges/resend', { flowId: recover.data.flowId });

  expect(result2.status).toBe(202);
});

it('revokes a selected other session without clearing the current cookie', async () => {
  const { browser, email } = await f.signup();
  const other = await f.client();
  const login = await other.call('POST', '/password/sign-in', { email, password });

  await other.call('POST', '/password/verify', {
    flowId: login.data.flowId,
    factor: { kind: 'email', code: f.lastCode(email) },
  });

  const sessions = await browser.call('GET', '/sessions');
  const target = sessions.data.sessions.find((entry: { current: boolean }) => !entry.current);
  const cookie = browser.cookie;
  const result1 = await browser.call('DELETE', `/sessions/${target.id}`);

  expect(result1.status).toBe(204);
  expect(browser.cookie).toBe(cookie);
  const result2 = await other.call('GET', '/session');

  expect(result2.data.authenticated).toBe(false);
});
