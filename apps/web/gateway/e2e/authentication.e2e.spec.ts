import { authenticator } from '@visomi-stack/dev-testing';

import { expect, authTest as test } from './fixtures/http';

const origin = 'http://127.0.0.1:3317';

test('uses inherited sessions for valid passkey signup, logout and sign-in through /api', async ({ request }) => {
  const initial = await request.get('/api/auth/session');
  const anonymous = await initial.json();
  const before = await request.storageState();
  const headers = { origin, 'x-csrf-token': anonymous.csrfToken };
  const begin = await request.post('/api/auth/passkeys/registration/options', { headers, data: {} });
  const pending = await begin.json();
  const device = authenticator();
  const registered = await request.post('/api/auth/passkeys/registration/verify', {
    headers,
    data: {
      challengeId: pending.challengeId,
      response: device.register(pending.options.challenge, origin, '127.0.0.1'),
    },
  });
  const identity = await registered.json();
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
