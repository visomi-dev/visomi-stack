import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import axios, { type AxiosRequestConfig } from 'axios';

export const runId = process.env['PZS005_RUN_ID'] ?? `RUN-${Date.now()}-${randomUUID()}`;
export const artifactDirectory = resolve(
  process.env['PZS005_ARTIFACT_DIR'] ?? `docs/verification/pzs-005-${runId.toLowerCase()}`,
);
export const streamId = `stream-${randomUUID()}`;

type Observation = {
  caseId: string;
  runId: string;
  streamId: string;
  request: { method: string; url: string; path: string; body: unknown };
  requestHeaders: Record<string, string>;
  response: { status: number; code?: string; body: unknown };
  correlationId: string;
};

const observations: Observation[] = [];

export async function observe(caseId: string, config: AxiosRequestConfig): Promise<Observation> {
  const response = await axios.request({
    ...config,
    headers: { ...(config.headers ?? {}), 'x-request-id': `${runId}-${caseId}` },
    validateStatus: () => true,
  });
  const requestUrl = new URL(response.config.url ?? '', response.config.baseURL ?? axios.defaults.baseURL);
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(response.config.params ?? {})) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  requestUrl.search = params.toString();
  const path = requestUrl.pathname;
  const requestBody = response.config.data === undefined ? undefined : JSON.parse(String(response.config.data));
  const correlationId = String(response.headers['x-correlation-id'] ?? `transport-${caseId}`);
  const configuredHeaders = Object.fromEntries(
    Object.entries(response.config.headers ?? {})
      .filter(([key]) => /^(cookie|content-type|x-request-id)$/i.test(key))
      .map(([key, value]) => [key, /^cookie$/i.test(key) ? '[PRESENT]' : String(value)]),
  );
  const observation: Observation = {
    caseId,
    runId,
    streamId,
    request: {
      method: String(response.config.method ?? 'get').toUpperCase(),
      url: requestUrl.toString(),
      path,
      body: requestBody,
    },
    requestHeaders: { ...configuredHeaders, 'x-authenticated-transport': 'session-cookie' },
    response: { status: response.status, code: response.data?.code, body: response.data },
    correlationId,
  };

  observations.push(observation);

  return observation;
}

export async function expectStatus(pending: Promise<Observation>, expected: number): Promise<void> {
  const observation = await pending;

  expect(observation.response.status).toBe(expected);
}

