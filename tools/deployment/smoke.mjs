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
  const asset = await request(stylesheet[1]);

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /text\/css/);
}

for (const path of ['/api/missing', '/app/en/']) {
  const response = await request(path);

  assert.equal(response.status, 404);
  const body = await response.json();

  assert.deepEqual(body, { error: 'not_found' });
}

console.log('Gateway, localized website, static assets, and route boundaries verified.');
