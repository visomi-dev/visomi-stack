import { createHash, createHmac, sign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { syncCaseObservations, runId, reportDirectory, apiUrl } from './openapi-contract-context.ts';
import type { Fixture, HttpObservation, JsonRecord } from './openapi-contract-context.ts';
import { requestObservation, responseCode, envelope, requestJson, canonicalize } from './openapi-contract-http.ts';
import { sanitizeJson } from './report-sanitization.ts';

export async function verifySyncEvidence(fixture: Fixture): Promise<void> {
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

export function claim(fixture: Fixture, profile: 'web-webcrypto' | 'web-local-agent'): JsonRecord {
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
