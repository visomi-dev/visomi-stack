import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { waitForPortOpen } from '@nx/node/utils';

import { createAuthenticationResponse, createRegistrationFixture } from './webauthn-fixture.ts';

const host = process.env.HOST ?? 'localhost';
const port = Number(process.env.GATEWAY_PORT ?? 8080);
const baseUrl = `http://${host}:${port}`;
const origin = baseUrl;
const apiUrl = `${baseUrl}/api`;
const schemaUrl = `${apiUrl}/openapi.json`;
const reportDirectory = resolve(process.cwd(), 'dist/test-results/api-e2e/openapi');
const runId = process.env['PZS005_RUN_ID'] ?? 'RUN-239';
const stableReportDirectory = resolve(process.cwd(), `dist/test-results/api-e2e/${runId.toLowerCase()}`);
const rawDirectory = resolve(reportDirectory, 'raw');
const serverEntryPoint = resolve(process.cwd(), 'dist/apps/web/server/main.js');
const pidPath = resolve(process.cwd(), 'apps/web/api-e2e/.api-e2e-openapi-server.pid');
const clockFilePath = resolve(reportDirectory, '.passkey-clock');
const clockAdvanceFilePath = resolve(reportDirectory, '.passkey-clock-advance');
const clockPreloadPath = resolve(process.cwd(), 'apps/web/api-e2e/src/support/fake-clock.cjs');
const includePathRegex = process.env.SCHEMATHESIS_INCLUDE_PATH_REGEX;
const generationMode = process.env.SCHEMATHESIS_MODE ?? 'all';
const syncOnly = process.env['PZS005_SYNC_ONLY'] === 'true';
const passkeyOnly = includePathRegex?.startsWith('^/auth/passkey/') ?? false;
const phases = process.env.SCHEMATHESIS_PHASES ?? (passkeyOnly ? 'examples' : 'examples,coverage');
let activeServerPid: number | undefined;

type ChallengeResponse = {
  data?: {
    challengeId?: string;
    user?: { id?: string; accountId?: string };
  };
};

type Fixture = {
  cookie: string;
  smokeCookie: string;
  accountId: string;
  userId: string;
  email: string;
  smokeEmail: string;
  unverifiedEmail: string;
  isolatedCookie: string;
  isolatedAccountId: string;
  workspaceId: string;
  ownerDeviceId: string;
  agentDeviceId: string;
  enrollmentVersion: number;
  agentPrivateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  recoveryId: string;
  credentialId: string;
  schemaExampleEmail: string;
  schemaExampleCookie: string;
  schemaExampleRegistration: { challengeId: string; response: JsonRecord };
};

type JsonRecord = { [key: string]: unknown };

type PasskeySmokeResult = {
  name: string;
  path: string;
  status: number;
  observed: boolean;
  assertion: string;
  observation: HttpObservation;
};

type PasskeyExamples = {
  registrationBegin: JsonRecord;
  registrationComplete: JsonRecord;
  authenticationBegin: JsonRecord;
  authenticationComplete: JsonRecord;
};

type HttpObservation = {
  status: number;
  body: JsonRecord;
  timingMs: number;
  correlationId: string;
  requestBody?: string;
  requestHeaders: JsonRecord;
  responseHeaders: JsonRecord;
  sessionCookie?: string;
};

const rawHttpObservations: Array<{ method: string; path: string; status: number; requestBody?: string; body: string }> =
  [];
const passkeyHttpObservations: Array<{
  method: string;
  path: string;
  status: number;
  requestBody?: string;
  body: JsonRecord;
  timingMs: number;
  requestHeaders: JsonRecord;
  responseHeaders: JsonRecord;
}> = [];
const syncCaseObservations: Array<{
  case: string;
  acceptanceCriterion: string;
  method: string;
  path: string;
  status: number;
  code?: string;
  body: JsonRecord;
  timingMs: number;
  correlationId: string;
  requestHeaders: JsonRecord;
  responseHeaders: JsonRecord;
  requestBody?: string;
  artifactHash: string;
}> = [];

let passkeyExamples: PasskeyExamples | undefined;

const sensitiveKeys =
  /password|pin|token|cookie|authorization|challenge|credential|privatekey|publickey|signature|clientdata|attestation|authenticator|userhandle|proof|session/i;

function sanitizeText(value: string, redactLongMaterial = false): string {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const sanitized = value
    .replace(ansiPattern, '')
    .replace(/\r/g, '')
    .replaceAll(resolve(process.cwd(), 'dist'), '[REPORT_ROOT]')
    .replaceAll(process.cwd(), '[WORKSPACE_ROOT]')
    .replace(
      /("|')((?:password|pin|token|cookie|authorization|challenge(?:Id)?|credential(?:Id)?|rawId|privateKey|publicKey|signature|clientDataJSON|attestationObject|authenticatorData|userHandle|proof|session(?:Id|Token)?))("|')\s*:\s*("|')[^"']*("|')/gi,
      '$1$2$3: "[REDACTED]"',
    )
    .replace(
      /\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[1-5][A-Fa-f0-9]{3}-[89ABab][A-Fa-f0-9]{3}-[A-Fa-f0-9]{12}\b/g,
      '[REDACTED-ID]',
    )
    .replace(/\b\d{6}\b/g, '[REDACTED-PIN]')
    .replace(
      /S3cureOpenApi!|themis-api-openapi-e2e-secret|openapi-[A-Za-z0-9-]+(?:@|%40)example\.test|device-[A-Za-z0-9_-]+/g,
      '[REDACTED]',
    );

  return redactLongMaterial ? sanitized.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[REDACTED-MATERIAL]') : sanitized;
}

function sanitizeJson(value: unknown, key?: string): unknown {
  if (key && sensitiveKeys.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeJson(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === 'string') return sanitizeText(value, key === 'url' || key === 'text');

  return value;
}

function sessionCookieFrom(response: Response): string | undefined {
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = responseHeaders.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  const cookies = values
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((value) => value.split(';', 1)[0].trim())
    .filter((value) => value.length > 0 && !value.startsWith('themis.hasSession='));

  return cookies.length > 0 ? cookies.join('; ') : undefined;
}

async function sanitizeReports(directory = reportDirectory): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      await sanitizeReports(path);
      continue;
    }
    const content = await readFile(path, 'utf8');

    if (entry.name.endsWith('.json')) {
      try {
        await writeFile(path, JSON.stringify(sanitizeJson(JSON.parse(content)), null, 2));
        continue;
      } catch {
        // Fall through to text redaction for malformed or non-JSON diagnostics.
      }
    }
    await writeFile(path, sanitizeText(content));
  }
}

function captureOutput(stream: NodeJS.ReadableStream, output: { value: string }, rawOutput?: { value: string }): void {
  stream.on('data', (chunk: Buffer | string) => {
    if (rawOutput) rawOutput.value += chunk.toString();
    const sanitized = sanitizeText(chunk.toString(), true);

    output.value += sanitized;
    process.stdout.write(sanitized);
  });
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as JsonRecord)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as JsonRecord)[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function envelope(workspaceId: string, envelopeId: string, metadata: JsonRecord = {}): JsonRecord {
  return {
    format: 'themis.encrypted-envelope',
    version: 1,
    kind: 'sync-object',
    envelopeId,
    workspaceId,
    recordType: 'workspace-key-distribution',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    associatedData: {},
    metadata,
    nonce: 'bm9uY2U',
    ciphertext: 'Y2lwaGVydGV4dA',
    authTag: 'dGFn',
  };
}

async function requestJson(path: string, init: RequestInit, expected: number | number[] = 200): Promise<JsonRecord> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Origin: origin, ...init.headers },
  });
  const allowed = Array.isArray(expected) ? expected : [expected];

  if (!allowed.includes(response.status))
    throw new Error(`OpenAPI fixture request ${path} returned ${response.status}.`);

  return (await response.json()) as JsonRecord;
}

async function requestObservation(path: string, init: RequestInit): Promise<HttpObservation> {
  const correlationId =
    typeof init.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
      ? String((init.headers as Record<string, string>)['x-request-id'] ?? `${runId}-${randomBytes(8).toString('hex')}`)
      : `${runId}-${randomBytes(8).toString('hex')}`;
  const requestHeaders = {
    Origin: origin,
    ...(init.headers as Record<string, string> | undefined),
    'x-request-id': correlationId,
  };
  const startedAt = performance.now();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: requestHeaders,
  });
  const text = await response.text();
  const timingMs = Math.round((performance.now() - startedAt) * 100) / 100;

  if (
    path.endsWith('/workspace') ||
    path.startsWith('/sync/') ||
    path.startsWith('/auth/passkey/') ||
    path === '/auth/sign-up/verify'
  ) {
    rawHttpObservations.push({
      method: init.method ?? 'GET',
      path,
      status: response.status,
      requestBody: typeof init.body === 'string' ? sanitizeText(init.body, true) : undefined,
      body: sanitizeText(text, true),
    });
  }
  let body: JsonRecord;

  try {
    body = JSON.parse(text) as JsonRecord;
  } catch {
    body = { raw: text };
  }

  const safeRequestHeaders = Object.fromEntries(
    Object.entries(requestHeaders).filter(([key]) => /^(content-type|origin|x-request-id)$/i.test(key)),
  );
  const safeResponseHeaders = Object.fromEntries(
    [...response.headers.entries()]
      .filter(([key]) => /^(content-type|x-request-id|x-correlation-id|set-cookie)$/i.test(key))
      .map(([key, value]) => [key, key.toLowerCase() === 'set-cookie' ? '[PRESENT]' : value]),
  );

  if (path.startsWith('/auth/passkey/') || path === '/auth/sign-up/verify') {
    passkeyHttpObservations.push({
      method: init.method ?? 'GET',
      path,
      status: response.status,
      requestBody: typeof init.body === 'string' ? sanitizeText(init.body, true) : undefined,
      body: sanitizeJson(body) as JsonRecord,
      timingMs,
      requestHeaders: safeRequestHeaders,
      responseHeaders: safeResponseHeaders,
    });
  }

  return {
    method: init.method ?? 'GET',
    path,
    status: response.status,
    body,
    timingMs,
    correlationId,
    requestBody: typeof init.body === 'string' ? sanitizeText(init.body, true) : undefined,
    requestHeaders: safeRequestHeaders,
    responseHeaders: safeResponseHeaders,
    sessionCookie: sessionCookieFrom(response),
  };
}

