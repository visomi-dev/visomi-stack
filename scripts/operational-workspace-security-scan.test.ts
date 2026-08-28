import assert from 'node:assert/strict';
import test from 'node:test';

import { scanJson, scanText } from './operational-workspace-security-scan.ts';

const scan = (text: string): string[] => {
  const findings: string[] = [];
  scanText(text, findings, 'fixture.json');
  return findings;
};

test('ignores secret patterns explicitly listed as absent by an audit', () => {
  assert.deepEqual(scan('Security scan found no occurrences of S3cureOpenApi! and themis-api-openapi-e2e-secret.'), []);
  assert.deepEqual(scan('The following secret patterns were absent: themis-app-e2e-secret.'), []);
});

test('still reports actual secret values outside a negative audit reference', () => {
  assert.equal(scan('Authorization: Bearer abcdefghijklmnop').length, 1);
  assert.equal(scan('fixture value: S3cureOpenApi!').length, 1);
  assert.equal(
    scan('Audit found no occurrences of S3cureOpenApi!; leaked value: themis-api-openapi-e2e-secret').length,
    1,
  );
});

test('reports protected JSON keys with non-redacted content', () => {
  const findings: string[] = [];
  scanJson({ token: 'not-redacted', nested: { privateKey: 'key material' } }, 'fixture.json', findings);
  assert.deepEqual(findings, [
    'fixture.json.token contains protected plaintext',
    'fixture.json.nested.privateKey contains protected plaintext',
  ]);
});

test('allows redacted protected JSON values', () => {
  const findings: string[] = [];
  scanJson({ token: '[REDACTED]', password: '', privateKey: '[REDACTED]' }, 'fixture.json', findings);
  assert.deepEqual(findings, []);
});
