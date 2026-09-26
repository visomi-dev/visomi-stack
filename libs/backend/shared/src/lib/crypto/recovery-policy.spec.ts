import { evaluateRecovery } from './recovery-policy';

const approval = (deviceId: string) => ({ actorId: deviceId, deviceId, approvedAt: '2026-08-19T10:00:00.000Z' });

describe('recovery policy', () => {
  it('requires independent, non-revoked quorum and explicit consent', () => {
    expect(
      evaluateRecovery({
        approvals: [approval('device-a'), approval('device-b')],
        consentId: 'consent-1',
        quorum: 2,
        replacementDeviceId: 'replacement',
        revokedDeviceIds: new Set(),
        workspaceId: 'workspace-a',
      }),
    ).toEqual({ allowed: true, reason: 'quorum-met' });
  });

  it.each([
    ['duplicate', [approval('device-a'), approval('device-a')], new Set<string>(), 'duplicate-approver'],
    ['revoked', [approval('device-a')], new Set(['device-a']), 'revoked-approver'],
    ['short quorum', [approval('device-a')], new Set<string>(), 'insufficient-quorum'],
  ] as const)('denies %s recovery', (_name, approvals, revokedDeviceIds, reason) => {
    expect(
      evaluateRecovery({
        approvals,
        consentId: 'consent-1',
        quorum: 2,
        replacementDeviceId: 'replacement',
        revokedDeviceIds,
        workspaceId: 'workspace-a',
      }),
    ).toEqual({ allowed: false, reason });
  });
});