async function verifySyncEvidence(fixture: Fixture): Promise<void> {
  const headers = { Cookie: fixture.cookie, 'Content-Type': 'application/json' };
  const observe = async (
    name: string,
    acceptanceCriterion: string,
    path: string,
    init: RequestInit,
  ): Promise<HttpObservation> => {
    const observation = await requestObservation(path, { ...init, headers: { ...headers, ...init.headers } });

    const record = {
      case: name,
      acceptanceCriterion,
      method: init.method ?? 'GET',
      path,
      status: observation.status,
      code: responseCode(observation),
      body: sanitizeJson(observation.body) as JsonRecord,
      timingMs: observation.timingMs,
      correlationId: observation.correlationId,
      requestHeaders: observation.requestHeaders,
      responseHeaders: observation.responseHeaders,
      requestBody: observation.requestBody,
      artifactHash: '',
    };

    record.artifactHash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
    syncCaseObservations.push(record);

    return observation;
  };
  const criterion = 'Authenticated opaque project-stream HTTP semantics and isolation';
  const expectedStatuses: Record<string, number> = {
    'append-201': 201,
    'duplicate-200': 200,
    'duplicate-conflict': 409,
    'cross-project': 404,
    'cross-tenant': 404,
    malformed: 400,
    oversized: 400,
    'unsupported-version': 400,
    'stale-base': 409,
    'replay-rollback': 409,
    'checkpoint-success': 201,
    'checkpoint-mismatch': 409,
    'recovery-success': 200,
    'recovery-missing-checkpoint': 409,
    'recovery-malformed-query': 400,
    'retention-pruned-cursor': 409,
    'tombstone-append': 201,
    'tombstone-non-resurrection': 409,
    'recovery-unauthorized-tenant': 404,
    'revoked-device-fetch': 409,
    'revoked-device-append': 409,
  };
  const expectedCodes: Record<string, string> = {
    'duplicate-conflict': 'opaque_envelope_rejected',
    'cross-project': 'workspace_not_found',
    'cross-tenant': 'workspace_not_found',
    malformed: 'invalid_request',
    oversized: 'invalid_request',
    'unsupported-version': 'invalid_request',
    'stale-base': 'opaque_envelope_rejected',
    'replay-rollback': 'opaque_envelope_rejected',
    'checkpoint-mismatch': 'checkpoint_rejected',
    'recovery-missing-checkpoint': 'recovery_chain_unavailable',
    'recovery-malformed-query': 'invalid_request',
    'retention-pruned-cursor': 'cursor_recovery_required',
    'tombstone-non-resurrection': 'opaque_envelope_rejected',
    'recovery-unauthorized-tenant': 'workspace_not_found',
    'revoked-device-fetch': 'device_lifecycle_rejected',
    'revoked-device-append': 'opaque_envelope_rejected',
  };
  const prefix = runId.toLowerCase();
  const stream = {
    ...envelope(fixture.workspaceId, `${prefix}-sync-stream`, { recipientDeviceId: fixture.agentDeviceId }),
    revision: 2,
  };
  const enrollmentVersion = fixture.enrollmentVersion;
  const appendBody = JSON.stringify({ envelope: stream, deviceId: fixture.agentDeviceId, enrollmentVersion });

  const append = await observe('append-201', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: appendBody,
  });
  const appendData = append.body.data;
  const checkpointCursor =
    appendData && typeof appendData === 'object' && 'cursor' in appendData
      ? Number((appendData as JsonRecord).cursor)
      : Number.NaN;

  if (!Number.isInteger(checkpointCursor) || checkpointCursor < 1) {
    throw new Error('OpenAPI PZS-005 append response did not return a valid checkpoint cursor.');
  }
  await observe('duplicate-200', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: appendBody,
  });
  await observe('duplicate-conflict', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, ciphertext: 'Y29uZmxpY3Q' },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe('cross-project', criterion, `/sync/00000000-0000-4000-8000-000000000000/envelopes`, {
    method: 'POST',
    body: appendBody,
  });
  await observe(
    'cross-tenant',
    criterion,
    `/sync/${fixture.workspaceId}/envelopes?deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}`,
    {
      method: 'GET',
      headers: { Cookie: fixture.isolatedCookie },
    },
  );
  await observe('malformed', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, version: 999 },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe('oversized', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, envelopeId: `${prefix}-oversized`, ciphertext: 'x'.repeat(100_001) },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe('unsupported-version', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, envelopeId: `${prefix}-unsupported`, version: 2 },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe('stale-base', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, envelopeId: `${prefix}-stale`, revision: 3, metadata: { baseCursor: '0' } },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe('replay-rollback', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, envelopeId: `${prefix}-rollback`, revision: 1 },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  const checkpoint = await observe('checkpoint-success', criterion, `/sync/${fixture.workspaceId}/checkpoints`, {
    method: 'POST',
    body: JSON.stringify({
      checkpointId: `${prefix}-checkpoint`,
      cursor: checkpointCursor,
      revision: 2,
      envelope: stream,
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });

  await observe('checkpoint-mismatch', criterion, `/sync/${fixture.workspaceId}/checkpoints`, {
    method: 'POST',
    body: JSON.stringify({
      checkpointId: `${prefix}-checkpoint-mismatch`,
      cursor: checkpointCursor,
      revision: 2,
      envelope: { ...stream, envelopeId: `${prefix}-other` },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe(
    'recovery-success',
    criterion,
    `/sync/${fixture.workspaceId}/recovery?checkpointId=${prefix}-checkpoint&deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}&afterCursor=0&limit=100`,
    { method: 'GET' },
  );
  await observe(
    'recovery-missing-checkpoint',
    criterion,
    `/sync/${fixture.workspaceId}/recovery?checkpointId=${prefix}-missing&deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}`,
    { method: 'GET' },
  );
  await observe(
    'recovery-malformed-query',
    criterion,
    `/sync/${fixture.workspaceId}/recovery?checkpointId=&deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}`,
    { method: 'GET' },
  );
  await observe(
    'retention-pruned-cursor',
    criterion,
    `/sync/${fixture.workspaceId}/envelopes?afterCursor=999999&limit=100&deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}`,
    { method: 'GET' },
  );
  const tombstone = {
    ...stream,
    recordType: 'tombstone',
    revision: 3,
    metadata: { deletedRecordId: `${prefix}-sync-stream` },
  };

  await observe('tombstone-append', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({ envelope: tombstone, deviceId: fixture.agentDeviceId, enrollmentVersion }),
  });
  await observe('tombstone-non-resurrection', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, revision: 1 },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  await observe(
    'recovery-unauthorized-tenant',
    criterion,
    `/sync/${fixture.workspaceId}/recovery?checkpointId=${prefix}-checkpoint&deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}`,
    { method: 'GET', headers: { Cookie: fixture.isolatedCookie } },
  );
  await requestJson(`/sync/${fixture.workspaceId}/devices/${fixture.agentDeviceId}/revoke`, {
    method: 'POST',
    headers,
  });
  await observe(
    'revoked-device-fetch',
    criterion,
    `/sync/${fixture.workspaceId}/envelopes?deviceId=${encodeURIComponent(fixture.agentDeviceId)}&enrollmentVersion=${enrollmentVersion}`,
    { method: 'GET' },
  );
  await observe('revoked-device-append', criterion, `/sync/${fixture.workspaceId}/envelopes`, {
    method: 'POST',
    body: JSON.stringify({
      envelope: { ...stream, envelopeId: `${prefix}-revoked`, revision: 4 },
      deviceId: fixture.agentDeviceId,
      enrollmentVersion,
    }),
  });
  if (syncCaseObservations.length !== 21) {
    throw new Error(`OpenAPI PZS-005 matrix captured ${syncCaseObservations.length} cases; expected 21.`);
  }
  for (const observation of syncCaseObservations) {
    const expected = expectedStatuses[observation.case];

    if (expected === undefined || observation.status !== expected) {
      throw new Error(
        `OpenAPI PZS-005 case ${observation.case} returned HTTP ${observation.status}; expected ${String(expected)}.`,
      );
    }
    const expectedCode = expectedCodes[observation.case];

    if (expectedCode !== undefined && observation.code !== expectedCode) {
      throw new Error(
        `OpenAPI PZS-005 case ${observation.case} returned code ${observation.code ?? 'missing'}; expected ${expectedCode}.`,
      );
    }
    if (observation.status === 409 && expectedCode === undefined) {
      throw new Error(`OpenAPI PZS-005 case ${observation.case} maps HTTP 409 without an expected negative code.`);
    }
  }
  await writeFile(
    resolve(reportDirectory, 'sync-case-matrix.json'),
    JSON.stringify({ checkpointStatus: checkpoint.status, cases: syncCaseObservations }, null, 2),
  );
  const harEntries = syncCaseObservations.map((item) => ({
    startedDateTime: new Date().toISOString(),
    time: item.timingMs,
    request: {
      method: item.method,
      url: `${apiUrl}${item.path}`,
      headers: Object.entries(item.requestHeaders).map(([name, value]) => ({ name, value: String(value) })),
      postData: item.requestBody ? { mimeType: 'application/json', text: item.requestBody } : undefined,
    },
    response: {
      status: item.status,
      headers: Object.entries(item.responseHeaders).map(([name, value]) => ({ name, value: String(value) })),
      content: { mimeType: 'application/json', text: JSON.stringify(item.body) },
    },
    _case: item.case,
    _correlationId: item.correlationId,
    _artifactHash: item.artifactHash,
  }));

  await writeFile(
    resolve(reportDirectory, 'pzs-005-sync.har.json'),
    JSON.stringify(
      { log: { version: '1.2', creator: { name: `${runId} OpenAPI sync transport capture` }, entries: harEntries } },
      null,
      2,
    ),
  );
  const xml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  await writeFile(
    resolve(reportDirectory, 'pzs-005-sync.junit.xml'),
    `<testsuite name="PZS-005 ${runId} OpenAPI sync HTTP" tests="${syncCaseObservations.length}">${syncCaseObservations
      .map(
        (item) =>
          `<testcase name="${xml(item.case)}" time="${item.timingMs / 1000}"><properties><property name="method" value="${xml(item.method)}"/><property name="path" value="${xml(item.path)}"/><property name="status" value="${item.status}"/><property name="code" value="${xml(item.code ?? '')}"/><property name="correlationId" value="${xml(item.correlationId)}"/><property name="artifactHash" value="${item.artifactHash}"/></properties></testcase>`,
      )
      .join('')}</testsuite>`,
  );
  await writeFile(
    resolve(reportDirectory, 'sync-surface-observations.json'),
    JSON.stringify(
      {
        postgres: {
          result: 'N/A',
          reason:
            'This authenticated API contract run intentionally uses DATABASE_DRIVER=memory; durable PostgreSQL rows are produced by the separate durable-integration target.',
        },
        objectStorage: {
          result: 'N/A',
          reason:
            'This contract run intentionally uses OPAQUE_SYNC_STORAGE=memory; object listing/metadata/ciphertext hash are produced by the separate durable-integration target.',
        },
        rawHttp: { result: 'OBSERVED', artifact: 'raw/http-responses.json', syncCases: 'sync-case-matrix.json' },
        serverLogs: { result: 'OBSERVED', artifact: 'raw/server.log', syncRoutes: true },
        traces: {
          result: 'N/A',
          reason:
            'No trace exporter is configured for this local API process; raw/server.log contains no trace sink, and the stable raw scan records zero trace records.',
        },
        metrics: {
          result: 'N/A',
          reason:
            'No metrics exporter is configured for this local API process; raw/server.log contains no metrics sink, and the stable raw scan records zero metric records.',
        },
        safeErrors: {
          result: 'OBSERVED',
          artifact: 'sync-case-matrix.json',
          disclosure: 'Only safe error codes/messages are retained.',
        },
      },
      null,
      2,
    ),
  );
}

function responseCode(observation: HttpObservation): string | undefined {
  return typeof observation.body.code === 'string' ? observation.body.code : undefined;
}

function requireResponseCode(observation: HttpObservation, expected: string, name: string): void {
  if (responseCode(observation) !== expected)
    throw new Error(
      `OpenAPI smoke case ${name} returned code ${responseCode(observation) ?? 'none'}, expected ${expected}.`,
    );
}

async function bootstrapSession(): Promise<Fixture> {
  const runSuffix = Date.now().toString(36);
  const email = `pzs005-${runId.toLowerCase()}-${runSuffix}@example.test`;
  const smokeEmail = `openapi-passkey-unverified-${runSuffix}@example.test`;
  const password = 'S3cureOpenApi!';

  await fetch(`${apiUrl}/test/mailbox`, { method: 'DELETE' });

  const signUp = await fetch(`${apiUrl}/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!signUp.ok) throw new Error(`OpenAPI contract bootstrap sign-up failed with ${signUp.status}.`);

  const signUpBody = (await signUp.json()) as ChallengeResponse;
  const challengeId = signUpBody.data?.challengeId;

  if (!challengeId) throw new Error('OpenAPI contract bootstrap did not return a sign-up challenge.');

  const mailbox = await fetch(`${apiUrl}/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=sign_up`);
  const mailboxBody = (await mailbox.json()) as { pin?: string };

  if (!mailboxBody.pin) throw new Error('OpenAPI contract bootstrap did not return a verification PIN.');

  const verify = await fetch(`${apiUrl}/auth/sign-up/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, pin: mailboxBody.pin }),
  });

  if (!verify.ok) throw new Error(`OpenAPI contract bootstrap verification failed with ${verify.status}.`);

  const verifyHeaders = verify.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = verifyHeaders.getSetCookie?.() ?? [verifyHeaders.get('set-cookie') ?? ''];

  if (setCookies.every((cookie) => cookie.length === 0))
    throw new Error('OpenAPI contract bootstrap did not return a session cookie.');

  const cookie = setCookies
    .filter((cookie) => cookie.length > 0)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');

  if (passkeyOnly) {
    const createVerifiedAccount = async (accountEmail: string): Promise<string> => {
      const response = await fetch(`${apiUrl}/auth/sign-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ email: accountEmail, password }),
      });
      const body = (await response.json()) as ChallengeResponse;
      const mailbox = await fetch(
        `${apiUrl}/test/mailbox/latest?email=${encodeURIComponent(accountEmail)}&purpose=sign_up`,
      );
      const pin = ((await mailbox.json()) as { pin?: string }).pin;

      if (!response.ok || !body.data?.challengeId || !pin)
        throw new Error(`OpenAPI passkey fixture sign-up failed for ${accountEmail}.`);
      const verification = await fetch(`${apiUrl}/auth/sign-up/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ challengeId: body.data.challengeId, pin }),
      });
      const verificationHeaders = verification.headers as Headers & { getSetCookie?: () => string[] };
      const verificationCookies = verificationHeaders.getSetCookie?.() ?? [verificationHeaders.get('set-cookie') ?? ''];

      if (!verification.ok || verificationCookies.every((value) => value.length === 0))
        throw new Error(`OpenAPI passkey fixture verification failed for ${accountEmail}.`);

      return verificationCookies
        .filter((value) => value.length > 0)
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    };
    const smokeEmail = `openapi-passkey-smoke-${runSuffix}@example.test`;
    const unverifiedEmail = `openapi-passkey-unverified-${Date.now().toString(36)}@example.test`;
    const smokeCookie = await createVerifiedAccount(smokeEmail);

    await fetch(`${apiUrl}/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: unverifiedEmail, password }),
    });

    return {
      cookie,
      smokeCookie,
      accountId: 'passkey-only-account',
      userId: 'passkey-only-user',
      email,
      smokeEmail,
      unverifiedEmail,
      isolatedCookie: smokeCookie,
      isolatedAccountId: 'passkey-only-isolated-account',
      workspaceId: 'passkey-only-workspace',
      ownerDeviceId: 'passkey-only-owner-device',
      agentDeviceId: 'passkey-only-agent-device',
      enrollmentVersion: 1,
      agentPrivateKey: generateKeyPairSync('ed25519').privateKey,
      recoveryId: 'passkey-only-recovery',
      credentialId: 'passkey-only-credential',
      schemaExampleEmail: email,
      schemaExampleCookie: cookie,
      schemaExampleRegistration: {
        challengeId: '',
        response: {},
      },
    };
  }

  const session = await requestJson('/auth/session', { headers: { Cookie: cookie } });
  const user = (session.data as JsonRecord).user as JsonRecord;
  const accountId = String(user.accountId);
  const userId = String(user.id);
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const project = await requestJson(
    '/projects',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'ZK-027 OpenAPI fixture', sourceType: 'manual' }),
    },
    201,
  );
  const workspaceId = String((project.data as JsonRecord).id);
  const ownerKeys = generateKeyPairSync('ed25519');
  const agentKeys = generateKeyPairSync('ed25519');
  const owner = await requestJson(`/sync/${workspaceId}/devices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      publicKey: ownerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      label: 'ZK-027 owner',
    }),
  });
  const ownerDeviceId = String((owner.data as JsonRecord).deviceId);

  await requestJson(`/sync/${workspaceId}/devices/${ownerDeviceId}/approval`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approverDeviceId: ownerDeviceId }),
  });
  // The single approver contract still requires the owner to be an enrolled
  // device. Approval alone must not be treated as authorization for the
  // owner to approve or use another device.
  await requestJson(`/sync/${workspaceId}/devices/${ownerDeviceId}/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      approverDeviceId: ownerDeviceId,
      envelope: envelope(workspaceId, `${runId.toLowerCase()}-owner-grant`, {
        recipientDeviceId: ownerDeviceId,
      }),
    }),
  });
  const agent = await requestJson(`/sync/${workspaceId}/devices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      publicKey: agentKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      label: 'ZK-027 local agent',
    }),
  });
  const agentDeviceId = String((agent.data as JsonRecord).deviceId);

  const agentEnrollment = await requestJson(`/sync/${workspaceId}/devices/${agentDeviceId}/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      approverDeviceId: ownerDeviceId,
      envelope: envelope(workspaceId, `${runId.toLowerCase()}-grant`, { recipientDeviceId: agentDeviceId }),
    }),
  });
  const enrollmentVersion = Number((agentEnrollment.data as JsonRecord).enrollmentVersion);

  if (!Number.isInteger(enrollmentVersion) || enrollmentVersion < 1) {
    throw new Error('OpenAPI fixture enrollment did not return a valid enrollmentVersion.');
  }
  const recovery = await requestJson(
    `/webauthn/${workspaceId}/recovery`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: `${runId.toLowerCase()}-recovery-enroll`, confirmed: true }),
    },
    201,
  );
  const metadataCredentialId = randomBytes(16).toString('base64url');

  const credential = await requestJson(
    `/webauthn/${workspaceId}/credentials`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        credentialId: metadataCredentialId,
        rpId: 'example.test',
        origin: 'https://example.test',
        prfSupported: true,
        transports: ['internal'],
      }),
    },
    201,
  );
  const credentialId = String((credential.data as JsonRecord).id);

  const smokeSignUp = await fetch(`${apiUrl}/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: smokeEmail, password }),
  });

  if (!smokeSignUp.ok) throw new Error(`OpenAPI passkey smoke sign-up failed with ${smokeSignUp.status}.`);

  const smokeSignUpBody = (await smokeSignUp.json()) as ChallengeResponse;
  const smokeMailbox = await fetch(
    `${apiUrl}/test/mailbox/latest?email=${encodeURIComponent(smokeEmail)}&purpose=sign_up`,
  );
  const smokePin = ((await smokeMailbox.json()) as { pin?: string }).pin;

  if (!smokeSignUpBody.data?.challengeId || !smokePin)
    throw new Error('OpenAPI isolation fixture did not return a verification challenge and PIN.');
  const smokeVerify = await fetch(`${apiUrl}/auth/sign-up/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: smokeSignUpBody.data.challengeId, pin: smokePin }),
  });
  const smokeCookies = (smokeVerify.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [
    smokeVerify.headers.get('set-cookie') ?? '',
  ];
  const isolatedCookie = smokeCookies
    .filter(Boolean)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
  const smokeCookie = isolatedCookie;
  const isolatedSession = await requestJson('/auth/session', { headers: { Cookie: isolatedCookie } });
  const isolatedUser = (isolatedSession.data as JsonRecord).user as JsonRecord;
  const unverifiedEmail = `openapi-passkey-unverified-${Date.now().toString(36)}@example.test`;
  const unverifiedSignUp = await fetch(`${apiUrl}/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: unverifiedEmail, password }),
  });

  if (!unverifiedSignUp.ok)
    throw new Error(`OpenAPI unverified passkey fixture sign-up failed with ${unverifiedSignUp.status}.`);

  return {
    cookie,
    smokeCookie,
    accountId,
    userId,
    email,
    smokeEmail,
    unverifiedEmail,
    isolatedCookie,
    isolatedAccountId: String(isolatedUser.accountId),
    workspaceId,
    ownerDeviceId,
    agentDeviceId,
    enrollmentVersion,
    agentPrivateKey: agentKeys.privateKey,
    recoveryId: String((recovery.data as JsonRecord).recoveryId),
    credentialId,
    schemaExampleEmail: smokeEmail,
    schemaExampleCookie: isolatedCookie,
    schemaExampleRegistration: { challengeId: '', response: {} },
  };
}

