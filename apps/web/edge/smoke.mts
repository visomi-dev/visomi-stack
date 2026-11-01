import assert from 'node:assert/strict';

const origin = 'https://stack.visomi.dev';
const marker = 'SYNTHETIC_PRIVATE_QUERY';
const invalid = ['%', '%zz', '%2', '%2X', '%0G', '%E0%A4%A', '%C3%28', '%FF', '%25%0G', '%/child'];
const valid = ['%25', '%2525', '%20', '%2F', '%C3%A9', '%F0%9F%8C%8D', '%25zz'];
let checked = 0;

for (const suffix of invalid) {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${origin}/api/${suffix}?private=${marker}`, {
      method,
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();

    assert.equal(response.status, 400);
    assert.ok(!body.includes(marker));

    // Cloudflare itself rejects some invalid escapes before invoking the Worker.
    if (method === 'GET' && response.headers.get('content-type')?.includes('application/json')) {
      assert.deepEqual(JSON.parse(body), { error: 'request_invalid' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }

    checked++;
  }
}

const healthy = ['/api/', '/api/?synthetic=%zz', '/app/en/', '/app/es/', '/en/', '/es/'];
const cases = [...valid.map((suffix) => ({ path: `/api/${suffix}`, status: 404 }))];

cases.push(...healthy.map((path) => ({ path, status: 200 })));

for (const { path, status } of cases) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000) });

  assert.equal(response.status, status);

  await response.arrayBuffer();

  checked++;
}

console.log(`Production path guard: ${checked} checks passed.`);
