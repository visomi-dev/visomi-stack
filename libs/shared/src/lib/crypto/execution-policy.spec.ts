import { generateKeyPairSync } from 'node:crypto';

import { CapabilityPolicy, signCapability, type Capability, type CapabilityRequest } from './capability-policy';
import { ExecutionPolicy, type ExecutionDenyReason, type ExecutionRequest } from './execution-policy';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
const capability: Capability = signCapability(
  {
    audience: 'local-agent',
    delegable: false,
    expiresAt: '2026-08-18T12:00:00.000Z',
    format: 'themis.capability',
    id: 'cap-execution',
    issuedAt: '2026-08-18T10:00:00.000Z',
    issuer: 'local-agent',
    purpose: 'run-tests',
    scope: { accountId: 'account-a', action: 'execute', projectId: 'project-a', workspaceId: 'workspace-a' },
    signature: '',
    subject: 'agent-a',
    version: 1,
  },
  keys.privateKey,
  publicKey,
);
const capabilityRequest: CapabilityRequest = {
  at: new Date('2026-08-18T11:00:00.000Z'),
  audience: 'local-agent',
  caller: 'agent-a',
  purpose: 'run-tests',
  requestId: 'execution-request',
  scope: capability.scope,
};
const request = (overrides: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
  action: 'execute-command',
  dataClass: 'internal',
  path: '/workspace/project',
  profile: 'local-only',
  state: 'ready',
  capability,
  capabilityRequest,
  ...overrides,
});

describe('ExecutionPolicy', () => {
  it('allows a bounded local operation and denies filesystem escape', () => {
    const policy = new ExecutionPolicy(new CapabilityPolicy());

    expect(policy.evaluate(request())).toEqual({ allowed: true, reason: 'policy-allow' });
    expect(policy.evaluate(request({ path: '/etc/passwd' }))).toEqual({
      allowed: false,
      reason: 'filesystem-boundary',
    });
  });

  it.each(['/workspace/../etc/passwd', '/workspace/project/../../etc/passwd', '/workspace/./project'])(
    'normalizes filesystem traversal before checking containment: %s',
    (path) => {
      const policy = new ExecutionPolicy(new CapabilityPolicy());
      const decision = policy.evaluate(request({ path }));

      expect(decision).toEqual(
        path === '/workspace/./project'
          ? { allowed: true, reason: 'policy-allow' }
          : { allowed: false, reason: 'filesystem-boundary' },
      );
    },
  );

  const deniedCases: Array<[Partial<ExecutionRequest>, ExecutionDenyReason]> = [
    [{ state: 'locked' }, 'locked'],
    [{ state: 'revoked' }, 'revoked'],
    [{ state: 'offline', action: 'network', networkHost: 'api.example.test' }, 'offline-network'],
    [{ action: 'send-external-ai', dataClass: 'protected-plaintext', consent: true }, 'profile-denies-external-ai'],
    [{ action: 'use-secret', dataClass: 'secret' }, 'secret-broker-required'],
  ];

  it.each(deniedCases)('denies unsafe request: %s', (overrides, reason) => {
    expect(
      new ExecutionPolicy(new CapabilityPolicy(), '/workspace', new Set(['api.example.test'])).evaluate(
        request(overrides),
      ),
    ).toEqual({
      allowed: false,
      reason,
    });
  });

  it('requires consent and excludes protected plaintext by default for external AI', () => {
    const policy = new ExecutionPolicy(new CapabilityPolicy());

    expect(
      policy.evaluate(request({ action: 'send-external-ai', dataClass: 'internal', profile: 'external-redacted' })),
    ).toEqual({ allowed: false, reason: 'approval-required' });
    expect(
      policy.evaluate(
        request({
          action: 'send-external-ai',
          dataClass: 'protected-plaintext',
          profile: 'external-redacted',
          consent: true,
        }),
      ),
    ).toEqual({ allowed: false, reason: 'protected-data-denied' });
  });

  it('fails closed for sensitive operations while degraded', () => {
    expect(
      new ExecutionPolicy(new CapabilityPolicy()).evaluate(
        request({ state: 'degraded', action: 'use-secret', dataClass: 'secret', secretBroker: true }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'degraded-operation',
    });
  });

  it('allows recovery only with explicit consent in recovery state', () => {
    const policy = new ExecutionPolicy();

    expect(policy.evaluate(request({ action: 'recover', state: 'recovery', consent: true }))).toEqual({
      allowed: true,
      reason: 'recovery-allow',
    });
  });
});
