import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import axios, { type AxiosRequestConfig } from 'axios';
import { Pool } from 'pg';

import {
  artifactDirectory,
  expectStatus,
  observe,
  runId,
  streamId,
  writeEvidenceReports,
} from '../support/pzs-005-evidence';

import { RailwayS3ObjectStore, sha256 } from 'shared';

const password = 'S3cureAuth!';

type Session = {
  accountId: string;
  cookie: string;
  workspaceId: string;
  deviceId: string;
  ownerDeviceId: string;
  enrollmentVersion: number;
};

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

    await expectStatus(
      observe('duplicate_200', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: { envelope: firstEnvelope, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
        ...headers,
      }),
      200,
    );
    await expectStatus(
      observe('duplicate_conflict', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: { ...firstEnvelope, ciphertext: 'ZGlmZmVyZW50', authTag: 'ZGlmZmVyZW50LXRhZw' },
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      409,
    );
    await expectStatus(
      observe('authorized_fetch', {
        method: 'GET',
        url: `/sync/${owner.workspaceId}/envelopes`,
        ...auth(owner, { deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
      }),
      200,
    );

    const secondProject = await axios.post(
      '/projects',
      { name: 'PZS-005 second project', sourceType: 'manual' },
      headers,
    );
    const secondWorkspaceId = secondProject.data.data.id as string;

    await expectStatus(
      observe('cross_project', {
        method: 'GET',
        url: `/sync/${secondWorkspaceId}/envelopes`,
        ...auth(owner, { deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
      }),
      409,
    );
    await expectStatus(
      observe('cross_tenant', {
        method: 'GET',
        url: `/sync/${other.workspaceId}/envelopes`,
        ...auth(owner, { deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
      }),
      404,
    );

    const revoked = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: 'pzs005-revoked', label: 'revoked' },
      headers,
    );
    const revokedDeviceId = revoked.data.data.deviceId as string;

    await axios.post(`/sync/${owner.workspaceId}/devices/${revokedDeviceId}/revoke`, undefined, headers);
    await expectStatus(
      observe('revoked_device', {
        method: 'GET',
        url: `/sync/${owner.workspaceId}/envelopes`,
        ...auth(owner, { deviceId: revokedDeviceId, enrollmentVersion: 1 }),
      }),
      409,
    );

    const unenrolled = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: 'pzs005-unenrolled', label: 'unenrolled' },
      headers,
    );

    await expectStatus(
      observe('unenrolled_device', {
        method: 'GET',
        url: `/sync/${owner.workspaceId}/envelopes`,
        ...auth(owner, { deviceId: unenrolled.data.data.deviceId, enrollmentVersion: 1 }),
      }),
      409,
    );
    await expectStatus(
      observe('malformed', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: { ...firstEnvelope, envelopeId: undefined },
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      400,
    );
    await expectStatus(
      observe('oversized', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: { ...firstEnvelope, envelopeId: 'oversized', ciphertext: 'x'.repeat(100001) },
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      400,
    );
    await expectStatus(
      observe('unsupported_version', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: { ...firstEnvelope, envelopeId: 'unsupported', version: 2 },
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      400,
    );
    await expectStatus(
      observe('stale_base_409', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: envelope(owner.workspaceId, 'stale-base', 2, { metadata: { baseCursor: '0' } }),
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      409,
    );
    await expectStatus(
      observe('rollback', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: envelope(owner.workspaceId, 'rollback', 1),
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      409,
    );

    const replayTarget = envelope(owner.workspaceId, 'replay-target', 5);
    const replaySeed = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: replayTarget, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
      headers,
    );

    expect(replaySeed.status).toBe(201);
    await expectStatus(
      observe('replay', {
        method: 'POST',
        url: `/sync/${owner.workspaceId}/envelopes`,
        data: {
          envelope: { ...replayTarget, revision: 1, ciphertext: 'replayed' },
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        },
        ...headers,
      }),
      409,
    );

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
    await expectStatus(
      observe('checkpoint_hash_mismatch', {
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
      }),
      409,
    );
    await expectStatus(
      observe('valid_recovery', {
        method: 'GET',
        url: `/sync/${owner.workspaceId}/recovery`,
        ...auth(owner, {
          checkpointId: 'checkpoint-1',
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
          afterCursor: 0,
          limit: 10,
        }),
      }),
      200,
    );
    await expectStatus(
      observe('missing_checkpoint', {
        method: 'GET',
        url: `/sync/${owner.workspaceId}/recovery`,
        ...auth(owner, {
          checkpointId: 'missing',
          deviceId: ownerDevice,
          enrollmentVersion: owner.enrollmentVersion,
        }),
      }),
      409,
    );

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
      await expectStatus(
        observe('pruned_cursor', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/envelopes`,
          ...auth(owner, { afterCursor: 0, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion }),
        }),
        409,
      );
      const tombstone = envelope(owner.workspaceId, 'tombstone-record', 6, { recordType: 'tombstone' });

      await expectStatus(
        observe('tombstone', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: { envelope: tombstone, deviceId: ownerDevice, enrollmentVersion: owner.enrollmentVersion },
          ...headers,
        }),
        201,
      );
      await expectStatus(
        observe('tombstone_resurrection', {
          method: 'POST',
          url: `/sync/${owner.workspaceId}/envelopes`,
          data: {
            envelope: { ...tombstone, revision: 1, recordType: 'project-context' },
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          },
          ...headers,
        }),
        409,
      );
      await expectStatus(
        observe('retention_boundary', {
          method: 'GET',
          url: `/sync/${owner.workspaceId}/envelopes`,
          ...auth(owner, {
            afterCursor: firstCursor,
            deviceId: ownerDevice,
            enrollmentVersion: owner.enrollmentVersion,
          }),
        }),
        200,
      );
      await expectStatus(
        observe('device_lifecycle', { method: 'GET', url: `/sync/${owner.workspaceId}/devices`, ...headers }),
        200,
      );

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

          if (bytes === undefined) {
            throw new Error(`MinIO object missing for ${row.object_key}.`);
          }

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

    await writeEvidenceReports();
  }, 300_000);
});
