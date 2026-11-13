import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { checkBimiSvg, checkBrand, checkPng, checkPublicCertificate, checkRetention } from './check.mjs';

const svg = await readFile(new URL('../../assets/brand/bimi/v1/visomi.svg', import.meta.url), 'utf8');

test('the complete public allowlist contains valid email and BIMI derivatives', checkBrand);

test('BIMI derivatives reject active or external content and unsupported profiles', () => {
  for (const unsafe of [
    svg.replace('<path', '<script>synthetic()</script><path'),
    svg.replace('<path', '<image href="https://example.test/pixel"/><path'),
    svg.replace('tiny-ps', 'full'),
    svg.replace('width="512"', 'width="100%"'),
    svg.replace('<path', '<path onclick="synthetic()"'),
    `<!DOCTYPE svg>${svg}`,
  ]) {
    assert.throws(() => checkBimiSvg(unsafe));
  }
});

test('email derivatives reject another format or unexpected dimensions', async () => {
  const bytes = await readFile(new URL('../../assets/brand/email/v1/logotype-stack.png', import.meta.url));
  const changed = Buffer.from(bytes);

  changed.writeUInt32BE(1, 16);
  assert.throws(() => checkPng(changed));
  assert.throws(() => checkPng(Buffer.from(svg)));
});

test('published URLs cannot be removed or reused for different bytes', async () => {
  const previous = { files: ['email/v1/logo.png'] };
  const read = async () => Buffer.from('synthetic original');
  const changed = async () => Buffer.from('synthetic replacement');

  await checkRetention(previous, { files: [...previous.files, 'email/v2/logo.png'] }, read, read);

  await assert.rejects(checkRetention(previous, { files: [] }, read, read), /remain in the allowlist/);

  await assert.rejects(checkRetention(previous, previous, read, changed), /cannot change/);
});

test('public certificate assets cannot contain private keys or arbitrary PEM content', () => {
  assert.throws(() => checkPublicCertificate('-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----'));
  assert.throws(() => checkPublicCertificate('-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'));
});
