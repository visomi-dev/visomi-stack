import {
  redactBridgeDiagnostic,
  selectBridgeSource,
  validateBridgeWelcome,
  type LocalAgentBridgeWelcome,
} from './local-agent-bridge';

const ready: LocalAgentBridgeWelcome = {
  format: 'themis.local-agent-bridge',
  version: 1,
  requestId: 'request-1',
  origin: 'https://app.example.test',
  state: 'ready',
  capabilities: ['projection'],
};

describe('local-agent bridge contract', () => {
  it('prefers a ready projection-capable agent', () => {
    expect(selectBridgeSource(ready)).toEqual({ source: 'local-agent', state: 'ready', capabilities: ['projection'] });
  });

  it.each([
    ['missing', null],
    ['revoked', { ...ready, state: 'revoked' }],
    ['unsafe', { ...ready, state: 'unsafe' }],
    ['missing capability', { ...ready, capabilities: [] }],
  ] as const)('selects safe Web-only fallback for %s', (_name, welcome) => {
    expect(selectBridgeSource(welcome)).toMatchObject({ source: 'web-only', state: 'fallback' });
  });

  it('requires the request, version, and origin to match', () => {
    expect(validateBridgeWelcome(ready, ready.origin, ready.requestId)).toEqual(ready);
    expect(() =>
      validateBridgeWelcome({ ...ready, origin: 'https://evil.test' }, ready.origin, ready.requestId),
    ).toThrow('origin-mismatched');
    expect(() => validateBridgeWelcome({ ...ready, version: 2 }, ready.origin, ready.requestId)).toThrow('Malformed');
  });

  it('redacts diagnostics and bounds their length', () => {
    const result = redactBridgeDiagnostic('token=secret-value and abcdefghijklmnopqrstuvwxyz0123456789');

    expect(result).not.toContain('secret-value');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result.length).toBeLessThanOrEqual(180);
  });
});
