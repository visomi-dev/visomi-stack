import assert from 'node:assert/strict';
import { afterEach, test, mock } from 'node:test';

import { rawHttpObservations, passkeyHttpObservations, origin } from './openapi-contract-context.ts';
import { canonicalize, requestJson, requestObservation, sessionCookieFrom } from './openapi-contract-http.ts';

afterEach(() => {
  mock.restoreAll();
  rawHttpObservations.length = 0;
  passkeyHttpObservations.length = 0;
});

test('observation modules share sanitized evidence while retaining session cookies only for transport', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });

    return new Response(JSON.stringify({ data: { password: 'private-response' }, code: 'observed' }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'connect.sid=private-session; HttpOnly, themis.hasSession=1; Path=/',
        'x-request-id': 'observed-request',
        'x-private-header': 'private-response-header',
      },
    });
  });
  const observation = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers: {
      Cookie: 'private-request-cookie',
      'Content-Type': 'application/json',
      'x-request-id': 'observed-request',
    },
    body: JSON.stringify({ password: 'private-request' }),
  });

  assert.equal(calls.length, 1);
  assert.equal(observation.path, '/auth/passkey/registration/complete');
  assert.equal(observation.method, 'POST');
  assert.equal(observation.status, 201);
  assert.equal(observation.sessionCookie, 'connect.sid=private-session');
  assert.equal(observation.correlationId, 'observed-request');
  assert.equal(observation.requestHeaders.Origin, origin);
  assert.equal(observation.responseHeaders['set-cookie'], '[PRESENT]');
  assert.equal(observation.requestHeaders.Cookie, undefined);
  assert.equal(observation.responseHeaders['x-private-header'], undefined);
  assert.equal(rawHttpObservations.length, 1);
  assert.equal(passkeyHttpObservations.length, 1);
  assert.doesNotMatch(JSON.stringify([rawHttpObservations, passkeyHttpObservations]), /private-/);
});

test('fixture JSON requests accept only the expected status before parsing the response', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('not-json', { status: 503 }));

  await assert.rejects(requestJson('/fixture', {}, [200, 201]), /fixture request \/fixture returned 503/);
});

test('malformed response bodies remain observations rather than fabricated JSON successes', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('upstream unavailable', { status: 502 }));
  const observation = await requestObservation('/health', {});

  assert.equal(observation.status, 502);
  assert.deepEqual(observation.body, { raw: 'upstream unavailable' });
  assert.equal(rawHttpObservations.length, 0);
  assert.equal(passkeyHttpObservations.length, 0);
});

test('cookie parsing excludes session hints and canonicalization preserves array order', () => {
  assert.equal(
    sessionCookieFrom(new Response('', { headers: { 'set-cookie': 'themis.hasSession=1; Path=/' } })),
    undefined,
  );
  assert.equal(canonicalize({ z: [2, 1], a: { b: true } }), '{"a":{"b":true},"z":[2,1]}');
});
