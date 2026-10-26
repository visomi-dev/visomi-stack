import { expect, test } from './fixtures/http';

test('applies the shared Helmet policy to successful requests, 404s and authentication failures', async ({
  request,
}) => {
  for (const [path, status] of [
    ['/', 200],
    ['/missing', 404],
    ['/auth/passkeys', 401],
  ] as const) {
    const response = await request.get(path);
    const headers = response.headers();

    expect(response.status()).toBe(status);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(headers['strict-transport-security']).toBeUndefined();
    expect(headers['x-powered-by']).toBeUndefined();
  }
});

test('returns controlled 401 and 403 errors without reflecting supplied authentication material', async ({
  request,
}) => {
  const marker = 'SYNTHETIC_PRIVATE_CSRF_9e13';
  const unauthorized = await request.get('/auth/passkeys');
  const unauthorizedBody = await unauthorized.json();
  const forbidden = await request.post('/auth/passkeys/registration/options', {
    headers: { origin: 'http://127.0.0.1:3307', 'x-csrf-token': marker },
    data: {},
  });
  const forbiddenBody = await forbidden.json();

  expect(unauthorized.status()).toBe(401);
  expect(unauthorizedBody).toEqual({ error: 'authentication_required' });
  expect(forbidden.status()).toBe(403);
  expect(forbiddenBody).toEqual({ error: 'csrf_invalid' });
  expect(forbidden.headers()['x-content-type-options']).toBe('nosniff');
  expect(JSON.stringify({ unauthorizedBody, forbiddenBody })).not.toContain(marker);
});
