import type { APIRequestContext } from '@playwright/test';

import { authenticator } from '../../../../tests/support/authenticator';

import { expect, authTest as test } from './fixtures/http';

const origin = 'http://127.0.0.1:3307';
const rpId = '127.0.0.1';
const marker = 'SYNTHETIC_PRIVATE_AUTH_MARKER_42e8';

async function session(request: APIRequestContext) {
  const response = await request.get('/auth/session');
  const result = await response.json();

  expect(response.status()).toBe(200);

  return result as { authenticated: boolean; csrfToken: string; user: { id: string } | null };
}

async function enroll(request: APIRequestContext, token: string, device = authenticator()) {
  const headers = { origin, 'x-csrf-token': token };
  const begin = await request.post('/auth/passkeys/registration/options', { headers, data: {} });
  const options = await begin.json();

  expect(begin.status()).toBe(200);
  const response = device.register(options.options.challenge, origin, rpId);
  const verify = await request.post('/auth/passkeys/registration/verify', {
    headers,
    data: { challengeId: options.challengeId, response, label: marker },
  });
  const result = await verify.json();

  expect(verify.status()).toBe(201);

  return { device, result, response, challengeId: options.challengeId };
}

test('registers and signs in with real ES256 assertions, rotates cookies and revokes logout', async ({ request }) => {
  const anonymous = await session(request);
  const before = await request.storageState();
  const enrolled = await enroll(request, anonymous.csrfToken);
  const after = await request.storageState();

  expect(enrolled.result.user.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(after.cookies[0].value).not.toBe(before.cookies[0].value);
  expect(after.cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: false, path: '/' });
  const protectedResponse = await request.get('/auth/passkeys');
  const body = await protectedResponse.json();

  expect(protectedResponse.status()).toBe(200);
  expect(body.credentials).toHaveLength(1);
  const authenticatedCookie = after.cookies[0];
  const logout = await request.post('/auth/logout', {
    headers: { origin, 'x-csrf-token': enrolled.result.csrfToken },
    data: {},
  });

  expect(logout.status()).toBe(204);
  expect(logout.headers()['set-cookie']).toContain('Expires=Thu, 01 Jan 1970');
  const revoked = await request.get('/auth/passkeys', {
    headers: { cookie: `${authenticatedCookie.name}=${authenticatedCookie.value}` },
  });

  expect(revoked.status()).toBe(401);
  const nextSession = await session(request);
  const begin = await request.post('/auth/passkeys/authentication/options', {
    headers: { origin, 'x-csrf-token': nextSession.csrfToken },
    data: {},
  });
  const pending = await begin.json();
  const assertion = enrolled.device.authenticate(pending.options.challenge, origin, rpId, enrolled.result.user.id);
  const login = await request.post('/auth/passkeys/authentication/verify', {
    headers: { origin, 'x-csrf-token': nextSession.csrfToken },
    data: { challengeId: pending.challengeId, response: assertion },
  });
  const loggedIn = await login.json();

  expect(login.status()).toBe(200);
  expect(loggedIn.user.id).toBe(enrolled.result.user.id);
  const replay = await request.post('/auth/passkeys/authentication/verify', {
    headers: { origin, 'x-csrf-token': loggedIn.csrfToken },
    data: { challengeId: pending.challengeId, response: assertion },
  });

  expect(replay.status()).toBe(400);
});

test('rejects anonymous access, CSRF, identity injection and invalid WebAuthn origins', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const protectedResponse = await request.get('/auth/passkeys');
  const state = await session(request);
  const missingOrigin = await request.post('/auth/passkeys/registration/options', {
    headers: { 'x-csrf-token': state.csrfToken },
    data: {},
  });
  const injected = await request.post('/auth/passkeys/registration/options', {
    headers: { origin, 'x-csrf-token': state.csrfToken },
    data: { userId: 'existing-user', email: `${marker}@example.invalid` },
  });

  expect(protectedResponse.status()).toBe(401);
  expect(missingOrigin.status()).toBe(403);
  expect(injected.status()).toBe(400);
  const begin = await request.post('/auth/passkeys/registration/options', {
    headers: { origin, 'x-csrf-token': state.csrfToken },
    data: {},
  });
  const pending = await begin.json();
  const response = authenticator().register(pending.options.challenge, `https://${marker}.invalid`, rpId);
  const verify = await request.post('/auth/passkeys/registration/verify', {
    headers: { origin, 'x-csrf-token': state.csrfToken },
    data: { challengeId: pending.challengeId, response },
  });

  expect(verify.status()).toBe(400);
  const telemetry = await telemetryFiles.read();

  expect(JSON.stringify(telemetry)).not.toContain(marker);
});

