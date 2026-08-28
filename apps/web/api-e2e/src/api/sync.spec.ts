import axios from 'axios';

const password = 'S3cureAuth!';

const cookieHeader = (setCookie: string[] | undefined) =>
  setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';

const envelope = (
  workspaceId: string,
  envelopeId: string,
  revision: number,
  tombstone = false,
  recipientDeviceId?: string,
) => ({
  format: 'themis.encrypted-envelope',
  version: 1,
  kind: 'sync-object',
  envelopeId,
  workspaceId,
  recordType: tombstone ? 'tombstone' : 'project-context',
  revision,
  createdAt: '2026-08-20T00:00:00.000Z',
  associatedData: { purpose: 'sync' },
  metadata: recipientDeviceId ? { recipientDeviceId } : tombstone ? { deletedRecordId: 'record-1' } : {},
  nonce: `bm9uY2Ut${envelopeId}`,
  ciphertext: `c3ludGhlc2lzL${envelopeId}`,
  authTag: `dGFnL${envelopeId}`,
});

async function session(suffix: string): Promise<{
  cookie: string;
  accountId: string;
  workspaceId: string;
  deviceId: string;
  ownerDeviceId: string;
}> {
  const email = `sync-${suffix}-${Date.now()}@themis.dev`;
  const authenticated = await axios.post('/test/auth/session', { email, password });
  const cookie = cookieHeader(authenticated.headers['set-cookie']);
  const accountId = authenticated.data?.data?.accountId as string;
  const headers = { headers: { Cookie: cookie } };
  const project = await axios.post('/projects', { name: `Sync ${suffix}`, sourceType: 'manual' }, headers);
  const workspaceId = project.data.data.id as string;
  const ownerDevice = await axios.post(
    `/sync/${workspaceId}/devices`,
    { publicKey: `fixture-owner-public-${suffix}`, label: `Sync ${suffix} owner` },
    headers,
  );
  const ownerDeviceId = ownerDevice.data.data.deviceId as string;

  await axios.post(
    `/sync/${workspaceId}/devices/${ownerDeviceId}/approval`,
    { approverDeviceId: ownerDeviceId },
    headers,
  );
  const device = await axios.post(
    `/sync/${workspaceId}/devices`,
    { publicKey: `fixture-public-${suffix}`, label: `Sync ${suffix}` },
    headers,
  );
  const deviceId = device.data.data.deviceId as string;

  await axios.post(
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

  return { accountId, cookie, workspaceId, deviceId, ownerDeviceId };
}

async function sameWorkspaceMember(owner: Awaited<ReturnType<typeof session>>, suffix: string) {
  const email = `sync-member-${suffix}-${Date.now()}@themis.dev`;
  const authenticated = await axios.post('/test/auth/session', { email, password, accountId: owner.accountId });
  const cookie = cookieHeader(authenticated.headers['set-cookie']);
  const headers = { headers: { Cookie: cookie } };
  const device = await axios.post(
    `/sync/${owner.workspaceId}/devices`,
    { publicKey: `fixture-member-public-${suffix}`, label: `Sync member ${suffix}` },
    headers,
  );
  const deviceId = device.data.data.deviceId as string;

  await axios.post(
    `/sync/${owner.workspaceId}/devices/${deviceId}/enroll`,
    {
      approverDeviceId: owner.ownerDeviceId,
      envelope: {
        ...envelope(owner.workspaceId, `member-key-${suffix}`, 1),
        recordType: 'workspace-key-distribution',
        metadata: { recipientDeviceId: deviceId },
      },
    },
    { headers: { Cookie: owner.cookie } },
  );

  return { cookie, deviceId };
}

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

  it('rejects revoked and stale devices, completes recovery, and prevents rollback after tombstoning', async () => {
    const owner = await session('lifecycle');
    const headers = { headers: { Cookie: owner.cookie }, validateStatus: () => true };
    const replacement = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: `fixture-replacement-${Date.now()}`, label: 'Replacement device' },
      headers,
    );
    const replacementDeviceId = replacement.data.data.deviceId as string;

    const revoked = await axios.post(`/sync/${owner.workspaceId}/devices/${owner.deviceId}/revoke`, undefined, headers);

    expect(revoked.status).toBe(200);

    const staleFetch = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...headers,
      params: { deviceId: owner.deviceId, enrollmentVersion: 1 },
    });

    expect(staleFetch.status).toBe(409);
    expect(staleFetch.data.message).toContain('revoked or stale');

    const quorumDevice = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: `fixture-quorum-${Date.now()}`, label: 'Recovery quorum device' },
      headers,
    );
    const quorumDeviceId = quorumDevice.data.data.deviceId as string;

    await axios.post(
      `/sync/${owner.workspaceId}/devices/${quorumDeviceId}/enroll`,
      {
        approverDeviceId: owner.ownerDeviceId,
        envelope: {
          ...envelope(owner.workspaceId, 'quorum-key', 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: quorumDeviceId },
        },
      },
      headers,
    );
    const recovered = await axios.post(
      `/sync/${owner.workspaceId}/devices/recover`,
      {
        lostDeviceId: owner.deviceId,
        replacementDeviceId,
        approverDeviceIds: [quorumDeviceId, owner.ownerDeviceId],
        allDeviceLoss: false,
        envelope: {
          ...envelope(owner.workspaceId, 'recovery-key', 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: replacementDeviceId },
        },
      },
      headers,
    );

    expect(recovered.status).toBe(200);
    const replacementVersion = recovered.data.data.enrollmentVersion as number;

    const tombstone = envelope(owner.workspaceId, 'rollback-record', 2, true);

    expect(
      (
        await axios.post(
          `/sync/${owner.workspaceId}/envelopes`,
          {
            envelope: tombstone,
            deviceId: replacementDeviceId,
            enrollmentVersion: replacementVersion,
          },
          headers,
        )
      ).status,
    ).toBe(201);

    const rollback = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: envelope(owner.workspaceId, 'rollback-record', 1),
        deviceId: replacementDeviceId,
        enrollmentVersion: replacementVersion,
      },
      headers,
    );

    expect(rollback.status).toBe(409);
    expect(JSON.stringify(rollback.data)).not.toContain('rollback-record');

    await axios.post(`/sync/${owner.workspaceId}/devices/${owner.ownerDeviceId}/revoke`, undefined, headers);
    await axios.post(`/sync/${owner.workspaceId}/devices/${quorumDeviceId}/revoke`, undefined, headers);
    await axios.post(`/sync/${owner.workspaceId}/devices/${replacementDeviceId}/revoke`, undefined, headers);
    const allLossReplacement = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: `fixture-all-loss-${Date.now()}`, label: 'All-device-loss replacement' },
      headers,
    );
    const allLossReplacementId = allLossReplacement.data.data.deviceId as string;
    const allLoss = await axios.post(
      `/sync/${owner.workspaceId}/devices/recover`,
      {
        lostDeviceId: replacementDeviceId,
        replacementDeviceId: allLossReplacementId,
        approverDeviceIds: [owner.ownerDeviceId, quorumDeviceId],
        allDeviceLoss: true,
        envelope: {
          ...envelope(owner.workspaceId, 'all-device-loss-key', 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: allLossReplacementId },
        },
      },
      headers,
    );

    expect(allLoss.status).toBe(200);
    const allLossVersion = allLoss.data.data.enrollmentVersion as number;

    expect(allLossVersion).toBeGreaterThan(replacementVersion);

    const postLossApprover = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: `fixture-post-loss-approver-${Date.now()}`, label: 'Post-loss approver' },
      headers,
    );
    const postLossApproverId = postLossApprover.data.data.deviceId as string;
    const postLossApproverGrant = await axios.post(
      `/sync/${owner.workspaceId}/devices/${postLossApproverId}/enroll`,
      {
        approverDeviceId: allLossReplacementId,
        envelope: {
          ...envelope(owner.workspaceId, 'post-loss-approver-key', 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: postLossApproverId },
        },
      },
      headers,
    );

    expect(postLossApproverGrant.status).toBe(200);
    const postLossDevice = await axios.post(
      `/sync/${owner.workspaceId}/devices`,
      { publicKey: `fixture-post-loss-device-${Date.now()}`, label: 'Post-loss re-enrollment' },
      headers,
    );
    const postLossDeviceId = postLossDevice.data.data.deviceId as string;
    const reEnrollment = await axios.post(
      `/sync/${owner.workspaceId}/devices/recover`,
      {
        lostDeviceId: replacementDeviceId,
        replacementDeviceId: postLossDeviceId,
        approverDeviceIds: [allLossReplacementId, postLossApproverId],
        allDeviceLoss: false,
        envelope: {
          ...envelope(owner.workspaceId, 'post-loss-re-enrollment-key', 1),
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: postLossDeviceId },
        },
      },
      headers,
    );

    expect(reEnrollment.status).toBe(200);
    expect(reEnrollment.data.data.enrollmentVersion).toBeGreaterThan(allLossVersion);

    const validReEnrollmentAppend = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: envelope(owner.workspaceId, 'post-loss-valid-record', 3),
        deviceId: postLossDeviceId,
        enrollmentVersion: reEnrollment.data.data.enrollmentVersion,
      },
      headers,
    );

    expect(validReEnrollmentAppend.status).toBe(201);

    const staleAfterAllLoss = await axios.get(`/sync/${owner.workspaceId}/envelopes`, {
      ...headers,
      params: { deviceId: replacementDeviceId, enrollmentVersion: replacementVersion },
    });

    expect(staleAfterAllLoss.status).toBe(409);
    expect(staleAfterAllLoss.data.message).toContain('revoked or stale');

    const staleAppendAfterAllLoss = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: envelope(owner.workspaceId, 'stale-prior-device-record', 1),
        deviceId: replacementDeviceId,
        enrollmentVersion: replacementVersion,
      },
      headers,
    );

    expect(staleAppendAfterAllLoss.status).toBe(409);
    expect(JSON.stringify(staleAppendAfterAllLoss.data)).not.toContain('stale-prior-device-record');
  }, 30_000);

  it('returns safe conflict results for stale bases and unusable cursors', async () => {
    const owner = await session('cursor-recovery');
    const headers = { headers: { Cookie: owner.cookie }, validateStatus: () => true };
    const first = envelope(owner.workspaceId, 'cursor-first', 1);

    expect(
      (
        await axios.post(
          `/sync/${owner.workspaceId}/envelopes`,
          {
            envelope: first,
            deviceId: owner.deviceId,
            enrollmentVersion: 1,
          },
          headers,
        )
      ).status,
    ).toBe(201);

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
