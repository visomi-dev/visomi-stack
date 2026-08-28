import express, { json, type Request } from 'express';
import request from 'supertest';

import { opaqueSyncRouter } from './opaque-sync-router';

import { deviceIdentityStore, errorHandler, opaqueSyncStore } from 'shared';

jest.mock('projects', () => ({
  getProject: jest.fn(async (context: { accountId: string }, projectId: string) =>
    projectId === 'workspace-a' && context.accountId === 'account-a' ? { id: projectId } : null,
  ),
}));

function createEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    format: 'themis.encrypted-envelope',
    version: 1,
    kind: 'sync-object',
    envelopeId: 'envelope-1',
    workspaceId: 'workspace-a',
    recordType: 'project-context',
    revision: 1,
    createdAt: '2026-08-17T22:00:00.000Z',
    associatedData: { purpose: 'sync' },
    metadata: { source: 'agent' },
    nonce: 'bm9uY2U',
    ciphertext: 'c2VjcmV0LWNpcGhlcnRleHQ',
    authTag: 'dGFn',
    ...overrides,
  };
}

function createApp(accountId = 'account-a') {
  const app = express();

  app.use(json());
  app.use((req: Request, _res, next) => {
    req.user = { id: 'user-1', accountId, role: 'owner' } as Express.User;
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
    next();
  });
  app.use('/sync', opaqueSyncRouter);
  app.use(errorHandler);

  return app;
}

