import { generateKeyPairSync } from 'node:crypto';

import { CapabilityPolicy, signCapability, type Capability } from './capability-policy';
import { CapabilityIssuerKeyRegistry, type IssuerKeyRecord } from './capability-issuer';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');

const capability = (overrides: Partial<Capability> = {}): Capability =>
  signCapability(
    {
      audience: 'local-agent',
      delegable: false,
      expiresAt: '2026-08-18T12:00:00.000Z',
      format: 'themis.capability',
      id: 'cap-1',
      issuedAt: '2026-08-18T10:00:00.000Z',
      issuer: 'local-agent',
      purpose: 'run-tests',
      scope: { accountId: 'account-a', action: 'execute', projectId: 'project-a', workspaceId: 'workspace-a' },
      signature: '',
      subject: 'agent-a',
      version: 1,
      ...overrides,
    },
    keys.privateKey,
    publicKey,
  );

const request = (overrides: Record<string, unknown> = {}) => ({
  at: new Date('2026-08-18T11:00:00.000Z'),
  audience: 'local-agent' as const,
  caller: 'agent-a',
  purpose: 'run-tests',
  requestId: 'request-1',
  scope: { accountId: 'account-a', action: 'execute' as const, projectId: 'project-a', workspaceId: 'workspace-a' },
  ...overrides,
});

describe('CapabilityPolicy', () => {
  it('requires a registered, active issuer key when a registry is configured', () => {
    const state: { keys: readonly IssuerKeyRecord[] } = {
      keys: [],
    };
    const registry = new CapabilityIssuerKeyRegistry({
      load: () => state.keys,
      save: (keys) => {
        state.keys = keys;
      },
    });

    registry.register({
      issuer: 'local-agent',
      keyId: 'default',
      publicKey,
      status: 'active',
      validFrom: '2026-08-18T00:00:00.000Z',
    });
    const policy = new CapabilityPolicy(undefined, registry);

    expect(policy.evaluate(capability(), request())).toEqual({ allowed: true, capabilityId: 'cap-1' });
    registry.revoke('local-agent', 'default');
    expect(policy.evaluate(capability({ id: 'cap-2' }), request({ requestId: 'request-2' }))).toEqual({
      allowed: false,
      reason: 'malformed',
    });
  });
  it('allows an exact, audience-bound request', () => {
    expect(new CapabilityPolicy().evaluate(capability(), request())).toEqual({ allowed: true, capabilityId: 'cap-1' });
  });

  it.each([
    [
      'scope escalation',
      { scope: { accountId: 'account-a', action: 'write', projectId: 'project-a', workspaceId: 'workspace-a' } },
      'scope-mismatch',
    ],
    ['confused deputy', { audience: 'mcp:untrusted-tool' }, 'audience-mismatch'],
    ['wrong caller', { caller: 'agent-b' }, 'subject-mismatch'],
    ['wrong purpose', { purpose: 'export-project' }, 'purpose-mismatch'],
  ])('denies %s', (_name, overrides, reason) => {
    expect(new CapabilityPolicy().evaluate(capability(), request(overrides))).toEqual({ allowed: false, reason });
  });

  it('denies expiry, revocation, and replay', () => {
    const policy = new CapabilityPolicy();

    expect(policy.evaluate(capability({ expiresAt: '2026-08-18T11:00:00.000Z' }), request())).toEqual({
      allowed: false,
      reason: 'expired',
    });
    policy.revoke('cap-1');
    expect(policy.evaluate(capability(), request({ requestId: 'request-2' }))).toEqual({
      allowed: false,
      reason: 'revoked',
    });

    const active = new CapabilityPolicy();

    expect(active.evaluate(capability(), request())).toEqual({ allowed: true, capabilityId: 'cap-1' });
    expect(active.evaluate(capability(), request())).toEqual({ allowed: false, reason: 'replayed' });
  });

  it('denies forged signatures', () => {
    const forged = { ...capability(), signature: Buffer.from('forged').toString('base64url') };

    expect(new CapabilityPolicy().evaluate(forged, request())).toEqual({ allowed: false, reason: 'malformed' });
  });
});
