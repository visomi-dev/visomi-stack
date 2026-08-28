import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import axios, { type AxiosRequestConfig } from 'axios';
import { Pool } from 'pg';

import { RailwayS3ObjectStore, sha256 } from 'shared';

const password = 'S3cureAuth!';
const runId = process.env['PZS005_RUN_ID'] ?? `RUN-${Date.now()}-${randomUUID()}`;
const artifactDirectory = resolve(
  process.env['PZS005_ARTIFACT_DIR'] ?? `docs/verification/pzs-005-${runId.toLowerCase()}`,
);
const streamId = `stream-${randomUUID()}`;

type Session = {
  accountId: string;
  cookie: string;
  workspaceId: string;
  deviceId: string;
  ownerDeviceId: string;
  enrollmentVersion: number;
};
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

function cookieHeader(setCookie: string[] | undefined): string {
  return setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';
}

function envelope(workspaceId: string, envelopeId: string, revision: number, overrides: Record<string, unknown> = {}) {
  return {
    format: 'themis.encrypted-envelope',
    version: 1,
    kind: 'sync-object',
    envelopeId,
    workspaceId,
    recordType: 'project-context',
    revision,
    createdAt: '2026-08-20T00:00:00.000Z',
    associatedData: { purpose: 'sync', streamId },
    metadata: {},
    nonce: `bm9uY2Ut${envelopeId}`,
    ciphertext: `c3ludGhlc2lzL${envelopeId}`,
    authTag: `dGFnL${envelopeId}`,
    ...overrides,
  };
}

async function createSession(suffix: string): Promise<Session> {
  const email = `pzs005-${suffix}-${Date.now()}@themis.dev`;
  const authenticated = await axios.post('/test/auth/session', { email, password });
  const cookie = cookieHeader(authenticated.headers['set-cookie']);
  const headers = { headers: { Cookie: cookie } };
  const project = await axios.post('/projects', { name: `PZS-005 ${suffix}`, sourceType: 'manual' }, headers);
  const workspaceId = project.data.data.id as string;
  const owner = await axios.post(
    `/sync/${workspaceId}/devices`,
    { publicKey: `pzs005-owner-${suffix}`, label: `PZS-005 owner ${suffix}` },
    headers,
  );
  const ownerDeviceId = owner.data.data.deviceId as string;

  const approval = await axios.post(
    `/sync/${workspaceId}/devices/${ownerDeviceId}/approval`,
    { approverDeviceId: ownerDeviceId },
    headers,
  );

  expect(approval.status).toBe(200);

  const ownerEnrollment = await axios.post(
    `/sync/${workspaceId}/devices/${ownerDeviceId}/enroll`,
    {
      approverDeviceId: ownerDeviceId,
      envelope: envelope(workspaceId, `owner-key-${suffix}`, 1, {
        recordType: 'workspace-key-distribution',
        metadata: { recipientDeviceId: ownerDeviceId },
      }),
    },
    headers,
  );

  expect(ownerEnrollment.status).toBe(200);

  const device = await axios.post(
    `/sync/${workspaceId}/devices`,
    { publicKey: `pzs005-device-${suffix}`, label: `PZS-005 device ${suffix}` },
    headers,
  );
  const deviceId = device.data.data.deviceId as string;

  const enrollment = await axios.post(
    `/sync/${workspaceId}/devices/${deviceId}/enroll`,
    {
      approverDeviceId: ownerDeviceId,
      envelope: envelope(workspaceId, `key-${suffix}`, 1, {
        recordType: 'workspace-key-distribution',
        metadata: { recipientDeviceId: deviceId },
      }),
    },
    headers,
  );

  expect(enrollment.status).toBe(200);

  const enrollmentVersion = enrollment.data.data.enrollmentVersion as number;

  return {
    accountId: authenticated.data.data.accountId as string,
    cookie,
    workspaceId,
    deviceId,
    ownerDeviceId,
    enrollmentVersion,
  };
}

