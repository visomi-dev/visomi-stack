import {
  ClientCapabilityContractError,
  intersectClientCapabilities,
  negotiateClientMode,
  stateError,
  type ModeNegotiationRequest,
} from './dual-client-capability';

const claim = {
  format: 'themis.client-capability' as const,
  version: 1 as const,
  claimId: 'claim-001',
  clientId: 'browser-001',
  clientProfile: 'web-local-agent' as const,
  accountId: 'account-001',
  workspaceId: 'workspace-001',
  capabilities: ['vault-access', 'unlock', 'projection', 'bridge', 'sync', 'recovery', 'offline'] as const,
  issuedAt: '2026-08-20T00:00:00.000Z',
  expiresAt: '2026-08-20T01:00:00.000Z',
  authenticator: { scheme: 'local-agent-signature' as const, keyId: 'key-001', proof: 'proof' },
};

const request = (overrides: Partial<ModeNegotiationRequest> = {}): ModeNegotiationRequest => ({
  format: 'themis.mode-negotiation-request',
  requestId: 'request-001',
  clientId: 'browser-001',
  clientProfile: 'web-local-agent',
  supportedModes: ['local-agent', 'webcrypto'],
  supportedVersions: [1],
  requestedCapabilities: ['vault-access', 'projection', 'bridge'],
  preferredMode: 'local-agent',
  allowDowngrade: false,
  claim,
  ...overrides,
});

describe('dual-client capability contract', () => {
  it('negotiates the local-agent profile with the capability intersection', () => {
    expect(intersectClientCapabilities(['projection', 'bridge', 'recovery'], ['projection', 'bridge'])).toEqual([
      'projection',
      'bridge',
    ]);
    expect(negotiateClientMode(request(), () => true, Date.parse('2026-08-20T00:30:00.000Z'))).toMatchObject({
      selectedMode: 'local-agent',
      grantedCapabilities: ['vault-access', 'projection', 'bridge'],
      state: 'ready',
    });
  });

  it('supports an explicit safe webcrypto downgrade and rejects bridge downgrade', () => {
    expect(
      negotiateClientMode(
        request({
          supportedModes: ['webcrypto'],
          preferredMode: 'local-agent',
          allowDowngrade: true,
          requestedCapabilities: ['projection'],
        }),
        () => true,
        Date.parse('2026-08-20T00:30:00.000Z'),
      ).selectedMode,
    ).toBe('webcrypto');
    expect(() =>
      negotiateClientMode(
        request({ supportedModes: ['webcrypto'], preferredMode: 'local-agent', allowDowngrade: true }),
        () => true,
        Date.parse('2026-08-20T00:30:00.000Z'),
      ),
    ).toThrow(expect.objectContaining({ code: 'unsafe-downgrade' }));
  });

  it.each([
    ['unsupported-version', request({ supportedVersions: [2] })],
    ['ambiguous-identity', request({ clientId: 'other-client' })],
    ['unauthenticated', request()],
  ] as const)('rejects %s', (code, input) => {
    const verify = code === 'unauthenticated' ? () => false : () => true;

    expect(() => negotiateClientMode(input, verify, Date.parse('2026-08-20T00:30:00.000Z'))).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('rejects unsupported capabilities and exposes stable state errors', () => {
    expect(() =>
      negotiateClientMode(
        request({
          clientProfile: 'web-webcrypto',
          supportedModes: ['webcrypto'],
          requestedCapabilities: ['bridge'],
          claim: { ...claim, clientProfile: 'web-webcrypto', capabilities: ['bridge'] },
        }),
        () => true,
        Date.parse('2026-08-20T00:30:00.000Z'),
      ),
    ).toThrow(expect.objectContaining({ code: 'unsafe-downgrade' }));
    for (const state of [
      'locked',
      'unavailable',
      'revoked',
      'offline',
      'incompatible-version',
      'recovery-required',
    ] as const) {
      expect(() => {
        throw stateError(state);
      }).toThrow(expect.objectContaining({ code: state }));
    }
    expect(new ClientCapabilityContractError('recovery-required', 'recover').code).toBe('recovery-required');
  });
});
