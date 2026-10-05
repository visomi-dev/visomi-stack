import axios from 'axios';

import { cookieHeader, envelope, password, sameWorkspaceMember, session } from '../support/sync-fixture';

describe('opaque sync HTTP boundary', () => {
  it('requires owner approval and owner enrollment before single-approver device enrollment', async () => {
    const suffix = `owner-lifecycle-${Date.now()}`;
    const email = `sync-${suffix}@themis.dev`;
    const authenticated = await axios.post('/test/auth/session', { email, password });
    const cookie = cookieHeader(authenticated.headers['set-cookie']);
    const headers = { headers: { Cookie: cookie } };
    const project = await axios.post('/projects', { name: `Sync ${suffix}`, sourceType: 'manual' }, headers);
    const workspaceId = project.data.data.id as string;
    const owner = await axios.post(
      `/sync/${workspaceId}/devices`,
      { publicKey: `fixture-owner-public-${suffix}`, label: `Sync ${suffix} owner` },
      headers,
    );
    const ownerDeviceId = owner.data.data.deviceId as string;

    const approval = await axios.post(
      `/sync/${workspaceId}/devices/${ownerDeviceId}/approval`,
      { approverDeviceId: ownerDeviceId },
      headers,
    );

    expect(approval.status).toBe(200);

    const enrollment = await axios.post(
      `/sync/${workspaceId}/devices/${ownerDeviceId}/enroll`,
      {
        approverDeviceId: ownerDeviceId,
        envelope: {
          ...envelope(workspaceId, `owner-key-${suffix}`, 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: ownerDeviceId },
        },
      },
      headers,
    );

    expect(enrollment.status).toBe(200);

    const device = await axios.post(
      `/sync/${workspaceId}/devices`,
      { publicKey: `fixture-public-${suffix}`, label: `Sync ${suffix}` },
      headers,
    );
    const deviceId = device.data.data.deviceId as string;

    const secondEnrollment = await axios.post(
      `/sync/${workspaceId}/devices/${deviceId}/enroll`,
      {
        approverDeviceId: ownerDeviceId,
        envelope: {
          ...envelope(workspaceId, `workspace-key-${suffix}`, 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: deviceId },
        },
      },
      headers,
    );

    expect(secondEnrollment.status).toBe(200);
  });

  it('shares one workspace between two authenticated users and two devices', async () => {
    const owner = await session('shared-owner');
    const member = await sameWorkspaceMember(owner, 'shared-member');
    const ownerHeaders = { headers: { Cookie: owner.cookie }, validateStatus: () => true };
    const memberHeaders = { headers: { Cookie: member.cookie }, validateStatus: () => true };
    const sharedEnvelope = envelope(owner.workspaceId, 'shared-user-record', 1);

    const ownerAppend = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: sharedEnvelope, deviceId: owner.deviceId, enrollmentVersion: 1 },
      ownerHeaders,
    );
    const memberFetch = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...memberHeaders,
      params: { deviceId: member.deviceId, enrollmentVersion: 2 },
    });

    expect(ownerAppend.status).toBe(201);
    expect(memberFetch.status).toBe(200);
    expect(memberFetch.data.data.envelopes[0].envelope.envelopeId).toBe(sharedEnvelope.envelopeId);
    expect(JSON.stringify(memberFetch.data)).not.toContain('project plaintext');
  }, 30_000);

  it('supports append, fetch, cursor pagination, queue flush, tombstones, reconnect, and authorization', async () => {
    const owner = await session('owner');
    const other = await session('other');
    const ownerHeaders = {
      headers: { Cookie: owner.cookie },
      validateStatus: () => true,
    };
    const otherHeaders = { headers: { Cookie: other.cookie }, validateStatus: () => true };
    const syncHeaders = {
      ...ownerHeaders,
      headers: { Cookie: owner.cookie },
    };
    const queued = envelope(owner.workspaceId, 'queued-1', 1);
    const flushed = envelope(owner.workspaceId, 'flushed-1', 2);
    const tombstone = envelope(owner.workspaceId, 'deleted-1', 3, true);

    const append = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: queued, deviceId: owner.deviceId, enrollmentVersion: 1 },
      syncHeaders,
    );

    expect(append.status).toBe(201);
    expect(append.data.data.envelope.ciphertext).toBe(queued.ciphertext);

    const duplicate = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: queued, deviceId: owner.deviceId, enrollmentVersion: 1 },
      syncHeaders,
    );

    expect(duplicate.status).toBe(200);
    expect(duplicate.data.data.duplicate).toBe(true);

    const flush = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: flushed, deviceId: owner.deviceId, enrollmentVersion: 1 },
      syncHeaders,
    );

    expect(flush.status).toBe(201);

    const page = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...ownerHeaders,
      params: { afterCursor: 0, limit: 1, deviceId: owner.deviceId, enrollmentVersion: 1 },
    });

    expect(page.data.data.envelopes).toHaveLength(1);
    const cursor = page.data.data.envelopes[0].cursor as number;

    const afterCursor = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...ownerHeaders,
      params: { afterCursor: cursor, limit: 100, deviceId: owner.deviceId, enrollmentVersion: 1 },
    });

    expect(afterCursor.data.data.envelopes[0].envelope.envelopeId).toBe('flushed-1');

    const deleteAppend = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: tombstone, deviceId: owner.deviceId, enrollmentVersion: 1 },
      syncHeaders,
    );

    expect(deleteAppend.status).toBe(201);
    const reconnect = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...ownerHeaders,
      params: { afterCursor: 0, limit: 100, deviceId: owner.deviceId, enrollmentVersion: 1 },
    });

    expect(
      reconnect.data.data.envelopes.map((item: { envelope: { envelopeId: string } }) => item.envelope.envelopeId),
    ).toContain('deleted-1');
    expect(JSON.stringify(reconnect.data)).not.toContain('project plaintext');

    const unauthorized = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...otherHeaders,
      params: { deviceId: other.deviceId, enrollmentVersion: 1 },
    });

    expect(unauthorized.status).toBe(404);
    expect(JSON.stringify(unauthorized.data)).not.toContain(queued.ciphertext);
  }, 30_000);

  it('returns safe conflict results for stale bases and unusable cursors', async () => {
    const owner = await session('cursor-recovery');
    const headers = { headers: { Cookie: owner.cookie }, validateStatus: () => true };
    const first = envelope(owner.workspaceId, 'cursor-first', 1);

    const firstAppend = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: first,
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(firstAppend.status).toBe(201);

    const staleBase = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: { ...envelope(owner.workspaceId, 'cursor-stale', 2), metadata: { baseCursor: '0' } },
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(staleBase.status).toBe(409);
    expect(staleBase.data.code).toBe('opaque_envelope_rejected');
    expect(staleBase.data.data).toBeUndefined();

    const unusableCursor = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...headers,
      params: { afterCursor: 999_999, limit: 100, deviceId: owner.deviceId, enrollmentVersion: 1 },
    });

    expect(unusableCursor.status).toBe(409);
    expect(unusableCursor.data.code).toBe('cursor_recovery_required');
    expect(unusableCursor.data.data).toBeUndefined();
  }, 30_000);

  it('maps stream barriers, checkpoint authorization, and bounded recovery to HTTP responses', async () => {
    const owner = await session('http-matrix');
    const other = await session('http-matrix-other');
    const headers = { headers: { Cookie: owner.cookie }, validateStatus: () => true };
    const streamOne = envelope(owner.workspaceId, 'http-stream-1', 1);
    const streamTwo = envelope(owner.workspaceId, 'http-stream-2', 2);

    const first = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: streamOne, deviceId: owner.deviceId, enrollmentVersion: 1 },
      headers,
    );
    const second = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: streamTwo, deviceId: owner.deviceId, enrollmentVersion: 1 },
      headers,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const staleBase = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: { ...envelope(owner.workspaceId, 'http-stale-base', 3), metadata: { baseCursor: '1' } },
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(staleBase.status).toBe(409);
    expect(staleBase.data.code).toBe('opaque_envelope_rejected');

    const rollback = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: envelope(owner.workspaceId, 'http-rollback', 2),
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(rollback.status).toBe(409);
    expect(rollback.data.code).toBe('opaque_envelope_rejected');

    const unauthorizedCheckpoint = await axios.post(
      `/sync/${owner.workspaceId}/checkpoints`,
      {
        checkpointId: 'http-checkpoint-unauthorized',
        cursor: first.data.data.cursor,
        revision: 1,
        envelope: streamOne,
        deviceId: other.deviceId,
        enrollmentVersion: 1,
      },
      { headers: { Cookie: other.cookie }, validateStatus: () => true },
    );

    expect(unauthorizedCheckpoint.status).toBe(404);
    expect(unauthorizedCheckpoint.data.code).toBe('workspace_not_found');

    const checkpoint = await axios.post(
      `/sync/${owner.workspaceId}/checkpoints`,
      {
        checkpointId: 'http-checkpoint-1',
        cursor: first.data.data.cursor,
        revision: 1,
        envelope: streamOne,
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(checkpoint.status).toBe(201);

    const mismatchedCheckpoint = await axios.post(
      `/sync/${owner.workspaceId}/checkpoints`,
      {
        checkpointId: 'http-checkpoint-mismatch',
        cursor: first.data.data.cursor,
        revision: 1,
        envelope: envelope(owner.workspaceId, 'http-different-envelope', 1),
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(mismatchedCheckpoint.status).toBe(409);
    expect(mismatchedCheckpoint.data.code).toBe('checkpoint_rejected');

    const recovery = await axios.get(`/sync/${owner.workspaceId}/recovery`, {
      ...headers,
      params: {
        checkpointId: 'http-checkpoint-1',
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
        afterCursor: 0,
        limit: 1,
      },
    });

    expect(recovery.status).toBe(200);
    expect(recovery.data.data.checkpoint.cursor).toBe(first.data.data.cursor);
    expect(recovery.data.data.envelopes).toHaveLength(1);
    expect(recovery.data.data.envelopes[0].cursor).toBe(second.data.data.cursor);

    const missingCheckpoint = await axios.get(`/sync/${owner.workspaceId}/recovery`, {
      ...headers,
      params: { checkpointId: 'http-checkpoint-missing', deviceId: owner.deviceId, enrollmentVersion: 1 },
    });

    expect(missingCheckpoint.status).toBe(409);
    expect(missingCheckpoint.data.code).toBe('recovery_chain_unavailable');

    const malformed = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      { envelope: { ...streamOne, version: 999 }, deviceId: owner.deviceId, enrollmentVersion: 1 },
      headers,
    );

    expect(malformed.status).toBe(400);
    expect(malformed.data.code).toBe('invalid_request');

    const oversized = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: { ...streamOne, envelopeId: 'http-oversized', ciphertext: 'x'.repeat(100_001) },
        deviceId: owner.deviceId,
        enrollmentVersion: 1,
      },
      headers,
    );

    expect(oversized.status).toBe(400);
    expect(oversized.data.code).toBe('invalid_request');
  }, 30_000);
});