describe('opaque sync API', () => {
  let deviceId = '';
  let enrollmentVersion = 0;

  beforeEach(() => {
    opaqueSyncStore.clear();
    deviceIdentityStore.clear();
    const owner = deviceIdentityStore.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const device = deviceIdentityStore.createIdentity('account-a', 'device-key');

    deviceIdentityStore.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    const grant = deviceIdentityStore.enrollDevice('account-a', device.deviceId, 'workspace-a', owner.deviceId, {
      ...createEnvelope({ envelopeId: 'key-device', recordType: 'workspace-key-distribution' }),
      metadata: { recipientDeviceId: device.deviceId },
    });

    deviceId = device.deviceId;
    enrollmentVersion = grant.enrollmentVersion;
  });

  it('round-trips opaque ciphertext and preserves client conflict inputs', async () => {
    const envelope = createEnvelope({ associatedData: { conflict: 'keep-local' }, metadata: { branch: 'local' } });

    const appendResponse = await request(createApp())
      .post('/sync/workspace-a/envelopes')
      .send({ envelope, deviceId, enrollmentVersion });
    const listResponse = await request(createApp())
      .get('/sync/workspace-a/envelopes')
      .query({ deviceId, enrollmentVersion });

    expect(appendResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.envelopes).toEqual([{ cursor: 1, envelope }]);
  });

  it('rejects malformed, replayed, and duplicate envelopes at the API boundary', async () => {
    const app = createApp();
    const envelope = createEnvelope();

    expect(
      (await request(app).post('/sync/workspace-a/envelopes').send({ envelope, deviceId, enrollmentVersion })).status,
    ).toBe(201);
    expect(
      (await request(app).post('/sync/workspace-a/envelopes').send({ envelope, deviceId, enrollmentVersion })).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/sync/workspace-a/envelopes')
          .send({ envelope: { ...envelope, revision: 1, ciphertext: 'cmVwbGF5' }, deviceId, enrollmentVersion })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post('/sync/workspace-a/envelopes')
          .send({ envelope: { ...envelope, envelopeId: 'bad', ciphertext: 'not valid!' }, deviceId, enrollmentVersion })
      ).status,
    ).toBe(400);
  });

  it('requires workspace authorization and isolates accounts without revealing ciphertext', async () => {
    const secret = 'do-not-log-this-ciphertext';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    const response = await request(createApp('account-b'))
      .post('/sync/workspace-a/envelopes')
      .send({ envelope: createEnvelope({ ciphertext: secret }), deviceId, enrollmentVersion });

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain(secret);

    const inaccessible = await request(createApp())
      .get('/sync/workspace-b/envelopes')
      .query({ deviceId, enrollmentVersion });

    expect(inaccessible.status).toBe(404);
    expect(JSON.stringify(inaccessible.body)).not.toContain('workspace-b');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(secret);

    errorSpy.mockRestore();
  });

  it('enforces device revocation at the HTTP sync boundary', async () => {
    deviceIdentityStore.revokeDevice('account-a', deviceId);
    const response = await request(createApp())
      .get('/sync/workspace-a/envelopes')
      .query({ deviceId, enrollmentVersion });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('revoked or stale');
  });

  it('stores a checkpoint and returns a bounded snapshot plus incremental recovery chain', async () => {
    const app = createApp();
    const first = createEnvelope({ envelopeId: 'recovery-first', revision: 1 });
    const second = createEnvelope({ envelopeId: 'recovery-second', revision: 2, metadata: { baseCursor: '1' } });

    expect(
      (await request(app).post('/sync/workspace-a/envelopes').send({ envelope: first, deviceId, enrollmentVersion }))
        .status,
    ).toBe(201);
    const checkpoint = await request(app).post('/sync/workspace-a/checkpoints').send({
      checkpointId: 'checkpoint-1',
      cursor: 1,
      revision: 1,
      envelope: first,
      deviceId,
      enrollmentVersion,
    });

    expect(checkpoint.status).toBe(201);
    expect(
      (await request(app).post('/sync/workspace-a/envelopes').send({ envelope: second, deviceId, enrollmentVersion }))
        .status,
    ).toBe(201);

    const recovery = await request(app).get('/sync/workspace-a/recovery').query({
      checkpointId: 'checkpoint-1',
      afterCursor: 1,
      limit: 1,
      deviceId,
      enrollmentVersion,
    });

    expect(recovery.status).toBe(200);
    expect(recovery.body.data.checkpoint.checkpointId).toBe('checkpoint-1');
    expect(recovery.body.data.envelopes).toEqual([{ cursor: 2, envelope: second }]);
  });

  it('covers the device lifecycle HTTP paths and keeps approval workspace-scoped', async () => {
    opaqueSyncStore.clear();
    deviceIdentityStore.clear();
    const app = createApp();
    const ownerResponse = await request(app)
      .post('/sync/workspace-a/devices')
      .send({ publicKey: 'http-owner-key', label: 'HTTP owner' });
    const replacementResponse = await request(app)
      .post('/sync/workspace-a/devices')
      .send({ publicKey: 'http-replacement-key', label: 'HTTP replacement' });
    const approverResponse = await request(app)
      .post('/sync/workspace-a/devices')
      .send({ publicKey: 'http-approver-key', label: 'HTTP approver' });
    const targetResponse = await request(app)
      .post('/sync/workspace-a/devices')
      .send({ publicKey: 'http-target-key', label: 'HTTP target' });
    const ownerId = ownerResponse.body.data.deviceId as string;
    const replacementId = replacementResponse.body.data.deviceId as string;
    const approverId = approverResponse.body.data.deviceId as string;
    const targetId = targetResponse.body.data.deviceId as string;

    expect(ownerResponse.status).toBe(200);
    expect(
      (await request(app).post(`/sync/workspace-a/devices/${deviceId}/approval`).send({ approverDeviceId: deviceId }))
        .status,
    ).toBe(409);
    expect(
      (await request(app).post(`/sync/workspace-a/devices/${ownerId}/approval`).send({ approverDeviceId: ownerId }))
        .status,
    ).toBe(200);

    const enrolled = await request(app)
      .post(`/sync/workspace-a/devices/${targetId}/enroll`)
      .send({
        approverDeviceId: ownerId,
        envelope: createEnvelope({
          envelopeId: 'http-key-target',
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: targetId },
        }),
      });

    expect(enrolled.status).toBe(200);
    const approverEnrollment = await request(app)
      .post(`/sync/workspace-a/devices/${approverId}/enroll`)
      .send({
        approverDeviceId: ownerId,
        envelope: createEnvelope({
          envelopeId: 'http-key-approver',
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: approverId },
        }),
      });

    expect(approverEnrollment.status).toBe(200);
    expect((await request(app).get('/sync/workspace-a/devices')).body.data.devices).toHaveLength(4);

    const auditResponse = await request(app).get('/sync/workspace-a/devices/audit');

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: targetId, kind: 'created', workspaceId: 'workspace-a' }),
        expect.objectContaining({ deviceId: targetId, kind: 'enrolled', workspaceId: 'workspace-a' }),
      ]),
    );

    expect((await request(app).post(`/sync/workspace-a/devices/${targetId}/revoke`)).status).toBe(200);

    const revokedAuditResponse = await request(app).get('/sync/workspace-a/devices/audit');

    expect(revokedAuditResponse.body.data.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: targetId, kind: 'revoked', workspaceId: 'workspace-a' }),
      ]),
    );

    const recovery = await request(app)
      .post('/sync/workspace-a/devices/recover')
      .send({
        lostDeviceId: targetId,
        replacementDeviceId: replacementId,
        approverDeviceIds: [ownerId, approverId],
        allDeviceLoss: false,
        envelope: createEnvelope({
          envelopeId: 'http-key-replacement',
          recordType: 'workspace-key-distribution',
          metadata: { recipientDeviceId: replacementId },
        }),
      });

    expect(recovery.status).toBe(200);
  });

  it('does not expose device audit events across workspaces or accounts', async () => {
    const accountResponse = await request(createApp('account-b')).get('/sync/workspace-a/devices/audit');

    expect(accountResponse.status).toBe(404);

    const workspaceResponse = await request(createApp()).get('/sync/workspace-b/devices/audit');

    expect(workspaceResponse.status).toBe(404);
    expect(JSON.stringify(workspaceResponse.body)).not.toContain('workspace-a');
  });
});