async function verifyPasskeySmoke(fixture: Fixture): Promise<void> {
  let headers = {
    Cookie: passkeyOnly ? fixture.isolatedCookie : fixture.smokeCookie,
    'Content-Type': 'application/json',
  };
  const accountHeaders = { Cookie: fixture.cookie, 'Content-Type': 'application/json' };
  const rpId = host;
  const pendingEmail = `openapi-passkey-pending-${Date.now().toString(36)}@example.test`;
  const pendingBegin = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingEmail, label: 'OpenAPI pending enrollment', pinVerified: true }),
  });
  const pendingData = pendingBegin.body.data as JsonRecord;
  const pendingCookie = pendingBegin.sessionCookie;

  if (pendingBegin.status !== 200 || !pendingCookie || typeof pendingData.options !== 'object')
    throw new Error(`Pending registration begin failed: ${observationDetail(pendingBegin)}`);
  const pendingRegistration = createRegistrationFixture(pendingData.options as JsonRecord, origin, rpId);
  const pendingComplete = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers: { Cookie: pendingCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: pendingData.challengeId, response: pendingRegistration.response }),
  });
  const pendingAuthBeforeVerification = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingEmail, pinVerified: true }),
  });
  const pendingMailbox = await fetch(
    `${apiUrl}/test/mailbox/latest?email=${encodeURIComponent(pendingEmail)}&purpose=sign_up`,
  );
  const pendingPin = ((await pendingMailbox.json()) as { pin?: string }).pin;

  if (!pendingPin) throw new Error('Pending enrollment fixture did not receive a verification PIN.');
  const pendingVerification = await requestObservation('/auth/sign-up/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: pendingData.verificationChallengeId, pin: pendingPin }),
  });

  if (pendingVerification.status === 200 && pendingVerification.sessionCookie) {
    headers = { Cookie: pendingVerification.sessionCookie, 'Content-Type': 'application/json' };
  }

  if (pendingVerification.status !== 200 || !pendingVerification.sessionCookie)
    throw new Error(
      `Pending enrollment verification did not activate an authenticated session: ${observationDetail(pendingVerification)}`,
    );

  if (pendingComplete.status !== 201)
    throw new Error(`Pending registration complete failed: ${observationDetail(pendingComplete)}`);

  const pendingCredentialId = String((pendingComplete.body.data as JsonRecord | undefined)?.id ?? '');

  if (!pendingCredentialId || pendingCredentialId !== pendingRegistration.credentialId)
    throw new Error('The pending enrollment did not persist the generated credential.');

  const pendingCredential = { ...pendingRegistration, credentialId: pendingCredentialId };
  const authenticationBegin = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: pendingEmail, pinVerified: true }),
  });

  if (authenticationBegin.status !== 200)
    throw new Error(`Authentication begin failed: ${observationDetail(authenticationBegin)}`);
  const authenticationData = authenticationBegin.body.data as JsonRecord;
  const authenticationResponse = createAuthenticationResponse(
    authenticationData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
  );
  const authenticationComplete = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ challengeId: authenticationData.challengeId, response: authenticationResponse }),
  });

  if (authenticationComplete.status !== 200 || !authenticationComplete.sessionCookie)
    throw new Error(
      `Authentication complete did not return a reauthenticated session: ${observationDetail(authenticationComplete)}`,
    );

  headers = { Cookie: authenticationComplete.sessionCookie, 'Content-Type': 'application/json' };

  const noSessionHeaders = { 'Content-Type': 'application/json' };
  const registrationHeaders = headers;
  const registrationBegin = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ email: pendingEmail, label: 'OpenAPI additional passkey', pinVerified: true }),
  });
  const registrationNoSession = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: fixture.email, label: 'OpenAPI unauthorized', pinVerified: true }),
  });
  const unverifiedEmail = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: fixture.unverifiedEmail, label: 'OpenAPI unverified email', pinVerified: true }),
  });

  const unverifiedPin = await requestObservation('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: accountHeaders,
    body: JSON.stringify({ email: fixture.email, label: 'OpenAPI unverified PIN', pinVerified: false }),
  });

  const authenticationUnverifiedEmail = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: fixture.unverifiedEmail, pinVerified: true }),
  });

  requireResponseCode(authenticationUnverifiedEmail, 'email_unverified', 'authentication-begin-unverified-email');

  const authenticationUnverifiedPin = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: fixture.email, pinVerified: false }),
  });

  requireResponseCode(authenticationUnverifiedPin, 'pin_required', 'authentication-begin-unverified-pin');

  const registrationData = registrationBegin.body.data as JsonRecord;

  if (registrationBegin.status !== 200)
    throw new Error(`Registration begin failed: ${observationDetail(registrationBegin)}`);
  const registrationChallengeId = String(registrationData.challengeId);

  const mismatchBegin = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ email: pendingEmail, label: 'OpenAPI smoke state', pinVerified: true }),
  });
  const mismatchData = mismatchBegin.data as JsonRecord;
  const mismatchCredential = createRegistrationFixture(mismatchData.options as JsonRecord, origin, rpId);
  const challengeMismatch = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ challengeId: registrationChallengeId, response: mismatchCredential.response }),
  });
  const expiredBeginResult = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ email: pendingEmail, label: 'OpenAPI expired state', pinVerified: true }),
  });
  const expiredData = expiredBeginResult.data as JsonRecord;
  const expiredFixture = createRegistrationFixture(expiredData.options as JsonRecord, origin, rpId);

  await writeFile(clockFilePath, String(Date.now() + 6 * 60 * 1000));
  const expired = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ challengeId: expiredData.challengeId, response: expiredFixture.response }),
  });

  await writeFile(clockFilePath, String(Date.now() - 6 * 60 * 1000));
  const successfulBegin = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ email: pendingEmail, label: 'OpenAPI smoke state', pinVerified: true }),
  });
  const successfulData = successfulBegin.data as JsonRecord;
  const generatedCredential = createRegistrationFixture(successfulData.options as JsonRecord, origin, rpId);
  const registrationComplete = await requestObservation('/auth/passkey/registration/complete', {
    method: 'POST',
    headers: registrationHeaders,
    body: JSON.stringify({ challengeId: successfulData.challengeId, response: generatedCredential.response }),
  });

  if (registrationComplete.status !== 201)
    throw new Error(`Registration complete failed: ${observationDetail(registrationComplete)}`);

  const persistedCredentialId = String((registrationComplete.body.data as JsonRecord | undefined)?.id ?? '');

  if (!persistedCredentialId || persistedCredentialId !== generatedCredential.credentialId)
    throw new Error('The application did not return the generated credential persisted by registration-complete.');
  const authenticationHeaders = headers;

  const replay = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({
      challengeId: authenticationData.challengeId,
      response: createAuthenticationResponse(
        authenticationData.options as JsonRecord,
        pendingCredential,
        origin,
        rpId,
        undefined,
        undefined,
        2,
      ),
    }),
  });
  const originBegin = await requestJson('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail, pinVerified: true }),
  });
  const originData = originBegin.data as JsonRecord;
  const originResponse = createAuthenticationResponse(
    originData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
    'https://wrong.example.test',
  );
  const originMismatch = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ challengeId: originData.challengeId, response: originResponse }),
  });
  const rpBegin = await requestJson('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail, pinVerified: true }),
  });
  const rpData = rpBegin.data as JsonRecord;
  const rpResponse = createAuthenticationResponse(
    rpData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
    undefined,
    'wrong.example.test',
  );
  const rpMismatch = await requestObservation('/auth/passkey/authentication/complete', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ challengeId: rpData.challengeId, response: rpResponse }),
  });

  const missingAccount = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: `openapi-missing-${Date.now()}@example.test`, pinVerified: true }),
  });
  const existingWithoutCredential = await requestObservation('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: noSessionHeaders,
    body: JSON.stringify({ email: fixture.email, pinVerified: true }),
  });
  const schemaRegistrationBegin = await requestJson('/auth/passkey/registration/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail, label: 'OpenAPI contract example', pinVerified: true }),
  });
  const schemaRegistrationData = schemaRegistrationBegin.data as JsonRecord;
  const schemaRegistration = createRegistrationFixture(schemaRegistrationData.options as JsonRecord, origin, rpId);

  const schemaAuthenticationBegin = await requestJson('/auth/passkey/authentication/begin', {
    method: 'POST',
    headers: authenticationHeaders,
    body: JSON.stringify({ email: pendingEmail, pinVerified: true }),
  });
  const schemaAuthenticationData = schemaAuthenticationBegin.data as JsonRecord;
  const schemaAuthenticationResponse = createAuthenticationResponse(
    schemaAuthenticationData.options as JsonRecord,
    pendingCredential,
    origin,
    rpId,
  );

  passkeyExamples = {
    registrationBegin: {
      email: pendingEmail,
      label: 'OpenAPI contract example',
      pinVerified: true,
    },
    registrationComplete: {
      challengeId: schemaRegistrationData.challengeId,
      response: schemaRegistration.response,
    },
    authenticationBegin: { email: pendingEmail, pinVerified: true },
    authenticationComplete: {
      challengeId: schemaAuthenticationData.challengeId,
      response: schemaAuthenticationResponse,
    },
  };

  const results: PasskeySmokeResult[] = [
    {
      name: 'registration-begin-pending-enrollment',
      path: '/auth/passkey/registration/begin',
      status: pendingBegin.status,
      observation: pendingBegin,
      observed: pendingBegin.status === 200 && Boolean(pendingData.verificationChallengeId),
      assertion:
        'Registration begin created a pending enrollment and returned the application verification challenge over real HTTP.',
    },
    {
      name: 'registration-complete-pending-credential',
      path: '/auth/passkey/registration/complete',
      status: pendingComplete.status,
      observation: pendingComplete,
      observed: pendingComplete.status === 201,
      assertion: 'Registration complete persisted a credential linked to the pending enrollment over real HTTP.',
    },
    {
      name: 'authentication-denied-before-verification',
      path: '/auth/passkey/authentication/begin',
      status: pendingAuthBeforeVerification.status,
      observation: pendingAuthBeforeVerification,
      observed:
        pendingAuthBeforeVerification.status === 403 &&
        responseCode(pendingAuthBeforeVerification) === 'email_unverified',
      assertion: `Pending enrollment authentication was denied before verification: ${observationDetail(pendingAuthBeforeVerification)}.`,
    },
    {
      name: 'verification-activation',
      path: '/auth/sign-up/verify',
      status: pendingVerification.status,
      observation: pendingVerification,
      observed: pendingVerification.status === 200,
      assertion:
        'The application atomically activated the pending account and enrolled credential through the real verification route.',
    },
    {
      name: 'registration-begin-success',
      path: '/auth/passkey/registration/begin',
      status: registrationBegin.status,
      observation: registrationBegin,
      observed: registrationBegin.status === 200,
      assertion: 'Registration begin returned application-generated persisted ceremony options over real HTTP.',
    },
    {
      name: 'registration-begin-existing-email-conflict',
      path: '/auth/passkey/registration/begin',
      status: registrationNoSession.status,
      observation: registrationNoSession,
      observed:
        registrationNoSession.status === 409 && responseCode(registrationNoSession) === 'email_already_registered',
      assertion: `The application rejected registration for an existing email with code ${responseCode(registrationNoSession) ?? 'none'}.`,
    },
    {
      name: 'registration-begin-unverified-email-pending-enrollment',
      path: '/auth/passkey/registration/begin',
      status: unverifiedEmail.status,
      observation: unverifiedEmail,
      observed: unverifiedEmail.status === 200,
      assertion: 'The application created a pending enrollment for the persisted unverified account over real HTTP.',
    },
    {
      name: 'registration-begin-unverified-pin',
      path: '/auth/passkey/registration/begin',
      status: unverifiedPin.status,
      observation: unverifiedPin,
      observed: responseCode(unverifiedPin) === 'pin_required',
      assertion: `The application denied pinVerified=false with code ${responseCode(unverifiedPin) ?? 'none'} over real HTTP.`,
    },
    {
      name: 'authentication-begin-unverified-email',
      path: '/auth/passkey/authentication/begin',
      status: authenticationUnverifiedEmail.status,
      observation: authenticationUnverifiedEmail,
      observed: true,
      assertion: `The persisted unverified account was denied by the application with code ${responseCode(authenticationUnverifiedEmail)}.`,
    },
    {
      name: 'authentication-begin-unverified-pin',
      path: '/auth/passkey/authentication/begin',
      status: authenticationUnverifiedPin.status,
      observation: authenticationUnverifiedPin,
      observed: responseCode(authenticationUnverifiedPin) === 'pin_required',
      assertion: `The application denied authentication with pinVerified=false and code ${responseCode(authenticationUnverifiedPin) ?? 'none'} over real HTTP.`,
    },
    {
      name: 'registration-complete-persisted-challenge-mismatch',
      path: '/auth/passkey/registration/complete',
      status: challengeMismatch.status,
      observation: challengeMismatch,
      observed: responseCode(challengeMismatch) === 'challenge_mismatch',
      assertion: `A valid response for one persisted begin challenge was submitted with another persisted challenge ID and the application returned ${observationDetail(challengeMismatch)}.`,
    },
    {
      name: 'registration-complete-expired-challenge',
      path: '/auth/passkey/registration/complete',
      status: expired.status,
      observation: expired,
      observed: expired.status === 400,
      assertion: `A valid attestation for the application-returned challenge was rejected after the bounded test clock advanced: ${observationDetail(expired)}.`,
    },
    {
      name: 'registration-complete-success',
      path: '/auth/passkey/registration/complete',
      status: registrationComplete.status,
      observation: registrationComplete,
      observed: registrationComplete.status === 201,
      assertion: 'Registration completion persisted the generated credential through the real HTTP application path.',
    },
    {
      name: 'authentication-begin-success',
      path: '/auth/passkey/authentication/begin',
      status: authenticationBegin.status,
      observation: authenticationBegin,
      observed: authenticationBegin.status === 200,
      assertion: 'Authentication begin returned application-generated persisted ceremony options over real HTTP.',
    },
    {
      name: 'authentication-complete-consumed-replay',
      path: '/auth/passkey/authentication/complete',
      status: replay.status,
      observation: replay,
      observed: responseCode(replay) === 'challenge_replayed',
      assertion: `A second valid assertion targeted the already consumed challenge and the application returned ${observationDetail(replay)}.`,
    },
    {
      name: 'authentication-complete-origin-mismatch',
      path: '/auth/passkey/authentication/complete',
      status: originMismatch.status,
      observation: originMismatch,
      observed: originMismatch.status === 401,
      assertion: `A validly signed assertion with a wrong origin was rejected by the application: ${observationDetail(originMismatch)}.`,
    },
    {
      name: 'authentication-complete-rp-mismatch',
      path: '/auth/passkey/authentication/complete',
      status: rpMismatch.status,
      observation: rpMismatch,
      observed: rpMismatch.status === 401,
      assertion: `A validly signed assertion with a wrong RP hash was rejected by the application: ${observationDetail(rpMismatch)}.`,
    },
    {
      name: 'authentication-complete-success',
      path: '/auth/passkey/authentication/complete',
      status: authenticationComplete.status,
      observation: authenticationComplete,
      observed: (authenticationComplete.body.data as JsonRecord | undefined)?.authenticated === true,
      assertion: 'Authentication completion returned the application-derived authenticated result over real HTTP.',
    },
    {
      name: 'account-enumeration-missing-account-no-credentials',
      path: '/auth/passkey/authentication/begin',
      status: missingAccount.status,
      observation: missingAccount,
      observed:
        missingAccount.status === 404 &&
        responseCode(missingAccount) === 'credential_not_found' &&
        missingAccount.status === existingWithoutCredential.status &&
        canonicalize(missingAccount.body) === canonicalize(existingWithoutCredential.body),
      assertion: `The missing account returned the same safe response as the existing account without credentials: missing=${JSON.stringify(missingAccount)}, existing=${JSON.stringify(existingWithoutCredential)}.`,
    },
    {
      name: 'account-enumeration-existing-account-no-credentials',
      path: '/auth/passkey/authentication/begin',
      status: existingWithoutCredential.status,
      observation: existingWithoutCredential,
      observed:
        existingWithoutCredential.status === 404 &&
        responseCode(existingWithoutCredential) === 'credential_not_found' &&
        existingWithoutCredential.status === missingAccount.status &&
        canonicalize(existingWithoutCredential.body) === canonicalize(missingAccount.body),
      assertion: `The existing account without credentials returned the same safe response as the missing account: existing=${JSON.stringify(existingWithoutCredential)}, missing=${JSON.stringify(missingAccount)}.`,
    },
  ];

  await writeFile(
    resolve(reportDirectory, 'passkey-smoke-summary.json'),
    JSON.stringify(
      {
        fixture: 'PASSKEY-002',
        execution: 'real-http',
        resolvedVersions: { schemathesis: '4.24.3', jsonschemaRs: '0.49.1' },
        cases: results,
        counts: {
          total: results.length,
          passed: results.filter((result) => result.observed).length,
          failed: results.filter((result) => !result.observed).length,
        },
        securityAssertions: [
          'The fixture creates persisted ceremony state through real HTTP begin endpoints and uses returned challenge context.',
          'Reports are sanitized and contain no passkey or private-key material.',
          'Registration and assertion material use ephemeral P-256 keys and standards-valid WebAuthn CBOR structures generated only in this process.',
        ],
      },
      null,
      2,
    ),
  );
  await writeStatefulPasskeyReports(results);
}

