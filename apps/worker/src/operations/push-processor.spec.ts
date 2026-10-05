import { processNextPush } from './push-processor';

import { claimPushDelivery, createSessionStore, env, expirePushDeliveries, processPushDelivery } from 'shared';

jest.mock('shared', () => ({
  claimPushDelivery: jest.fn(),
  createSessionStore: jest.fn(() => ({ withSessionAuthority: jest.fn() })),
  env: { WEB_PUSH_ENABLED: false, WEB_PUSH_SUBJECT: 'mailto:push@example.test', DATABASE_DRIVER: 'memory' },
  expirePushDeliveries: jest.fn(),
  getPool: jest.fn(),
  isSessionAuthorityStore: () => true,
  processPushDelivery: jest.fn(),
  revokeSessionPushSubscriptions: jest.fn(),
  vapidConfiguration: { safeParse: () => ({ success: true, data: { subject: 'mailto:push@example.test' } }) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(env, 'WEB_PUSH_ENABLED', false);
});

describe('push polling consumer', () => {
  it('performs bounded cleanup without claiming or sending when transport is disabled', async () => {
    expect(await processNextPush()).toBe(false);
    expect(expirePushDeliveries).toHaveBeenCalledTimes(1);
    expect(claimPushDelivery).not.toHaveBeenCalled();
    expect(processPushDelivery).not.toHaveBeenCalled();
  });

  it('claims only one row and configures revocation cleanup on its authoritative store', async () => {
    jest.replaceProperty(env, 'WEB_PUSH_ENABLED', true);
    jest
      .mocked(claimPushDelivery)
      .mockResolvedValue({ id: 'test-delivery' } as Awaited<ReturnType<typeof claimPushDelivery>>);
    expect(await processNextPush()).toBe(true);
    expect(createSessionStore).toHaveBeenCalledWith(
      expect.objectContaining({ onSessionRevoked: expect.any(Function) }),
      undefined,
    );
    expect(processPushDelivery).toHaveBeenCalledWith({ id: 'test-delivery' }, expect.any(Object), {
      subject: 'mailto:push@example.test',
    });
  });

  it('returns idle when no eligible delivery exists', async () => {
    jest.replaceProperty(env, 'WEB_PUSH_ENABLED', true);
    jest.mocked(claimPushDelivery).mockResolvedValue(null);
    expect(await processNextPush()).toBe(false);
    expect(processPushDelivery).not.toHaveBeenCalled();
  });
});
