import axios from 'axios';

import { envelope, session } from '../support/sync-fixture';

describe('opaque sync device lifecycle HTTP boundary', () => {
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
    const tombstoneAppend = await axios.post(
      `/sync/${owner.workspaceId}/envelopes`,
      {
        envelope: tombstone,
        deviceId: replacementDeviceId,
        enrollmentVersion: replacementVersion,
      },
      headers,
    );

    expect(tombstoneAppend.status).toBe(201);

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
});