function claim(fixture: Fixture, profile: 'web-webcrypto' | 'web-local-agent'): JsonRecord {
  const now = '2026-01-01T00:00:00.000Z';
  const clientId = profile === 'web-webcrypto' ? `${runId}-web-client` : fixture.agentDeviceId;
  const capabilities =
    profile === 'web-webcrypto'
      ? ['vault-access', 'unlock', 'projection', 'sync', 'offline']
      : ['vault-access', 'unlock', 'projection', 'bridge', 'sync', 'recovery', 'offline'];
  const value: JsonRecord = {
    format: 'themis.client-capability',
    version: 1,
    claimId: `${runId}-${profile}`,
    clientId,
    clientProfile: profile,
    accountId: fixture.accountId,
    workspaceId: fixture.workspaceId,
    capabilities,
    issuedAt: now,
    expiresAt: '2027-01-01T00:00:00.000Z',
    authenticator: {
      scheme: profile === 'web-webcrypto' ? 'web-session' : 'local-agent-signature',
      keyId: profile === 'web-webcrypto' ? fixture.userId : clientId,
      proof: '',
    },
  };
  const unsigned = canonicalize(value);

  value.authenticator = {
    ...(value.authenticator as JsonRecord),
    proof:
      profile === 'web-webcrypto'
        ? `hmac-sha256:${createHmac('sha256', 'themis-api-openapi-e2e-secret').update(unsigned).digest('base64url')}`
        : `ed25519:${sign(null, Buffer.from(unsigned), fixture.agentPrivateKey).toString('base64url')}`,
  };

  return value;
}

