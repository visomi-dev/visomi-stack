import { randomUUID } from 'node:crypto';

import { authenticator, readMailCode } from '@visomi-stack/dev-testing';

import { expect, authTest as test } from './fixtures/http';

const origin = 'http://127.0.0.1:3317';

test('uses inherited sessions for valid passkey signup, logout and sign-in through /api', async ({ request }) => {
  const initial = await request.get('/api/auth/session');
  const anonymous = await initial.json();
  const before = await request.storageState();
  const headers = { origin, 'x-csrf-token': anonymous.csrfToken };
  const email = `${randomUUID()}@example.test`;
  const begin = await request.post('/api/auth/passkeys/registration/options', { headers, data: { email } });
  const pending = await begin.json();
  const device = authenticator();
  const registered = await request.post('/api/auth/passkeys/registration/verify', {
    headers,
    data: {
      challengeId: pending.challengeId,
      response: device.register(pending.options.challenge, origin, '127.0.0.1'),
    },
  });
  let identity = await registered.json();
  const code = await readMailCode(email);
  const verified = await request.post('/api/auth/email/verify', {
    headers: { origin, 'x-csrf-token': identity.csrfToken },
    data: { flowId: identity.flowId, code },
  });

  expect(verified.status()).toBe(200);
  const result1 = await verified.json();

  identity = result1;
  const after = await request.storageState();

  expect(initial.status()).toBe(200);
  expect(anonymous.authenticated).toBe(false);
  expect(begin.status()).toBe(200);
  expect(registered.status()).toBe(201);
  expect(after.cookies[0].value).not.toBe(before.cookies[0].value);
  expect(after.cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
  const protectedResponse = await request.get('/api/auth/passkeys');

  expect(protectedResponse.status()).toBe(200);
  const logout = await request.post('/api/auth/logout', {
    headers: { origin, 'x-csrf-token': identity.csrfToken },
    data: {},
  });

  expect(logout.status()).toBe(204);
  const revoked = await request.get('/api/auth/passkeys', {
    headers: { cookie: `${after.cookies[0].name}=${after.cookies[0].value}` },
  });

  expect(revoked.status()).toBe(401);
  const nextSession = await request.get('/api/auth/session');
  const state = await nextSession.json();
  const loginHeaders = { origin, 'x-csrf-token': state.csrfToken };
  const options = await request.post('/api/auth/passkeys/authentication/options', { headers: loginHeaders, data: {} });
  const challenge = await options.json();
  const login = await request.post('/api/auth/passkeys/authentication/verify', {
    headers: loginHeaders,
    data: {
      challengeId: challenge.challengeId,
      response: device.authenticate(challenge.options.challenge, origin, '127.0.0.1', identity.user.id),
    },
  });
  const loggedIn = await login.json();

  expect(login.status()).toBe(200);
  expect(loggedIn).toMatchObject({ authenticated: true, user: { id: identity.user.id } });
});

test('serializes API authorization, CSRF and parser errors through the gateway handler', async ({ request }) => {
  const denied = await request.get('/api/auth/passkeys');
  const deniedBody = await denied.json();
  const session = await request.get('/api/auth/session');
  const state = await session.json();
  const forbidden = await request.post('/api/auth/passkeys/registration/options', {
    headers: { origin, 'x-csrf-token': 'synthetic_invalid_csrf' },
    data: {},
  });
  const forbiddenBody = await forbidden.json();
  const malformed = await request.post('/api/auth/passkeys/registration/options', {
    headers: { origin, 'x-csrf-token': state.csrfToken, 'content-type': 'application/json' },
    data: '{',
  });
  const malformedBody = await malformed.json();

  expect(denied.status()).toBe(401);
  expect(deniedBody).toEqual({ error: 'authentication_required' });
  expect(forbidden.status()).toBe(403);
  expect(forbiddenBody).toEqual({ error: 'csrf_invalid' });
  expect(malformed.status()).toBe(400);
  expect(malformedBody).toEqual({ error: 'request_invalid' });
});

test('verifies a password signup and requires its second factor through the compiled host', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const email = `${randomUUID()}@example.test`;
  const password = 'Synthetic e2e password 42!';
  const initial = await request.get('/api/auth/session');
  const state = await initial.json();
  const signup = await request.post('/api/auth/password/sign-up', {
    headers: { origin, 'x-csrf-token': state.csrfToken },
    data: { email, password },
  });
  const pending = await signup.json();

  expect(signup.status()).toBe(201);
  expect(pending.access).toBe('unverified');
  const denied = await request.get('/api/auth/methods');

  expect(denied.status()).toBe(403);
  const signupCode = await readMailCode(email);
  const verification = await request.post('/api/auth/email/verify', {
    headers: { origin, 'x-csrf-token': pending.csrfToken },
    data: { flowId: pending.flowId, code: signupCode },
  });
  const verified = await verification.json();

  expect(verification.status()).toBe(200);
  expect(verified.access).toBe('full');
  const logout = await request.post('/api/auth/logout', {
    headers: { origin, 'x-csrf-token': verified.csrfToken },
    data: {},
  });

  expect(logout.status()).toBe(204);
  const next = await request.get('/api/auth/session');
  const anonymous = await next.json();
  const headers = { origin, 'x-csrf-token': anonymous.csrfToken };
  const start = await request.post('/api/auth/password/sign-in', { headers, data: { email, password } });
  const challenge = await start.json();

  expect(start.status()).toBe(202);
  const stillDenied = await request.get('/api/auth/methods');

  expect(stillDenied.status()).toBe(401);
  const loginCode = await readMailCode(email);
  const login = await request.post('/api/auth/password/verify', {
    headers,
    data: { flowId: challenge.flowId, factor: { kind: 'email', code: loginCode } },
  });
  const signedIn = await login.json();

  expect(login.status()).toBe(200);
  expect(signedIn).toMatchObject({ access: 'full', method: 'password', user: { id: verified.user.id } });
  const telemetry = await telemetryFiles.read();
  const exported = JSON.stringify(telemetry);

  for (const secret of [email, password, signupCode, loginCode, verified.user.id]) {
    expect(exported).not.toContain(secret);
  }
});