async function observe(caseId: string, config: AxiosRequestConfig): Promise<Observation> {
  const response = await axios.request({
    ...config,
    headers: { ...(config.headers ?? {}), 'x-request-id': `${runId}-${caseId}` },
    validateStatus: () => true,
  });
  const requestUrl = new URL(response.config.url ?? '', response.config.baseURL ?? axios.defaults.baseURL);
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(response.config.params ?? {})) {
    if (value !== undefined) params.set(key, String(value));
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

function auth(session: Session, params?: Record<string, string | number>): AxiosRequestConfig {
  return { headers: { Cookie: session.cookie }, params };
}

describe('PZS-005 real durable HTTP evidence', () => {
  it('executes the complete 23-case matrix against one API/PG/MinIO run', async () => {
    const owner = await createSession('owner');
    const other = await createSession('other');
    const headers = { headers: { Cookie: owner.cookie } };
    const ownerDevice = owner.deviceId;
    const firstEnvelope = envelope(owner.workspaceId, 'authorized-append', 1);

    const append = await observe('authorized_append_201', {
      method: 'POST',
      url: `/sync/${owner.workspaceId}/envelopes`,
      data: { envelope: firstEnvelope, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
      ...headers,
    });

    expect(append.response.status).toBe(201);
    const firstCursor = Number((append.response.body as { data: { cursor: number } }).data.cursor);

    expect(
      (
        await observe('duplicate_200', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: { envelope: firstEnvelope, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
          ...headers,
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await observe('duplicate_conflict', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: { ...firstEnvelope, ciphertext: 'ZGlmZmVyZW50', authTag: 'ZGlmZmVyZW50LXRhZw' },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(409);
    expect(
      (
        await observe('authorized_fetch', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/envelopes`,
          ...auth(owner, { deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
        })
      ).response.status,
    ).toBe(200);

    const secondProject = await axios.post(
      '/projects',
      { name: 'PZS-005 second project', sourceType: 'manual' },
      headers,
    );
    const secondWorkspaceId = secondProject.data.data.id as string;

    expect(
      (
        await observe('cross_project', {
          method: 'GET',
          url: `/sync/${secondWorkspaceId}/envelopes`,
          ...auth(owner, { deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
        })
      ).response.status,
    ).toBe(409);
    expect(
      (
        await observe('cross_tenant', {
          method: 'GET',
          url: `/sync/${other.workspaceId}/envelopes`,
          ...auth(owner, { deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
        })
      ).response.status,
    ).toBe(404);

    const revoked = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: 'pzs005-revoked', label: 'revoked' },
      headers,
    );
    const revokedDeviceId = revoked.data.data.deviceId as string;

    await axios.post(`/sync/${owner.workspaceId}/devices/${revokedDeviceId}/revoke`, undefined, headers);
    expect(
      (
        await observe('revoked_device', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/envelopes`,
          ...auth(owner, { deviceId: revokedDeviceId, enrollmentVersion: 1 }),
        })
      ).response.status,
    ).toBe(409);

    const unenrolled = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: 'pzs005-unenrolled', label: 'unenrolled' },
      headers,
    );

    expect(
      (
        await observe('unenrolled_device', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/envelopes`,
          ...auth(owner, { deviceId: unenrolled.data.data.deviceId, enrollmentVersion: 1 }),
        })
      ).response.status,
    ).toBe(409);
    expect(
      (
        await observe('malformed', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: { ...firstEnvelope, envelopeId: undefined },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await observe('oversized', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: { ...firstEnvelope, envelopeId: 'oversized', ciphertext: 'x'.repeat(100001) },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await observe('unsupported_version', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: { ...firstEnvelope, envelopeId: 'unsupported', version: 2 },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await observe('stale_base_409', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: envelope(owner.workspaceId, 'stale-base', 2, { metadata: { baseCursor: '0' } }),
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(409);
    expect(
      (
        await observe('rollback', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: envelope(owner.workspaceId, 'rollback', 1),
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(409);

    const replayTarget = envelope(owner.workspaceId, 'replay-target', 5);
    const replaySeed = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: replayTarget, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
      headers,
    );

    expect(replaySeed.status).toBe(201);
    expect(
      (
        await observe('replay', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: { ...replayTarget, revision: 1, ciphertext: 'replayed' },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(409);

    const checkpoint = await observe('valid_checkpoint', {
      method: 'POST',
      url: `/sync/${owner.workspaceId}/checkpoints`,
      data: {
        checkpointId: 'checkpoint-1',
        cursor: firstCursor,
        revision: 1,
        envelope: firstEnvelope,
        deviceId: ownerDevice,
        enrollmentVersion: owner.enrollmentVersion,
      },
      ...headers,
    });

    expect(checkpoint.response.status).toBe(201);
    expect(
      (
        await observe('checkpoint_hash_mismatch', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/checkpoints`,
          data: {
            checkpointId: 'checkpoint-mismatch',
            cursor: firstCursor,
            revision: 1,
            envelope: { ...firstEnvelope, ciphertext: 'tampered' },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        })
      ).response.status,
    ).toBe(409);
    expect(
      (
        await observe('valid_recovery', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/recovery`,
          ...auth(owner, {
            checkpointId: 'checkpoint-1',
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
            afterCursor: 0,
            limit: 10,
          }),
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await observe('missing_checkpoint', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/recovery`,
          ...auth(owner, {
            checkpointId: 'missing',
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          }),
        })
      ).response.status,
    ).toBe(409);

    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const objects = new RailwayS3ObjectStore({
      endpoint: process.env['OPAQUE_SYNC_S3_ENDPOINT']!,
      bucket: process.env['OPAQUE_SYNC_S3_BUCKET']!,
      accessKey: process.env['OPAQUE_SYNC_S3_ACCESS_KEY']!,
      secretKey: process.env['OPAQUE_SYNC_S3_SECRET_KEY']!,
    });

    try {
      await pool.query(
        "UPDATE opaque_sync_envelopes SET expires_at = now() - interval '1 second' WHERE account_id = $1 AND workspace_id = $2 AND cursor = $3",
        [owner.accountId, owner.workspaceId, firstCursor],
      );
      expect(
        (
          await observe('pruned_cursor', {
            method: 'GET',
            url: `/sync/${owner.workspaceId}/envelopes`,
            ...auth(owner, { afterCursor: 0, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
          })
        ).response.status,
      ).toBe(409);
      const tombstone = envelope(owner.workspaceId, 'tombstone-record', 6, { recordType: 'tombstone' });

      expect(
        (
          await observe('tombstone', {
            method: 'POST',
            url: `/sync/${owner.workspaceId}/envelopes`,
            data: { envelope: tombstone, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
            ...headers,
          })
        ).response.status,
      ).toBe(201);
      expect(
        (
          await observe('tombstone_resurrection', {
            method: 'POST',
            url: `/sync/${owner.workspaceId}/envelopes`,
            data: {
              envelope: { ...tombstone, revision: 1, recordType: 'project-context' },
              deviceId: ownerDevice,
              enrollmentVersion: owner.enrollmentVersion,
            },
            ...headers,
          })
        ).response.status,
      ).toBe(409);
      expect(
        (
          await observe('retention_boundary', {
            method: 'GET',
            url: `/sync/${owner.workspaceId}/envelopes`,
            ...auth(owner, {
              afterCursor: firstCursor,
              deviceId: ownerDevice,
              enrollmentVersion: owner.enrollmentVersion,
            }),
          })
        ).response.status,
      ).toBe(200);
      expect(
        (await observe('device_lifecycle', { method: 'GET', url: `/sync/${owner.workspaceId}/devices`, ...headers }))
          .response.status,
      ).toBe(200);

      const rows = await pool.query(
        'SELECT workspace_id, envelope_id, revision, cursor, object_key, ciphertext_sha256, tombstoned_at FROM opaque_sync_envelopes WHERE account_id = $1 AND workspace_id = $2 ORDER BY cursor',
        [owner.accountId, owner.workspaceId],
      );
      const checkpoints = await pool.query(
        'SELECT checkpoint_id, cursor, revision, object_key, ciphertext_sha256, created_at FROM opaque_sync_checkpoints WHERE account_id = $1 AND workspace_id = $2 ORDER BY cursor',
        [owner.accountId, owner.workspaceId],
      );
      const objectRows = [...rows.rows, ...checkpoints.rows].filter(
        (row, index, all) => all.findIndex((candidate) => candidate.object_key === row.object_key) === index,
      );
      const objectsObserved = await Promise.all(
        objectRows.map(async (row: { object_key: string; ciphertext_sha256?: string }) => {
          const bytes = await objects.get(row.object_key);

          if (bytes === undefined) throw new Error(`MinIO object missing for ${row.object_key}.`);

          return {
            objectKey: row.object_key,
            bytes: bytes.length,
            sha256: sha256(bytes),
            postgresHash: row.ciphertext_sha256 ?? null,
            hashMatches: row.ciphertext_sha256 === undefined || sha256(bytes) === row.ciphertext_sha256,
          };
        }),
      );

      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(
        resolve(artifactDirectory, 'postgres-rows.json'),
        JSON.stringify({ runId, streamId, rows: rows.rows, checkpoints: checkpoints.rows }, null, 2),
      );
      await writeFile(
        resolve(artifactDirectory, 'minio-object.json'),
        JSON.stringify(
          {
            runId,
            streamId,
            objects: objectsObserved,
            checkpointReferences: checkpoints.rows.map((row) => ({
              checkpointId: row.checkpoint_id,
              cursor: row.cursor,
              revision: row.revision,
              objectKey: row.object_key,
              ciphertextSha256: row.ciphertext_sha256,
            })),
            hashMatches: objectsObserved.every((object) => object.hashMatches),
          },
          null,
          2,
        ),
      );
    } finally {
      await pool.end();
    }

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

      if (expectedCode !== undefined) expect(observation.response.code).toBe(expectedCode);
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
      ].map(
        async (name) =>
          `${name} ${createHash('sha256')
            .update(await readFile(resolve(artifactDirectory, name)))
            .digest('hex')}`,
      ),
    );

    await writeFile(resolve(artifactDirectory, 'artifact-hashes.txt'), hashes.join('\n') + '\n');
  }, 300_000);
});