async function prepareSchema(fixture: Fixture): Promise<string> {
  const schema = (await (await fetch(schemaUrl)).json()) as JsonRecord;
  const paths = schema.paths as JsonRecord;
  const values: JsonRecord = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.workspaceId,
    deviceId: fixture.agentDeviceId,
    credentialId: fixture.credentialId,
    recoveryId: fixture.recoveryId,
  };

  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const operation of Object.values(pathItem as JsonRecord)) {
      if (!operation || typeof operation !== 'object') continue;
      for (const parameter of ((operation as JsonRecord).parameters as JsonRecord[] | undefined) ?? []) {
        const name = String(parameter.name ?? '');

        if (name in values) parameter.example = values[name];
        if (name === 'deviceId') parameter.example = fixture.agentDeviceId;
        if (name === 'enrollmentVersion') parameter.example = fixture.enrollmentVersion;
      }
      if (pathItem === paths['/sync/{workspaceId}/envelopes'] && operation === (pathItem as JsonRecord).get) {
        const parameters = ((operation as JsonRecord).parameters ??= []) as JsonRecord[];

        for (const [name, example] of [
          ['deviceId', fixture.agentDeviceId],
          ['enrollmentVersion', fixture.enrollmentVersion],
        ] as const) {
          if (!parameters.some((parameter) => parameter.name === name)) {
            parameters.push({
              in: 'query',
              name,
              required: true,
              example,
              schema: { type: typeof example === 'number' ? 'integer' : 'string' },
            });
          }
        }
      }
    }
  }
  const bodyExamples: JsonRecord = {
    '/capabilities/{workspaceId}': {
      webOnly: {
        value: {
          format: 'themis.mode-negotiation-request',
          requestId: `${runId}-web-request`,
          clientId: `${runId}-web-client`,
          clientProfile: 'web-webcrypto',
          supportedModes: ['webcrypto'],
          supportedVersions: [1],
          requestedCapabilities: ['projection', 'sync'],
          preferredMode: 'webcrypto',
          allowDowngrade: false,
          claim: claim(fixture, 'web-webcrypto'),
        },
      },
      agentAssisted: {
        value: {
          format: 'themis.mode-negotiation-request',
          requestId: `${runId}-agent-request`,
          clientId: fixture.agentDeviceId,
          clientProfile: 'web-local-agent',
          supportedModes: ['local-agent', 'webcrypto'],
          supportedVersions: [1],
          requestedCapabilities: ['bridge', 'recovery'],
          preferredMode: 'local-agent',
          allowDowngrade: true,
          claim: claim(fixture, 'web-local-agent'),
        },
      },
    },
    '/sync/{workspaceId}/envelopes': {
      append: {
        value: {
          envelope: envelope(fixture.workspaceId, `${runId}-sync-object`, { recipientDeviceId: fixture.agentDeviceId }),
          deviceId: fixture.agentDeviceId,
          enrollmentVersion: fixture.enrollmentVersion,
        },
      },
    },
    '/sync/{workspaceId}/checkpoints': {
      create: {
        value: {
          checkpointId: `${runId}-checkpoint`,
          cursor: 1,
          revision: 1,
          envelope: envelope(fixture.workspaceId, `${runId}-sync-object`, { recipientDeviceId: fixture.agentDeviceId }),
          deviceId: fixture.agentDeviceId,
          enrollmentVersion: fixture.enrollmentVersion,
        },
      },
    },
    '/sync/{workspaceId}/devices/{deviceId}/enroll': {
      enroll: {
        value: {
          approverDeviceId: fixture.agentDeviceId,
          envelope: envelope(fixture.workspaceId, `${runId}-device-key`, { recipientDeviceId: fixture.agentDeviceId }),
        },
      },
    },
    '/sync/{workspaceId}/devices/recover': {
      recover: {
        value: {
          lostDeviceId: fixture.agentDeviceId,
          replacementDeviceId: fixture.agentDeviceId,
          approverDeviceIds: [fixture.agentDeviceId, fixture.agentDeviceId],
          allDeviceLoss: false,
          envelope: envelope(fixture.workspaceId, `${runId}-recovery-key`, {
            recipientDeviceId: fixture.agentDeviceId,
          }),
        },
      },
    },
    '/webauthn/{workspaceId}/recovery': {
      register: { value: { requestId: `${runId}-openapi-recovery`, confirmed: true } },
    },
    '/webauthn/{workspaceId}/recovery/{recoveryId}/use': {
      use: { value: { requestId: `${runId}-openapi-recovery-use`, confirmed: true } },
    },
    '/webauthn/{workspaceId}/credentials': {
      register: {
        value: {
          credentialId: fixture.credentialId,
          rpId: 'example.test',
          origin: 'https://example.test',
          prfSupported: true,
          transports: ['internal'],
        },
      },
    },
    '/auth/passkey/registration/begin': {
      smoke: { value: { email: fixture.smokeEmail, label: 'OpenAPI smoke', pinVerified: true } },
    },
    '/auth/passkey/authentication/begin': {
      smoke: { value: { email: fixture.smokeEmail, pinVerified: true, explicitPassword: true } },
    },
  };

  for (const [path, examples] of Object.entries(bodyExamples)) {
    const operation = (paths[path] as JsonRecord | undefined)?.post;
    const content = ((operation?.requestBody as JsonRecord | undefined)?.content as JsonRecord | undefined)?.[
      'application/json'
    ] as JsonRecord | undefined;

    if (content) content.examples = examples;
  }

  if (passkeyExamples) {
    const completeExamples = [
      ['/auth/passkey/registration/begin', passkeyExamples.registrationBegin],
      ['/auth/passkey/registration/complete', passkeyExamples.registrationComplete],
      ['/auth/passkey/authentication/begin', passkeyExamples.authenticationBegin],
      ['/auth/passkey/authentication/complete', passkeyExamples.authenticationComplete],
    ] as const;

    for (const [path, value] of completeExamples) {
      const operation = (paths[path] as JsonRecord | undefined)?.post;

      if (!operation) continue;

      const content = ((operation.requestBody as JsonRecord | undefined)?.content as JsonRecord | undefined)?.[
        'application/json'
      ] as JsonRecord | undefined;

      if (content) content.examples = { smoke: { value } };
    }
  }

  for (const path of [
    '/auth/passkey/registration/begin',
    '/auth/passkey/registration/complete',
    '/auth/passkey/authentication/begin',
    '/auth/passkey/authentication/complete',
  ]) {
    const operation = (paths[path] as JsonRecord | undefined)?.post;

    if (operation) {
      const parameters = (operation.parameters ??= []) as JsonRecord[];

      if (!parameters.some((parameter) => parameter.in === 'header' && parameter.name === 'Origin')) {
        parameters.push({
          in: 'header',
          name: 'Origin',
          required: true,
          example: origin,
          schema: { type: 'string', format: 'uri' },
        });
      }
      const responses = (operation.responses ??= {}) as JsonRecord;

      responses['429'] ??= {
        description: 'Passkey rate limit exceeded.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { const: 'rate_limited' },
                message: { type: 'string' },
              },
            },
          },
        },
      };
    }
  }

  if (includePathRegex) {
    // Schemathesis executes operation examples independently.  A persisted
    // complete example is invalidated when the corresponding begin operation
    // runs first, so ceremony success is covered by the preceding real-HTTP
    // smoke flow while the contract run exercises the begin operations.
    const contractPathRegex = passkeyOnly ? '^/auth/passkey/(registration|authentication)/begin$' : includePathRegex;
    const includePath = new RegExp(contractPathRegex);

    schema.paths = Object.fromEntries(Object.entries(paths).filter(([path]) => includePath.test(path)));
  }

  const schemaPath = resolve(reportDirectory, `${runId.toLowerCase()}-openapi-schema.json`);

  await writeFile(schemaPath, JSON.stringify(schema, null, 2));

  return schemaPath;
}

