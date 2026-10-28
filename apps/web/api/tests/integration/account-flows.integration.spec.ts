import { randomUUID } from 'node:crypto';

import { authSchema } from '@visomi-stack/backend-shared';
import { authenticator } from '@visomi-stack/dev-testing';
import { eq } from 'drizzle-orm';
import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';

import { emailContracts } from '../../src/auth/email/contract';
import { methodsContracts } from '../../src/auth/methods/contract';
import { passwordContracts } from '../../src/auth/password/contract';

import { authenticationFixture, password } from './support/auth';

const f = authenticationFixture();

describe('account access through real SMTP and PostgreSQL', () => {
  it('creates a restricted signup, verifies email, rotates the session and rejects replay', async () => {
    const browser = await f.client();
    const email = `${randomUUID()}@example.test`;
    const before = browser.cookie;
    const created = await browser.call('POST', '/password/sign-up', { email, password });

    expect(created.status).toBe(201);
    expect(
      passwordContracts.signUp.responses[201].content['application/json'].schema.safeParse(created.data).success,
    ).toBe(true);
    expect(created.data).toMatchObject({ authenticated: true, access: 'unverified', nextStep: 'verify_email' });
    expect(browser.cookie).not.toBe(before);
    const result1 = await browser.call('GET', '/methods');

    expect(result1.status).toBe(403);
    const code = f.lastCode(email);
    const result2 = await browser.call('POST', '/email/verify', {
      flowId: created.data.flowId,
      code: code === '000000' ? '000001' : '000000',
    });

    expect(result2.status).toBe(400);
    const verified = await browser.call('POST', '/email/verify', { flowId: created.data.flowId, code });

    expect(
      emailContracts.verifyEmail.responses[200].content['application/json'].schema.safeParse(verified.data).success,
    ).toBe(true);
    expect(verified.data).toMatchObject({ access: 'full', user: { emailVerified: true, email } });
    const result3 = await browser.call('POST', '/email/verify', { flowId: created.data.flowId, code });

    expect(result3.status).toBe(400);
    const methods = await browser.call('GET', '/methods');

    expect(
      methodsContracts.getMethods.responses[200].content['application/json'].schema.safeParse(methods.data).success,
    ).toBe(true);
    expect(methods.data).toEqual({ password: true, google: [], passkeys: [], totp: false });
    const result4 = await browser.call('POST', '/password/remove', {});

    expect(result4.status).toBe(409);
  });

  it('requires password and a session-bound email factor, and burns concurrent attempts atomically', async () => {
    const { email, userId } = await f.signup();
    const browser = await f.client();
    const result5 = await browser.call('POST', '/password/sign-in', { email, password: 'incorrect' });

    expect(result5.status).toBe(401);
    const login = await browser.call('POST', '/password/sign-in', { email, password });

    expect(login.status).toBe(202);
    expect(
      passwordContracts.signIn.responses[202].content['application/json'].schema.safeParse(login.data).success,
    ).toBe(true);
    const result6 = await browser.call('GET', '/methods');

    expect(result6.status).toBe(401);
    const code = f.lastCode(email);
    const other = await f.client();
    const result7 = await other.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'email', code },
    });

    expect(result7.status).toBe(400);
    const success = await browser.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'email', code },
    });

    expect(success.data).toMatchObject({ access: 'full', user: { id: userId }, method: 'password' });
    const stored = await f.db.select().from(authSchema.users).where(eq(authSchema.users.id, userId));

    expect(stored[0].passwordHash).toMatch(/^\$argon2id\$/);
    const result8 = await browser.call('POST', '/logout', {});

    expect(result8.status).toBe(204);
    await browser.call('GET', '/session');
    const pending = await browser.call('POST', '/password/sign-in', { email, password });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        browser.call('POST', '/password/verify', {
          flowId: pending.data.flowId,
          factor: { kind: 'email', code: 'invalid' },
        }),
      ),
    );

    expect(attempts.every((attempt) => attempt.status === 400)).toBe(true);
    const [flow] = await f.db.select().from(authSchema.flows).where(eq(authSchema.flows.id, pending.data.flowId));

    expect(flow.attempts).toBe(5);
  });

  it('enforces TOTP, rejects email bypass and reuse, and consumes backups only once', async () => {
    const { browser, email } = await f.signup();
    const setup = await browser.call('POST', '/totp/setup', {});

    expect(setup.status).toBe(201);
    const code = await generate({ secret: setup.data.secret });
    const confirmed = await browser.call('POST', '/totp/confirm', { enrollmentId: setup.data.enrollmentId, code });

    expect(confirmed.status).toBe(200);
    expect(confirmed.data.recoveryCodes).toHaveLength(10);
    const loginBrowser = await f.client();
    const login = await loginBrowser.call('POST', '/password/sign-in', { email, password });

    expect(login.data.factor).toBe('totp');
    const result9 = await loginBrowser.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'email', code },
    });

    expect(result9.status).toBe(400);
    const result10 = await loginBrowser.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'totp', code },
    });

    expect(result10.status).toBe(400);
    const backup = confirmed.data.recoveryCodes[0];
    const result = await loginBrowser.call('POST', '/password/verify', {
      flowId: login.data.flowId,
      factor: { kind: 'recovery_code', code: backup },
    });

    expect(result.status).toBe(200);
    const another = await f.client();
    const again = await another.call('POST', '/password/sign-in', { email, password });
    const result11 = await another.call('POST', '/password/verify', {
      flowId: again.data.flowId,
      factor: { kind: 'recovery_code', code: backup },
    });

    expect(result11.status).toBe(400);
    const recovery = await another.call('POST', '/recovery/request', { email });
    const result12 = await another.call('POST', '/recovery/verify', {
      flowId: recovery.data.flowId,
      code: f.lastCode(email),
    });

    expect(result12.status).toBe(400);
    const verified = await another.call('POST', '/recovery/verify', {
      flowId: recovery.data.flowId,
      code: f.lastCode(email),
      factor: { kind: 'recovery_code', code: confirmed.data.recoveryCodes[1] },
    });

    expect(verified.data.access).toBe('recovery');
    const result13 = await another.call('GET', '/methods');

    expect(result13.status).toBe(403);
  });

  it('recovers only after proving the replacement password and invalidates previous sessions', async () => {
    const { browser: old, email } = await f.signup();
    const browser = await f.client();
    const pending = await browser.call('POST', '/recovery/request', { email });
    const recovered = await browser.call('POST', '/recovery/verify', {
      flowId: pending.data.flowId,
      code: f.lastCode(email),
    });

    expect(recovered.data.access).toBe('recovery');
    const replacement = 'Another synthetic password!';
    const staged = await browser.call('POST', '/recovery/password', { password: replacement });

    expect(staged.status).toBe(202);
    const complete = await browser.call('POST', '/recovery/password/complete', {
      flowId: staged.data.flowId,
      password: replacement,
      factor: { kind: 'email', code: f.lastCode(email) },
    });

    expect(complete.status).toBe(200);
    expect(complete.data.access).toBe('full');
    const result14 = await old.call('GET', '/session');

    expect(result14.data.authenticated).toBe(false);
  });

  it('approves a new browser without giving full access, then proves its pending passkey', async () => {
    const { browser: owner, email, userId } = await f.signup();
    const browser = await f.client();
    const request = await browser.call('POST', '/device-approval/request', { email });

    expect(request.status).toBe(201);
    const { requestId, userCode } = request.data;
    const result15 = await owner.call('POST', '/device-approval/review', { requestId });

    expect(result15.status).toBe(200);
    const result16 = await owner.call('POST', '/device-approval/approve', { requestId, userCode });

    expect(result16.status).toBe(204);
    const result17 = await browser.call('POST', '/device-approval/status', { requestId });

    expect(result17.data.status).toBe('approved');
    const consumed = await browser.call('POST', '/device-approval/consume', { requestId, userCode });

    expect(consumed.data.access).toBe('enrollment');
    const device = authenticator();
    const registration = await browser.call('POST', '/passkeys/registration/options', {});
    const created = await browser.call('POST', '/passkeys/registration/verify', {
      challengeId: registration.data.challengeId,
      response: device.register(registration.data.options.challenge, f.origin, '127.0.0.1'),
    });

    expect(created.status).toBe(201);
    expect(created.data.access).toBe('enrollment');
    const outsider = await f.client();
    const otherOptions = await outsider.call('POST', '/passkeys/authentication/options', {});
    const unauthorized = await outsider.call('POST', '/passkeys/authentication/verify', {
      challengeId: otherOptions.data.challengeId,
      response: device.authenticate(otherOptions.data.options.challenge, f.origin, '127.0.0.1', userId),
    });

    expect(unauthorized.status).toBe(400);
    const options = await browser.call('POST', '/passkeys/authentication/options', {});
    const verified = await browser.call('POST', '/passkeys/authentication/verify', {
      challengeId: options.data.challengeId,
      response: device.authenticate(options.data.options.challenge, f.origin, '127.0.0.1', userId),
    });

    expect(verified.status).toBe(200);
    expect(verified.data.access).toBe('full');
    const result18 = await owner.call('GET', '/session');

    expect(result18.data.authenticated).toBe(false);
  });

  it('changes email and password, hides real SIDs and closes selected sessions', async () => {
    const { browser, email } = await f.signup();
    const nextEmail = `${randomUUID()}@example.test`;
    const change = await browser.call('POST', '/email/change/request', { email: nextEmail });

    expect(change.status).toBe(202);
    const updated = await browser.call('POST', '/email/change/verify', {
      flowId: change.data.flowId,
      code: f.lastCode(nextEmail),
    });

    expect(updated.data.user.email).toBe(nextEmail);
    expect(f.messages.some((message) => message.to === email && message.raw.includes('email address changed'))).toBe(
      true,
    );
    const result19 = await browser.call('POST', '/password/change', { password: 'New synthetic password 56!' });

    expect(result19.status).toBe(200);
    const listed = await browser.call('GET', '/sessions');

    expect(listed.data.sessions).toHaveLength(1);
    const handle = listed.data.sessions[0].id;

    expect(handle).toMatch(/^[a-f0-9]{64}$/);
    expect(browser.cookie).not.toContain(handle);
    const result20 = await browser.call('DELETE', `/sessions/${handle}`);

    expect(result20.status).toBe(204);
    const result21 = await browser.call('GET', '/session');

    expect(result21.data.authenticated).toBe(false);
  });
});