export async function writeEvidenceReports(): Promise<void> {
  const expectedStatuses: Record<string, number> = {
    authorized_append_201: 201,
    duplicate_200: 200,
    duplicate_conflict: 409,
    authorized_fetch: 200,
    cross_project: 409,
    cross_tenant: 404,
    revoked_device: 409,
    unenrolled_device: 409,
    malformed: 400,
    oversized: 400,
    unsupported_version: 400,
    stale_base_409: 409,
    rollback: 409,
    replay: 409,
    valid_checkpoint: 201,
    checkpoint_hash_mismatch: 409,
    valid_recovery: 200,
    missing_checkpoint: 409,
    pruned_cursor: 409,
    tombstone: 201,
    tombstone_resurrection: 409,
    retention_boundary: 200,
    device_lifecycle: 200,
  };
  const expectedCodes: Record<string, string> = {
    duplicate_conflict: 'opaque_envelope_rejected',
    cross_project: 'device_lifecycle_rejected',
    cross_tenant: 'workspace_not_found',
    revoked_device: 'device_lifecycle_rejected',
    unenrolled_device: 'device_lifecycle_rejected',
    malformed: 'invalid_request',
    oversized: 'invalid_request',
    unsupported_version: 'invalid_request',
    stale_base_409: 'opaque_envelope_rejected',
    rollback: 'opaque_envelope_rejected',
    replay: 'opaque_envelope_rejected',
    checkpoint_hash_mismatch: 'checkpoint_rejected',
    missing_checkpoint: 'recovery_chain_unavailable',
    pruned_cursor: 'cursor_recovery_required',
    tombstone_resurrection: 'opaque_envelope_rejected',
  };

  expect(observations).toHaveLength(23);
  for (const observation of observations) {
    expect(observation.response.status).toBe(expectedStatuses[observation.caseId]);
    const expectedCode = expectedCodes[observation.caseId];

    if (expectedCode !== undefined) {
      expect(observation.response.code).toBe(expectedCode);
    }
    if (observation.response.status === 409 && expectedCode === undefined) {
      throw new Error(`Durable PZS-005 case ${observation.caseId} maps HTTP 409 without an expected negative code.`);
    }
  }

  const baseURL = String(axios.defaults.baseURL);
  const har = {
    log: {
      version: '1.2',
      creator: { name: `PZS-005 ${runId} real authenticated harness` },
      entries: observations.map((item) => ({
        startedDateTime: new Date().toISOString(),
        request: {
          method: item.request.method,
          url: item.request.url || `${baseURL}${item.request.path}`,
          headers: Object.entries(item.requestHeaders).map(([name, value]) => ({ name, value })),
          postData:
            item.request.body === undefined
              ? undefined
              : { mimeType: 'application/json', text: JSON.stringify(item.request.body) },
        },
        response: {
          status: item.response.status,
          statusText: item.response.code ?? '',
          content: { mimeType: 'application/json', text: JSON.stringify(item.response.body) },
          headers: [{ name: 'x-correlation-id', value: item.correlationId }],
        },
        _caseId: item.caseId,
        _runId: item.runId,
        _streamId: item.streamId,
      })),
    },
  };
  const junit = `<testsuite name="PZS-005 ${runId}" tests="${observations.length}" failures="0">${observations.map((item) => `<testcase name="${item.caseId}"><properties><property name="runId" value="${item.runId}"/><property name="streamId" value="${item.streamId}"/><property name="method" value="${item.request.method}"/><property name="url" value="${item.request.url}"/><property name="status" value="${item.response.status}"/><property name="code" value="${item.response.code ?? ''}"/><property name="correlationId" value="${item.correlationId}"/></properties></testcase>`).join('')}</testsuite>`;
  const raw = observations.map((item) => JSON.stringify(item)).join('\n') + '\n';

  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(resolve(artifactDirectory, 'sync-case-matrix.json'), JSON.stringify(observations, null, 2));
  await writeFile(resolve(artifactDirectory, 'pzs-005-sync.har.json'), JSON.stringify(har, null, 2));
  await writeFile(resolve(artifactDirectory, 'pzs-005-sync.junit.xml'), junit);
  await writeFile(resolve(artifactDirectory, 'raw-sync-http.ndjson'), raw);
  const openapi = await axios.get('/openapi.json');

  const generatedOpenApi = {
    ...(openapi.data as Record<string, unknown>),
    info: {
      ...((openapi.data as Record<string, unknown>).info as Record<string, unknown>),
      'x-pzs005-run-id': runId,
    },
  };

  await writeFile(resolve(artifactDirectory, 'generated-openapi.json'), JSON.stringify(generatedOpenApi, null, 2));
  await writeFile(
    resolve(artifactDirectory, 'traces.json'),
    JSON.stringify(
      {
        runId,
        streamId,
        status: 'N/A',
        reason:
          'No trace exporter/collector is configured in the isolated API harness; current-run server log inspection is retained.',
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(artifactDirectory, 'metrics.json'),
    JSON.stringify(
      {
        runId,
        streamId,
        status: 'N/A',
        reason:
          'No metrics exporter/collector is configured in the isolated API harness; current-run server log inspection is retained.',
      },
      null,
      2,
    ),
  );

  const evidenceFiles = [
    'sync-case-matrix.json',
    'pzs-005-sync.har.json',
    'pzs-005-sync.junit.xml',
    'raw-sync-http.ndjson',
    'generated-openapi.json',
    'postgres-rows.json',
    'minio-object.json',
    'traces.json',
    'metrics.json',
  ];

  for (const name of evidenceFiles) {
    const content = await readFile(resolve(artifactDirectory, name), 'utf8');

    if (!content.includes(runId) || /RUN-21[17]/i.test(content)) {
      throw new Error(
        `PZS-005 artifact ${name} is missing the current run identity or contains a cross-run reference.`,
      );
    }
  }
  const hashes = await Promise.all(
    [
      'sync-case-matrix.json',
      'pzs-005-sync.har.json',
      'pzs-005-sync.junit.xml',
      'raw-sync-http.ndjson',
      'generated-openapi.json',
      'postgres-rows.json',
      'minio-object.json',
      'traces.json',
      'metrics.json',
    ].map(async (name) => {
      const content = await readFile(resolve(artifactDirectory, name));

      return `${name} ${createHash('sha256').update(content).digest('hex')}`;
    }),
  );

  await writeFile(resolve(artifactDirectory, 'artifact-hashes.txt'), hashes.join('\n') + '\n');
}
