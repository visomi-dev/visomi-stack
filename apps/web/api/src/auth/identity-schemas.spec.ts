import {
  approvalConsumeSchema,
  googleCompleteSchema,
  identityIdentifySchema,
  securityDevicePathSchema,
  securityIdentityPathSchema,
  challengeSchema,
} from './auth-schemas';

describe('passwordless identity schemas', () => {
  const flowId = '00000000-0000-4000-8000-000000000001';

  it('requires a flow binding for email identification and Google completion', () => {
    expect(identityIdentifySchema.safeParse({ email: 'person@example.com' }).success).toBe(false);
    expect(googleCompleteSchema.safeParse({ flowId, idToken: 'token' }).success).toBe(true);
  });

  it('accepts only six-digit approval codes', () => {
    expect(approvalConsumeSchema.safeParse({ requestId: flowId, userCode: '123456' }).success).toBe(true);
    expect(approvalConsumeSchema.safeParse({ requestId: flowId, userCode: '12345' }).success).toBe(false);
  });

  it('keeps recovery purpose distinct from bootstrap verification', () => {
    expect(
      challengeSchema.safeParse({
        challengeId: flowId,
        email: 'person@example.com',
        expiresAt: new Date().toISOString(),
        purpose: 'existing_account_recovery',
      }).success,
    ).toBe(true);
    expect(securityIdentityPathSchema.safeParse({ identityId: 'federated-1' }).success).toBe(true);
    expect(securityDevicePathSchema.safeParse({ deviceId: 'device-1' }).success).toBe(true);
  });
});