async function verifyFixtureBoundary(fixture: Fixture): Promise<void> {
  const headers = { Cookie: fixture.cookie, 'Content-Type': 'application/json' };
  const boundaryDevice = await requestJson(`/sync/${fixture.workspaceId}/devices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ publicKey: `${runId}-boundary-device`, label: `${runId} boundary device` }),
  });
  const boundaryDeviceId = String((boundaryDevice.data as JsonRecord).deviceId);
  const boundaryEnrollment = await requestJson(`/sync/${fixture.workspaceId}/devices/${boundaryDeviceId}/enroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      approverDeviceId: fixture.ownerDeviceId,
      envelope: envelope(fixture.workspaceId, `${runId}-boundary-grant`, { recipientDeviceId: boundaryDeviceId }),
    }),
  });
  const boundaryEnrollmentVersion = Number((boundaryEnrollment.data as JsonRecord).enrollmentVersion);
  const workspace = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, { headers });
  const workspaceUnauthorized = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {});
  const workspaceIsolated = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { Cookie: fixture.isolatedCookie },
  });
  const workspaceUnauthorizedFixture = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-state': 'unauthorized' },
  });
  const unavailable = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-http-case': 'unavailable' },
  });
  const serverError = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-http-case': 'error' },
  });
  const malformedJsonResponse = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-http-case': 'malformed-json' },
  });

  if (
    workspace.status !== 200 ||
    (workspace.body.data as JsonRecord | undefined)?.schemaVersion !== '1' ||
    (workspace.body.data as JsonRecord | undefined)?.readOnly !== true ||
    JSON.stringify(workspace.body).includes('contentMarkdown')
  ) {
    throw new Error('Operational workspace read boundary did not return the safe versioned projection.');
  }
  if (
    workspaceUnauthorized.status !== 401 ||
    workspaceUnauthorizedFixture.status !== 401 ||
    workspaceIsolated.status !== 404 ||
    unavailable.status !== 503 ||
    responseCode(unavailable) !== 'operational_workspace_unavailable' ||
    serverError.status !== 500 ||
    responseCode(serverError) !== 'operational_workspace_error' ||
    malformedJsonResponse.status !== 502 ||
    malformedJsonResponse.body.raw !== '{"data":'
  ) {
    throw new Error('Operational workspace read boundary did not preserve authentication and tenant isolation.');
  }
  const stateCases = await Promise.all(
    (['visible', 'empty', 'locked', 'unavailable', 'stale', 'error', 'malformed'] as const).map(async (state) => {
      const observation = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
        headers: { ...headers, 'x-operational-workspace-state': state },
      });
      const data = observation.body.data as JsonRecord | undefined;
      const collections = ['protectedContext', 'epics', 'workItems', 'runs', 'evidence', 'reviews', 'activity'];
      const observed =
        observation.status === 200 &&
        data?.schemaVersion === '1' &&
        collections.every((key) => (data[key] as JsonRecord | undefined)?.state === state) &&
        !JSON.stringify(observation.body).includes('contentMarkdown');

      if (!observed) throw new Error(`Operational workspace state fixture ${state} was not observed safely.`);

      return { name: state, status: observation.status, observed };
    }),
  );
  const malformedObservation = await requestObservation(`/projects/${fixture.workspaceId}/workspace`, {
    headers: { ...headers, 'x-operational-workspace-state': 'malformed' },
  });
  const malformedItems = (
    (malformedObservation.body.data as JsonRecord | undefined)?.workItems as JsonRecord | undefined
  )?.items;
  const malformedSchemaObserved =
    malformedObservation.status === 200 &&
    Array.isArray(malformedItems) &&
    malformedItems.some((item) => {
      const record = item as JsonRecord;

      return typeof record.id === 'string' && typeof record.title !== 'string';
    });

  if (!malformedSchemaObserved)
    throw new Error('Malformed nested operational workspace payload was not observed over HTTP.');
  const webRequest = {
    format: 'themis.mode-negotiation-request',
    requestId: `${runId}-boundary-web`,
    clientId: `${runId}-web-client`,
    clientProfile: 'web-webcrypto',
    supportedModes: ['webcrypto'],
    supportedVersions: [1],
    requestedCapabilities: ['projection', 'sync'],
    preferredMode: 'webcrypto',
    allowDowngrade: false,
    claim: claim(fixture, 'web-webcrypto'),
  };
  const agentRequest = {
    format: 'themis.mode-negotiation-request',
    requestId: `${runId}-boundary-agent`,
    clientId: fixture.agentDeviceId,
    clientProfile: 'web-local-agent',
    supportedModes: ['local-agent', 'webcrypto'],
    supportedVersions: [1],
    requestedCapabilities: ['bridge', 'recovery'],
    preferredMode: 'local-agent',
    allowDowngrade: true,
    claim: claim(fixture, 'web-local-agent'),
  };
  const checks: Array<[string, Promise<Response>, number]> = [
    ['capability discovery', fetch(`${apiUrl}/capabilities/${fixture.workspaceId}`, { headers }), 200],
    [
      'Web-only negotiation',
      fetch(`${apiUrl}/capabilities/${fixture.workspaceId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(webRequest),
      }),
      200,
    ],
    [
      'agent-assisted negotiation',
      fetch(`${apiUrl}/capabilities/${fixture.workspaceId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(agentRequest),
      }),
      200,
    ],
    [
      'opaque append',
      fetch(`${apiUrl}/sync/${fixture.workspaceId}/envelopes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          envelope: envelope(fixture.workspaceId, `${runId}-boundary-sync`, {
            recipientDeviceId: boundaryDeviceId,
          }),
          deviceId: boundaryDeviceId,
          enrollmentVersion: boundaryEnrollmentVersion,
        }),
      }),
      201,
    ],
    [
      'opaque fetch',
      fetch(
        `${apiUrl}/sync/${fixture.workspaceId}/envelopes?deviceId=${encodeURIComponent(boundaryDeviceId)}&enrollmentVersion=${boundaryEnrollmentVersion}`,
        { headers },
      ),
      200,
    ],
  ];
  const results = await Promise.all(
    checks.map(async ([name, responsePromise, expected]) => {
      const response = await responsePromise;

      if (response.status !== expected)
        throw new Error(`OpenAPI fixture boundary ${name} returned ${response.status}, expected ${expected}.`);

      return { name, status: response.status };
    }),
  );

  await writeFile(
    resolve(reportDirectory, `${runId.toLowerCase()}-fixture-summary.json`),
    JSON.stringify(
      {
        profileCoverage: ['web-webcrypto', 'web-local-agent'],
        protectedBoundary: results,
        operationalWorkspaceReadBoundary: [
          { name: 'authorized-versioned-read', status: workspace.status, observed: workspace.status === 200 },
          {
            name: 'unauthorized-read',
            status: workspaceUnauthorized.status,
            observed: workspaceUnauthorized.status === 401,
          },
          {
            name: 'tenant-isolated-read',
            status: workspaceIsolated.status,
            observed: workspaceIsolated.status === 404,
          },
          {
            name: 'fixture-unauthorized-read',
            status: workspaceUnauthorizedFixture.status,
            observed: workspaceUnauthorizedFixture.status === 401,
          },
          {
            name: 'unavailable-http-response',
            status: unavailable.status,
            observed: unavailable.status === 503 && responseCode(unavailable) === 'operational_workspace_unavailable',
          },
          {
            name: 'error-http-response',
            status: serverError.status,
            observed: serverError.status === 500 && responseCode(serverError) === 'operational_workspace_error',
          },
          {
            name: 'malformed-json-http-response',
            status: malformedJsonResponse.status,
            observed: malformedJsonResponse.status === 502 && malformedJsonResponse.body.raw === '{"data":',
          },
          {
            name: 'malformed-nested-schema-payload',
            status: malformedObservation.status,
            observed: malformedSchemaObserved,
          },
          {
            name: 'protected-disclosure-redaction',
            status: workspace.status,
            observed: !JSON.stringify(workspace.body).includes('contentMarkdown'),
          },
          ...stateCases,
        ],
        recoveryId: fixture.recoveryId,
        credentialId: fixture.credentialId,
        workspaceId: fixture.workspaceId,
        reports: ['passkey-stateful.junit.xml', 'passkey-stateful.har.json'],
      },
      null,
      2,
    ),
  );
}

function stopServer(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== 'ESRCH') {
      console.error('Failed to stop the OpenAPI contract test server.', error);
    }
  }
}

function observationDetail(observation: HttpObservation): string {
  const code = responseCode(observation);
  const message = typeof observation.body.message === 'string' ? observation.body.message : 'no application message';

  return `${code ?? 'no application code'}: ${message}`;
}

async function writeStatefulPasskeyReports(results: PasskeySmokeResult[]): Promise<void> {
  const escaped = (value: string): string =>
    sanitizeText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  if (results.length !== passkeyHttpObservations.length) {
    throw new Error(
      `PASSKEY-002 stateful report captured ${passkeyHttpObservations.length} HTTP observations for ${results.length} cases.`,
    );
  }
  const entries = results.map((result) => {
    const observation = result.observation;

    if (observation.path !== result.path || observation.status !== result.status) {
      throw new Error(
        `PASSKEY-002 stateful case ${result.name} does not match its HTTP observation: ${observation.method} ${observation.path} returned ${observation.status}.`,
      );
    }

    return {
      ...result,
      assertion: sanitizeText(result.assertion, true),
      observation: {
        method: observation.method,
        path: observation.path,
        status: observation.status,
        requestBody: observation.requestBody,
        body: sanitizeJson(observation.body),
        timingMs: observation.timingMs,
        requestHeaders: observation.requestHeaders,
        responseHeaders: observation.responseHeaders,
      },
    };
  });
  const passed = entries.filter((entry) => entry.observed).length;

  await writeFile(
    resolve(reportDirectory, 'passkey-stateful-http.json'),
    JSON.stringify(
      {
        fixture: 'PASSKEY-002',
        execution: 'real-http-stateful',
        provenance: {
          reportType: 'stateful-http-contract',
          runner: 'apps/web/api-e2e/src/support/run-openapi-contract.ts',
          source: 'passkeyHttpObservations captured by requestObservation after actual fetch responses',
          schemathesis: false,
        },
        cases: entries,
        counts: { total: entries.length, passed, failed: entries.length - passed },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(reportDirectory, 'passkey-stateful.junit.xml'),
    `<testsuite name="PASSKEY-002 stateful HTTP contract (runner-generated)" tests="${entries.length}" failures="${entries.length - passed}" errors="0"><properties><property name="reportType" value="stateful-http-contract"/><property name="runner" value="apps/web/api-e2e/src/support/run-openapi-contract.ts"/><property name="source" value="passkeyHttpObservations captured by requestObservation after actual fetch responses"/><property name="schemathesis" value="false"/></properties>${entries
      .map(
        (entry) =>
          `<testcase name="${escaped(entry.name)}" time="${(entry.observation.timingMs / 1000).toFixed(3)}"><properties><property name="path" value="${escaped(entry.path)}"/><property name="status" value="${entry.status}"/><property name="observed" value="${entry.observed}"/></properties>${entry.observed ? '' : `<failure message="${escaped(entry.assertion)}"/>`}</testcase>`,
      )
      .join('')}</testsuite>`,
  );
  await writeFile(
    resolve(reportDirectory, 'passkey-stateful.har.json'),
    JSON.stringify(
      {
        log: {
          version: '1.2',
          creator: { name: `${runId} PASSKEY-002 stateful HTTP contract runner` },
          _provenance: {
            reportType: 'stateful-http-contract',
            runner: 'apps/web/api-e2e/src/support/run-openapi-contract.ts',
            source: 'passkeyHttpObservations captured by requestObservation after actual fetch responses',
            schemathesis: false,
          },
          entries: entries.flatMap((entry) => {
            const observation = entry.observation;

            return observation
              ? [
                  {
                    time: observation.timingMs,
                    request: {
                      method: observation.method,
                      url: `${apiUrl}${observation.path}`,
                      headers: Object.entries(observation.requestHeaders).map(([name, value]) => ({
                        name,
                        value: String(value),
                      })),
                      postData: observation.requestBody
                        ? { mimeType: 'application/json', text: observation.requestBody }
                        : undefined,
                    },
                    response: {
                      status: observation.status,
                      headers: Object.entries(observation.responseHeaders).map(([name, value]) => ({
                        name,
                        value: String(value),
                      })),
                      content: { mimeType: 'application/json', text: JSON.stringify(observation.body) },
                    },
                    _case: entry.name,
                  },
                ]
              : [];
          }),
        },
      },
      null,
      2,
    ),
  );
}

async function run(): Promise<number> {
  await rm(reportDirectory, { recursive: true, force: true });
  await rm(stableReportDirectory, { recursive: true, force: true });
  if (process.env['PZS005_ARTIFACT_DIR']) {
    await rm(resolve(process.env['PZS005_ARTIFACT_DIR']), { recursive: true, force: true });
    await mkdir(resolve(process.env['PZS005_ARTIFACT_DIR']), { recursive: true });
  }
  await mkdir(reportDirectory, { recursive: true });
  await mkdir(rawDirectory, { recursive: true });
  await writeFile(clockFilePath, String(Date.now()));
  const consoleOutput = { value: '' };
  const rawConsoleOutput = { value: '' };

  const server = spawn(process.execPath, [serverEntryPoint], {
    detached: true,
    env: {
      ...process.env,
      COOKIE_SECURE: 'false',
      DATABASE_AUTO_MIGRATE: 'true',
      DATABASE_DRIVER:
        process.env['OPAQUE_SYNC_STORAGE'] === 'durable' && process.env['DATABASE_DRIVER'] === 'pg' ? 'pg' : 'memory',
      ENABLE_TEST_API: 'true',
      HOST: host,
      GATEWAY_PORT: String(port),
      MAIL_TRANSPORT: 'memory',
      NG_ALLOWED_HOSTS: host,
      NODE_ENV: 'test',
      OPAQUE_SYNC_STORAGE: process.env['OPAQUE_SYNC_STORAGE'] ?? 'memory',
      PIN_RESEND_COOLDOWN_SECONDS: phases.includes('fuzzing') ? '0' : process.env['PIN_RESEND_COOLDOWN_SECONDS'],
      PORT: String(port),
      SESSION_SECRET: 'themis-api-openapi-e2e-secret',
      WEBAUTHN_ORIGIN: baseUrl,
      WEBAUTHN_RP_ID: host,
      PASSKEY_E2E_CLOCK_FILE: clockFilePath,
      PASSKEY_E2E_CLOCK_ADVANCE_FILE: clockAdvanceFilePath,
      PASSKEY_E2E_CLOCK_STEP_MS: '2000',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${clockPreloadPath}`.trim(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (server.stdout) captureOutput(server.stdout, consoleOutput, rawConsoleOutput);
  if (server.stderr) captureOutput(server.stderr, consoleOutput, rawConsoleOutput);

  if (server.pid == null) {
    throw new Error('Failed to start composition server for OpenAPI contract tests.');
  }

  activeServerPid = server.pid;
  await writeFile(pidPath, String(server.pid));

  try {
    await waitForPortOpen(port, { host });
    await waitForHealth(baseUrl);
    const fixture = await bootstrapSession();

    if (!syncOnly && !passkeyOnly) {
      await verifyFixtureBoundary(fixture);
    }
    if (!passkeyOnly) await verifySyncEvidence(fixture);
    if (!syncOnly) await verifyPasskeySmoke(fixture);
    const fixtureSchema = await prepareSchema(fixture);

    const result = await new Promise<number>((resolveResult, reject) => {
      const contract = spawn(
        'uvx',
        [
          '--from',
          'schemathesis==4.24.3',
          '--with',
          'jsonschema-rs==0.49.1',
          'schemathesis',
          'run',
          fixtureSchema,
          '--url',
          apiUrl,
          '--header',
          `Cookie: ${fixture.cookie}`,
          '--header',
          `Origin: ${origin}`,
          '--exclude-path-regex',
          '^/test/',
          '--phases',
          phases,
          '--workers',
          '1',
          '--mode',
          generationMode,
          ...(generationMode === 'negative' ? ['--exclude-checks', 'positive_data_acceptance'] : []),
          '--generation-deterministic',
          '--seed',
          '20260818',
          '--max-examples',
          '5',
          '--max-failures',
          '20',
          '--request-timeout',
          '5',
          '--max-response-time',
          '5',
          '--continue-on-failure',
          '--report',
          'junit,har',
          '--report-dir',
          reportDirectory,
          '--output-sanitize',
          'true',
          '--wait-for-schema',
          '30',
          ...(includePathRegex ? ['--include-path-regex', includePathRegex] : []),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      if (contract.stdout) captureOutput(contract.stdout, consoleOutput);
      if (contract.stderr) captureOutput(contract.stderr, consoleOutput);

      contract.once('error', reject);

      contract.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`Schemathesis exited due to signal ${signal}.`));

          return;
        }

        resolveResult(code ?? 1);
      });
    });

    return result;
  } finally {
    stopServer(server.pid);
    activeServerPid = undefined;
    await writeFile(resolve(rawDirectory, 'server.log'), rawConsoleOutput.value);
    await writeFile(resolve(rawDirectory, 'http-responses.json'), JSON.stringify(rawHttpObservations, null, 2));
    const artifactRawDirectory = process.env['PZS005_ARTIFACT_DIR']
      ? resolve(process.env['PZS005_ARTIFACT_DIR'], 'openapi-report/raw')
      : rawDirectory;

    if (artifactRawDirectory !== rawDirectory) {
      await rm(resolve(process.env['PZS005_ARTIFACT_DIR']!, 'openapi-report'), { recursive: true, force: true });
      await mkdir(artifactRawDirectory, { recursive: true });
      await cp(rawDirectory, artifactRawDirectory, { recursive: true });
    }
    const rawScanDirectory = artifactRawDirectory;
    const rawScan = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/operational-workspace-security-scan.ts', rawScanDirectory],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    await writeFile(
      resolve(reportDirectory, 'raw-scan-result.json'),
      JSON.stringify(
        {
          command: `node --experimental-strip-types scripts/operational-workspace-security-scan.ts ${rawScanDirectory}`,
          status: rawScan.status,
          stdout: rawScan.stdout,
          stderr: rawScan.stderr,
        },
        null,
        2,
      ),
    );
    if (rawScan.status !== 0) {
      console.error(`Raw operational workspace security scan failed: ${rawScan.stderr}`);
      process.exitCode = 1;
    }
    await writeFile(resolve(reportDirectory, 'console.log'), consoleOutput.value);
    const warningLines = consoleOutput.value
      .split('\n')
      .map((line) => sanitizeText(line))
      .filter((line) => /Authentication failed:|Schema validation mismatch:/i.test(line));

    await writeFile(
      resolve(reportDirectory, 'openapi-warning-disposition.json'),
      JSON.stringify(
        {
          runId,
          scope: includePathRegex ?? 'all OpenAPI paths',
          warnings: warningLines.map((line) => ({
            observed: line,
            disposition: /authentication/i.test(line) ? 'blocked-authentication-warning' : 'blocked-schema-warning',
            reason:
              "The warning is current-run OpenAPI output for this run and scope; the warning is not converted into a pass. Authenticated transport evidence is retained only in this run's artifacts.",
          })),
        },
        null,
        2,
      ),
    );
    await sanitizeReports();
    await cp(reportDirectory, stableReportDirectory, { recursive: true });
    if (process.env['PZS005_ARTIFACT_DIR']) {
      const artifactReportDirectory = resolve(process.env['PZS005_ARTIFACT_DIR'], 'openapi-report');

      await rm(artifactReportDirectory, { recursive: true, force: true });
      await cp(reportDirectory, artifactReportDirectory, { recursive: true });
    }
    await rm(pidPath, { force: true });
    await rm(clockFilePath, { force: true });
  }
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) });

      if (response.ok) return;
    } catch {
      // A listener can accept TCP before the gateway is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Gateway health check did not become ready at ${baseUrl}/healthz.`);
}

async function handleSignal(code: number): Promise<void> {
  if (activeServerPid !== undefined) stopServer(activeServerPid);
  await rm(pidPath, { force: true });
  process.exit(code);
}

process.once('SIGINT', () => void handleSignal(130));
process.once('SIGTERM', () => void handleSignal(143));

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(sanitizeText(String(error)));
    process.exitCode = 1;
  });
