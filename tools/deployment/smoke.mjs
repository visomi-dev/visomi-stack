import assert from 'node:assert/strict';

const origin = new URL(process.argv[2]);
const request = (path) => fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(10000) });

const redirect = await request('/');

assert.equal(redirect.status, 302);
assert.equal(new URL(redirect.headers.get('location'), origin).pathname, '/en/');
const api = await request('/api/');
const greeting = await api.json();

assert.equal(api.status, 200);
assert.deepEqual(greeting, { message: 'Hello API' });

for (const locale of ['en', 'es']) {
  const response = await request(`/${locale}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();

  assert.ok(html.includes(`<html lang="${locale}"`));
  const stylesheet = html.match(/href="([^"]+\.css)"/);

  assert.ok(stylesheet, 'Compiled stylesheet must be linked');
  const asset = await request(new URL(stylesheet[1], response.url));

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /text\/css/);
}

for (const locale of ['en', 'es']) {
  const response = await request(`/app/${locale}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.ok(html.includes('<app-root'));
  assert.ok(!html.includes('__VISOMI_CSP_NONCE__'));
  const nonce = html.match(/ngcspnonce="([^"]+)"/i)?.[1];

  assert.ok(nonce);
  assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const stylesheet = html.match(/href="([^"]+\.css)"/);

  assert.ok(stylesheet);
  const asset = await request(new URL(stylesheet[1], response.url));

  assert.equal(asset.status, 200);
}

for (const path of ['/api/missing', '/app/en/missing']) {
  const response = await request(path);

  assert.equal(response.status, 404);
  const body = await response.json();

  assert.deepEqual(body, { error: 'not_found' });
}

console.log('Gateway, localized Angular and Astro SSR, static assets, and route boundaries verified.');