test('enforces credential ownership, updates labels and prevents removal of the last passkey', async ({
  request,
  playwright,
}) => {
  const state = await session(request);
  const enrolled = await enroll(request, state.csrfToken);
  const initial = await request.get('/auth/passkeys');
  const first = await initial.json();
  const firstId = first.credentials[0].id;
  const headers = { origin, 'x-csrf-token': enrolled.result.csrfToken };
  const last = await request.delete(`/auth/passkeys/${firstId}`, { headers });
  const foreign = await playwright.request.newContext({ baseURL: origin });

  expect(last.status()).toBe(409);

  try {
    const foreignState = await session(foreign);
    const foreignUser = await enroll(foreign, foreignState.csrfToken);
    const denied = await foreign.patch(`/auth/passkeys/${firstId}`, {
      headers: { origin, 'x-csrf-token': foreignUser.result.csrfToken },
      data: { label: 'Denied' },
    });

    expect(denied.status()).toBe(404);
  } finally {
    await foreign.dispose();
  }

  const second = await enroll(request, enrolled.result.csrfToken);
  const all = await request.get('/auth/passkeys');
  const listed = await all.json();
  const secondId = listed.credentials.find((credential: { id: string }) => credential.id !== firstId).id;
  const secondHeaders = { origin, 'x-csrf-token': second.result.csrfToken };
  const renamed = await request.patch(`/auth/passkeys/${secondId}`, {
    headers: secondHeaders,
    data: { label: 'Synthetic device' },
  });
  const removed = await request.delete(`/auth/passkeys/${firstId}`, { headers: secondHeaders });

  expect(renamed.status()).toBe(204);
  expect(removed.status()).toBe(204);
  const remaining = await request.get('/auth/passkeys');
  const remainingBody = await remaining.json();

  expect(remainingBody.credentials).toHaveLength(1);
  expect(remainingBody.credentials[0].label).toBe('Synthetic device');
});

test('rejects expired and foreign-session challenges at the HTTP boundary', async ({
  request,
  playwright,
  database,
}) => {
  const state = await session(request);
  const headers = { origin, 'x-csrf-token': state.csrfToken };
  const begin = await request.post('/auth/passkeys/registration/options', { headers, data: {} });
  const pending = await begin.json();
  const device = authenticator();
  const response = device.register(pending.options.challenge, origin, rpId);
  const other = await playwright.request.newContext({ baseURL: origin });

  try {
    const foreign = await session(other);
    const denied = await other.post('/auth/passkeys/registration/verify', {
      headers: { origin, 'x-csrf-token': foreign.csrfToken },
      data: { challengeId: pending.challengeId, response },
    });

    expect(denied.status()).toBe(400);
  } finally {
    await other.dispose();
  }

  await database.query(
    "UPDATE auth_challenges SET created_at = now() - interval '5 minutes', expires_at = now() - interval '1 second' WHERE id = $1",
    [pending.challengeId],
  );
  const expired = await request.post('/auth/passkeys/registration/verify', {
    headers,
    data: { challengeId: pending.challengeId, response },
  });

  expect(expired.status()).toBe(400);
});

test('exports no credential, session, identity or SQL material after success and a database rejection', async ({
  request,
  telemetry: telemetryFiles,
}) => {
  const state = await session(request);
  const enrolled = await enroll(request, state.csrfToken);
  const cookies = await request.storageState();
  const headers = { origin, 'x-csrf-token': enrolled.result.csrfToken };
  const begin = await request.post('/auth/passkeys/registration/options', { headers, data: {} });
  const pending = await begin.json();
  const invalid = enrolled.device.register(pending.options.challenge, origin, rpId);
  const rejected = await request.post('/auth/passkeys/registration/verify', {
    headers,
    data: { challengeId: pending.challengeId, response: invalid, label: marker },
  });
  const rejectedBody = await rejected.json();
  const requestId = rejected.headers()['x-request-id'];

  expect(rejected.status()).toBe(503);
  expect(rejectedBody).toEqual({ error: 'authentication_unavailable' });
  await expect
    .poll(async () => {
      const telemetry = await telemetryFiles.read();
      const log = telemetry.logs.find((entry) => entry.requestId === requestId);

      return telemetry.spans.some((span) => (span.context as { spanId: string }).spanId === log?.spanId);
    })
    .toBe(true);
  const telemetry = await telemetryFiles.read();
  const serialized = JSON.stringify(telemetry);

  for (const sensitive of [
    marker,
    state.csrfToken,
    enrolled.result.csrfToken,
    enrolled.result.user.id,
    enrolled.device.id,
    enrolled.response.response.attestationObject,
    invalid.response.attestationObject,
    cookies.cookies[0].value,
  ]) {
    expect(serialized).not.toContain(sensitive);
  }
});

test('rate-limits anonymous session creation even through implicit HEAD routes', async ({ request }) => {
  const responses = await Promise.all(Array.from({ length: 61 }, () => request.head('/auth/session')));
  const statuses = responses.map((response) => response.status());

  expect(statuses.filter((status) => status === 200)).toHaveLength(60);
  expect(statuses.filter((status) => status === 429)).toHaveLength(1);
});
