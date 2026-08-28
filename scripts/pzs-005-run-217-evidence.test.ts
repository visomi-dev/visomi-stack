import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = resolve('docs/verification/pzs-005-run-217');

test('RUN-217 evidence is real sync HTTP and not synthetic fixture data', async () => {
  const matrix = JSON.parse(await readFile(resolve(root, 'sync-case-matrix.json'), 'utf8')) as {
    cases: Array<Record<string, unknown>>;
  };
  const har = JSON.parse(await readFile(resolve(root, 'pzs-005-sync.har.json'), 'utf8')) as {
    log: { entries: Array<Record<string, unknown>> };
  };
  const junit = await readFile(resolve(root, 'pzs-005-sync.junit.xml'), 'utf8');
  const openapi = JSON.parse(await readFile(resolve(root, 'generated-openapi.json'), 'utf8')) as {
    paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  };
  assert.equal(matrix.cases.length, 21);
  assert.equal(har.log.entries.length, matrix.cases.length);
  assert.match(junit, /name="PZS-005 RUN-217 real HTTP"/);
  assert.match(junit, new RegExp(`tests="${matrix.cases.length}"`));
  for (const path of [
    '/sync/{workspaceId}/devices',
    '/sync/{workspaceId}/devices/{deviceId}/enroll',
    '/sync/{workspaceId}/devices/{deviceId}/revoke',
    '/sync/{workspaceId}/devices/recover',
  ]) {
    assert.ok(openapi.paths[path], `${path} must be generated from the running app`);
    const operation = Object.values(openapi.paths[path]).find((value) => value.responses);
    assert.ok(
      operation?.responses && ['400', '401', '403', '404', '409', '500'].every((code) => code in operation.responses),
    );
  }

  for (const item of matrix.cases) {
    assert.match(String(item.path), /^\/sync\//, `${String(item.case)} must target a sync endpoint`);
    assert.equal(typeof item.timingMs, 'number');
    assert.match(String(item.correlationId), /^run-217-/);
    assert.match(String(item.artifactHash), /^[a-f0-9]{64}$/);
    assert.equal(typeof item.status, 'number');
  }

  for (const entry of har.log.entries) {
    const request = entry.request as Record<string, unknown>;
    const response = entry.response as Record<string, unknown>;
    assert.match(String(request.url), /\/api\/sync\//);
    assert.equal(typeof request.method, 'string');
    assert.equal(typeof response.status, 'number');
    assert.ok(response.content && typeof response.content === 'object');
    assert.match(String(entry._correlationId), /^run-217-/);
    assert.match(String(entry._artifactHash), /^[a-f0-9]{64}$/);
  }

  const stale = matrix.cases.find((item) => item.case === 'stale-base');
  const pruned = matrix.cases.find((item) => item.case === 'retention-pruned-cursor');
  assert.equal(stale?.status, 409);
  assert.equal(stale?.code, 'opaque_envelope_rejected');
  assert.equal(pruned?.status, 409);
  assert.equal(pruned?.code, 'cursor_recovery_required');
});
