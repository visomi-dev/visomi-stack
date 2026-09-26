import { redactedDiagnostic } from './diagnostics';

describe('redactedDiagnostic', () => {
  it('returns a stable class and correlation id without protected values', () => {
    expect(
      redactedDiagnostic(
        'local_agent_unavailable',
        new Error('token=secret-value challenge=raw-challenge'),
        '00000000-0000-0000-0000-000000000001',
      ),
    ).toEqual({
      code: 'local_agent_unavailable',
      correlationId: '00000000-0000-0000-0000-000000000001',
      message: 'token=[redacted] challenge=[redacted]',
    });
  });
});
