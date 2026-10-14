import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sanitizeJson, sanitizeReports, sanitizeText } from './report-sanitization';

test('report JSON redacts nested custody and authentication material while retaining HTTP evidence', () => {
  const sanitized = sanitizeJson({
    status: 401,
    body: {
      code: 'verification_failed',
      password: 'synthetic-secret',
      publicKey: { raw: 'synthetic-key' },
      entries: [{ sessionToken: 'synthetic-session', observed: true }],
    },
  });

  assert.deepEqual(sanitized, {
    status: 401,
    body: {
      code: 'verification_failed',
      password: '[REDACTED]',
      publicKey: '[REDACTED]',
      entries: [{ sessionToken: '[REDACTED]', observed: true }],
    },
  });
});

test('report text redacts both quotation styles, fixture identities, PINs and workspace paths', () => {
  const input =
    `\u001b[31m"password": "synthetic-secret" 'token': 'synthetic-token' 123456 ` +
    `openapi-synthetic@example.test ${process.cwd()}/dist/report.json\r`;
  const sanitized = sanitizeText(input);

  assert.ok(sanitized.includes('"password": "[REDACTED]"'));
  assert.ok(sanitized.includes('\'token\': "[REDACTED]"'));
  assert.ok(sanitized.includes('[REDACTED-PIN]'));
  assert.ok(sanitized.includes('[REPORT_ROOT]/report.json'));
  assert.ok(!sanitized.includes('synthetic-secret'));
  assert.ok(!sanitized.includes('synthetic-token'));
  assert.ok(!sanitized.includes('@example.test'));
  assert.ok(!sanitized.includes('\u001b'));
});

test('long diagnostic material is redacted only in the requested text and URL fields', () => {
  const material = 'synthetic-material-longer-than-twenty-four-characters';

  assert.equal(sanitizeText(material), material);
  assert.equal(sanitizeText(material, true), '[REDACTED-MATERIAL]');
  assert.deepEqual(sanitizeJson({ text: material, url: material, code: material }), {
    text: '[REDACTED-MATERIAL]',
    url: '[REDACTED-MATERIAL]',
    code: material,
  });
});

test('report directory redaction includes nested JSON, text and malformed JSON diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openapi-redaction-'));

  try {
    await mkdir(join(directory, 'raw'));
    await writeFile(join(directory, 'summary.json'), JSON.stringify({ status: 200, cookie: 'synthetic-cookie' }));
    await writeFile(join(directory, 'raw', 'invalid.json'), 'not-json "pin": "123456"');
    await writeFile(join(directory, 'raw', 'output.log'), '"privateKey": "synthetic-private-key"');
    await sanitizeReports(directory);
    const summary = await readFile(join(directory, 'summary.json'), 'utf8');
    const malformed = await readFile(join(directory, 'raw', 'invalid.json'), 'utf8');
    const output = await readFile(join(directory, 'raw', 'output.log'), 'utf8');

    assert.deepEqual(JSON.parse(summary), { status: 200, cookie: '[REDACTED]' });
    assert.equal(malformed, 'not-json "pin": "[REDACTED]"');
    assert.equal(output, '"privateKey": "[REDACTED]"');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
