import { DeviceIdentityError, DeviceIdentityStore } from './device-identity';

const envelope = (deviceId: string, workspaceId = 'workspace-a') => ({
  associatedData: { purpose: 'workspace-key-distribution', workspace: workspaceId },
  authTag: 'tag',
  ciphertext: 'wrapped-workspace-key',
  createdAt: '2026-08-17T22:00:00.000Z',
  envelopeId: `key-${deviceId}`,
  format: 'themis.encrypted-envelope',
  kind: 'sync-object',
  metadata: { recipientDeviceId: deviceId },
  nonce: 'nonce',
  recordType: 'workspace-key-distribution',
  revision: 1,
  version: 1,
  workspaceId,
});

describe('DeviceIdentityStore', () => {
  it('creates and enrolls a device without exposing key material', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-public-key', 'Owner', new Date(), 'workspace-a');
    const device = store.createIdentity('account-a', 'device-public-key', 'Laptop');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    const grant = store.enrollDevice(
      'account-a',
      device.deviceId,
      'workspace-a',
      owner.deviceId,
      envelope(device.deviceId),
    );

    expect(store.listDevices('account-a')).toHaveLength(2);
    expect(grant.keyEnvelope.ciphertext).toBe('wrapped-workspace-key');
    expect(JSON.stringify(grant)).not.toContain('VMK');
    expect(store.auditEvents('account-a').map(({ kind }) => kind)).toEqual([
      'created',
      'created',
      'approved',
      'enrolled',
    ]);
  });

  it('rejects duplicate enrollment and wrong recipient identity', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const device = store.createIdentity('account-a', 'device-key');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);

    expect(() => store.createIdentity('account-a', 'device-key')).toThrow('already exists');
    store.enrollDevice('account-a', device.deviceId, 'workspace-a', owner.deviceId, envelope(device.deviceId));
    expect(() =>
      store.enrollDevice('account-a', device.deviceId, 'workspace-a', owner.deviceId, envelope(owner.deviceId)),
    ).toThrow(DeviceIdentityError);
  });

  it('requires approval scoped to the target workspace', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const device = store.createIdentity('account-a', 'device-key');

    expect(() =>
      store.enrollDevice('account-a', device.deviceId, 'workspace-a', owner.deviceId, envelope(device.deviceId)),
    ).toThrow('workspace-scoped approval');
    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    expect(() =>
      store.enrollDevice(
        'account-a',
        device.deviceId,
        'workspace-b',
        owner.deviceId,
        envelope(device.deviceId, 'workspace-b'),
      ),
    ).toThrow('workspace-scoped approval');
  });

  it('revokes a device and blocks new authorization', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const device = store.createIdentity('account-a', 'device-key');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    const grant = store.enrollDevice(
      'account-a',
      device.deviceId,
      'workspace-a',
      owner.deviceId,
      envelope(device.deviceId),
    );

    store.revokeDevice('account-a', device.deviceId);
    expect(store.listDevices('account-a').find(({ deviceId }) => deviceId === device.deviceId)?.status).toBe('revoked');
    expect(() => store.authorizeSync('account-a', device.deviceId, 'workspace-a', grant.enrollmentVersion)).toThrow(
      'revoked or stale',
    );
  });

  it('rejects stale enrollment versions without invalidating other active devices', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const first = store.createIdentity('account-a', 'first-key');
    const second = store.createIdentity('account-a', 'second-key');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    const firstGrant = store.enrollDevice(
      'account-a',
      first.deviceId,
      'workspace-a',
      owner.deviceId,
      envelope(first.deviceId),
    );

    store.enrollDevice('account-a', second.deviceId, 'workspace-a', owner.deviceId, envelope(second.deviceId));
    expect(() =>
      store.authorizeSync('account-a', first.deviceId, 'workspace-a', firstGrant.enrollmentVersion + 1),
    ).toThrow('revoked or stale');
    expect(store.authorizeSync('account-a', first.deviceId, 'workspace-a', firstGrant.enrollmentVersion)).toMatchObject(
      {
        deviceId: first.deviceId,
      },
    );
  });

  it('recovers by revoking the lost identity and enrolling a replacement', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const lost = store.createIdentity('account-a', 'lost-key');
    const replacement = store.createIdentity('account-a', 'replacement-key');
    const quorum = store.createIdentity('account-a', 'quorum-key');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);

    store.enrollDevice('account-a', lost.deviceId, 'workspace-a', owner.deviceId, envelope(lost.deviceId));
    store.enrollDevice('account-a', quorum.deviceId, 'workspace-a', owner.deviceId, envelope(quorum.deviceId));
    const recovered = store.recoverDevice(
      'account-a',
      lost.deviceId,
      replacement.deviceId,
      'workspace-a',
      owner.deviceId,
      envelope(replacement.deviceId),
      new Date(),
      [owner.deviceId, quorum.deviceId],
    );

    expect(store.listDevices('account-a').find(({ deviceId }) => deviceId === lost.deviceId)?.status).toBe('revoked');
    expect(
      store.authorizeSync('account-a', replacement.deviceId, 'workspace-a', recovered.enrollmentVersion),
    ).toMatchObject({ deviceId: replacement.deviceId });
    const events = store.auditEvents('account-a');

    expect(events[events.length - 1]).toMatchObject({ kind: 'recovered', deviceId: replacement.deviceId });
  });

  it('rejects approval by an active device without target-workspace authorization', () => {
    const store = new DeviceIdentityStore();
    const approver = store.createIdentity('account-a', 'approver-key', 'Approver', new Date(), 'workspace-a');

    expect(() => store.approveWorkspace('account-a', 'workspace-b', approver.deviceId)).toThrow(
      'not authorized for this workspace',
    );
  });

  it('keeps the first single-device workspace approval instead of replacing it', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const second = store.createIdentity('account-a', 'second-key', 'Second', new Date(), 'workspace-a');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    expect(() => store.approveWorkspace('account-a', 'workspace-a', second.deviceId)).toThrow('single-device approval');
    expect(() =>
      store.enrollDevice('account-a', second.deviceId, 'workspace-a', owner.deviceId, envelope(second.deviceId)),
    ).not.toThrow();
  });

  it('rejects re-enrollment of a revoked identity', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const device = store.createIdentity('account-a', 'device-key');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    store.enrollDevice('account-a', device.deviceId, 'workspace-a', owner.deviceId, envelope(device.deviceId));
    store.revokeDevice('account-a', device.deviceId);

    expect(() =>
      store.enrollDevice('account-a', device.deviceId, 'workspace-a', owner.deviceId, envelope(device.deviceId)),
    ).toThrow('revoked device cannot be enrolled');
  });

  it('rejects recovery when the replacement identity does not exist', () => {
    const store = new DeviceIdentityStore();
    const owner = store.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
    const lost = store.createIdentity('account-a', 'lost-key');

    store.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
    store.enrollDevice('account-a', lost.deviceId, 'workspace-a', owner.deviceId, envelope(lost.deviceId));

    expect(() =>
      store.recoverDevice('account-a', lost.deviceId, 'missing', 'workspace-a', owner.deviceId, envelope('missing')),
    ).toThrow('not found');
  });
});
