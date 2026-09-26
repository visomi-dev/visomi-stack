import { generateKeyPairSync } from 'node:crypto';

import { signCapability, type Capability } from './capability-policy';
import { DeviceIdentityStore } from './device-identity';
import { LocalAgentContextAuthority, type VerifiedLocalAgentContext } from './local-agent-context';
import { SecretBroker, type SecretBrokerRequest } from './secret-broker';

const envelope = (deviceId: string) => ({
  associatedData: { purpose: 'workspace-key-distribution', workspace: 'workspace-a' },
  authTag: 'tag',
  ciphertext: 'wrapped',
  createdAt: '2026-08-18T10:00:00.000Z',
  envelopeId: `key-${deviceId}`,
  format: 'themis.encrypted-envelope',
  kind: 'sync-object',
  metadata: { recipientDeviceId: deviceId },
  nonce: 'nonce',
  recordType: 'workspace-key-distribution',
  revision: 1,
  version: 1,
  workspaceId: 'workspace-a',
});
const setup = () => {
  const devices = new DeviceIdentityStore();
  const owner = devices.createIdentity('account-a', 'owner-key', 'Owner', new Date(), 'workspace-a');
  const device = devices.createIdentity('account-a', 'device-key');

  devices.approveWorkspace('account-a', 'workspace-a', owner.deviceId);
  const grant = devices.enrollDevice(
    'account-a',
    device.deviceId,
    'workspace-a',
    owner.deviceId,
    envelope(device.deviceId),
  );
  const authority = new LocalAgentContextAuthority(devices);

  return { authority, context: authority.authenticate('account-a', device.deviceId, 'workspace-a'), grant, devices };
};
const request = (
  context: VerifiedLocalAgentContext,
  overrides: Partial<SecretBrokerRequest> = {},
): SecretBrokerRequest => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const capability: Capability = signCapability(
    {
      audience: 'local-agent',
      delegable: false,
      expiresAt: '2026-08-18T12:00:00.000Z',
      format: 'themis.capability',
      id: 'secret-capability',
      issuedAt: '2026-08-18T10:00:00.000Z',
      issuer: 'local-agent',
      purpose: 'read-secret-metadata',
      scope: {
        accountId: context.accountId,
        action: 'use-secret',
        resourceId: 'secret-a',
        workspaceId: context.workspaceId,
      },
      signature: '',
      subject: context.principal,
      version: 1,
    },
    keys.privateKey,
    publicKey,
  );

  return {
    capability,
    capabilityRequest: {
      at: new Date('2026-08-18T11:00:00.000Z'),
      audience: 'local-agent',
      caller: 'forged-caller',
      purpose: 'read-secret-metadata',
      requestId: 'secret-request',
      scope: capability.scope,
    },
    consent: true,
    context,
    operation: 'metadata',
    purpose: 'read-secret-metadata',
    requestId: 'secret-request',
    secretId: 'secret-a',
    ...overrides,
  };
};

describe('SecretBroker', () => {
  it('authorizes enrolled context without returning secret material', () => {
    const { authority, context } = setup();
    const broker = new SecretBroker(authority);

    broker.register('secret-a', 'do-not-export', 'account-a', 'workspace-a');
    expect(broker.execute(request(context))).toEqual({
      allowed: true,
      result: { available: true, operation: 'metadata', secretId: 'secret-a' },
    });
    expect(JSON.stringify(broker.execute(request(context, { requestId: 'second' })))).not.toContain('do-not-export');
  });
  it('denies forged metadata, cross-device replay, and broker revocation', () => {
    const first = setup();
    const second = setup();
    const broker = new SecretBroker(first.authority);

    broker.register('secret-a', 'secret', 'account-a', 'workspace-a');
    expect(broker.execute(request(second.context, { capability: request(first.context).capability }))).toEqual({
      allowed: false,
      reason: 'boundary-denied',
    });
    const forged = { ...first.context, workspaceId: 'other' };

    expect(broker.execute(request(forged, { requestId: 'forged' }))).toEqual({
      allowed: false,
      reason: 'boundary-denied',
    });
    first.authority.revoke(first.context);
    expect(broker.execute(request(first.context, { requestId: 'revoked' }))).toEqual({
      allowed: false,
      reason: 'boundary-denied',
    });
  });
  it('rejects a same-request replay and exposes capability revocation', () => {
    const { authority, context } = setup();
    const broker = new SecretBroker(authority);

    broker.register('secret-a', 'secret', 'account-a', 'workspace-a');
    const first = request(context);

    expect(broker.execute(first).allowed).toBe(true);
    expect(broker.execute(first)).toEqual({ allowed: false, reason: 'boundary-denied' });

    broker.revokeCapability(first.capability.id);
    expect(
      broker.execute(request(context, { requestId: 'after-capability-revocation', capability: first.capability })),
    ).toEqual({ allowed: false, reason: 'boundary-denied' });
  });

  it('uses authoritative lock state instead of caller-supplied state', () => {
    const { authority, context } = setup();
    const broker = new SecretBroker(authority);

    broker.register('secret-a', 'secret', 'account-a', 'workspace-a');
    authority.lock();

    expect(broker.execute(request(context))).toEqual({ allowed: false, reason: 'locked' });
  });
  it.each([
    ['locked', 'locked'],
    ['consent', 'consent-required'],
    ['wrong workspace', 'not-found'],
    ['expired', 'boundary-denied'],
  ] as const)('denies %s', (_name, reason) => {
    const { authority, context } = setup();
    const broker = new SecretBroker(authority);

    broker.register('secret-a', 'secret', 'account-a', 'workspace-a');
    if (reason === 'locked') broker.lock();
    const overrides =
      reason === 'consent-required'
        ? { consent: false }
        : reason === 'not-found'
          ? { secretId: 'missing' }
          : reason === 'boundary-denied'
            ? { capability: { ...request(context).capability, expiresAt: '2026-08-18T11:00:00.000Z' } }
            : {};

    expect(broker.execute(request(context, overrides))).toEqual({ allowed: false, reason });
  });
});
