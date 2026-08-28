import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'docs/verification/pzs-005-run-215');
const files = [
  'sync-request-response-fixtures.json',
  'http-case-records.ndjson',
  'openapi-response-excerpt.json',
  'har.json',
  'junit.xml',
  'postgres-row-dump.json',
  'object-storage-metadata-hashes.json',
  'raw-sync-http.ndjson',
  'logs.ndjson',
  'traces.json',
  'metrics.json',
  'disclosure-scan.json',
  'case-acceptance-matrix.json',
  'validation-matrix.json',
  'phase-item-status-gap-matrix.json',
  'command-results.json',
];

for (const file of files) {
  const content = await readFile(resolve(root, file), 'utf8');
  assert.ok(content.length > 0, `${file} must not be empty`);
}
const fixtures = JSON.parse(await readFile(resolve(root, files[0]), 'utf8')) as {
  cases: Array<{ id: string; response: { status: number; code?: string; body: Record<string, unknown> } }>;
};
assert.equal(fixtures.cases.length, 20);
assert.ok(
  fixtures.cases.every((item) => item.response.status >= 200 && item.response.status < 600 && item.response.code),
);
assert.deepEqual(fixtures.cases.find((item) => item.id === 'stale-base')?.response, {
  status: 409,
  code: 'opaque_envelope_rejected',
  body: { message: 'Envelope rejected.' },
});
assert.deepEqual(fixtures.cases.find((item) => item.id === 'cursor-recovery-required')?.response, {
  status: 409,
  code: 'cursor_recovery_required',
  body: { message: 'Cursor recovery required.' },
});
const caseRecords = (await readFile(resolve(root, 'http-case-records.ndjson'), 'utf8'))
  .trim()
  .split('\n')
  .map(
    (line) =>
      JSON.parse(line) as {
        case: string;
        request: { method: string; path: string; headers: Record<string, string>; body: unknown };
        observed: { status: number; code: string; body: Record<string, unknown> };
        artifact: string;
        acceptanceCriteria: string[];
      },
  );
assert.equal(caseRecords.length, 20);
assert.deepEqual(
  caseRecords.map((record) => record.case),
  fixtures.cases.map((item) => item.id),
);
assert.ok(
  caseRecords.every(
    (record) =>
      record.request.method &&
      record.request.path &&
      record.request.headers &&
      record.request.body !== undefined &&
      record.observed.status >= 200 &&
      record.observed.status < 600 &&
      record.observed.code &&
      record.observed.body &&
      record.artifact.startsWith('sync-request-response-fixtures.json#') &&
      record.acceptanceCriteria.length > 0,
  ),
);
const openApiExcerpt = JSON.parse(await readFile(resolve(root, 'openapi-response-excerpt.json'), 'utf8')) as {
  paths: Record<string, unknown>;
};
for (const path of [
  '/sync/{workspaceId}/devices',
  '/sync/{workspaceId}/devices/audit',
  '/sync/{workspaceId}/devices/{deviceId}/approval',
  '/sync/{workspaceId}/devices/{deviceId}/enroll',
  '/sync/{workspaceId}/devices/{deviceId}/revoke',
  '/sync/{workspaceId}/devices/recover',
]) {
  assert.ok(openApiExcerpt.paths[path], `${path} must be in the OpenAPI excerpt`);
}
const matrix = JSON.parse(await readFile(resolve(root, 'validation-matrix.json'), 'utf8')) as {
  categories: Array<{ category: string; result: string; command: string }>;
};
assert.deepEqual(
  matrix.categories.map((category) => category.category),
  ['unit', 'api', 'app-e2e', 'gateway-e2e', 'site-e2e', 'visual', 'security', 'build'],
);
assert.ok(matrix.categories.every((category) => category.result === 'PASS' || category.result === 'N/A'));
const phases = JSON.parse(await readFile(resolve(root, 'phase-item-status-gap-matrix.json'), 'utf8')) as {
  mapping: Array<{ phase: string }>;
};
assert.deepEqual(
  phases.mapping.map((phase) => phase.phase),
  ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'],
);
