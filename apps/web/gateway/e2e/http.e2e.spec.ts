import { expect, test } from './fixtures/http';

test('mounts only the API and applies the host Helmet policy to successes and failures', async ({ request }) => {
  for (const [path, status] of [
    ['/api/', 200],
    ['/api/missing', 404],
    ['/', 404],
    ['/api/auth/passkeys', 401],
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
    expect(headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
  }
});
