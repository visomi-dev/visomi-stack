import { publishJson } from '../redis/pub-sub';

import { notificationChannel } from './contract';
import { publishNotificationHint } from './events';

jest.mock('../redis/pub-sub', () => ({ publishJson: jest.fn() }));

const owner = {
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(publishJson).mockResolvedValue(undefined);
});

describe('committed notification hints', () => {
  it('projects only validated recipient routing even when a trusted caller holds additional context', async () => {
    const context = { ...owner, sessionId: 'never-publish', privateContent: 'never-publish' };

    await publishNotificationHint(context);
    expect(publishJson).toHaveBeenCalledWith(notificationChannel, owner);
    expect(publishJson).toHaveBeenCalledTimes(1);
  });

  it('does not fail a committed producer when the Redis hint transport is unavailable', async () => {
    jest.mocked(publishJson).mockRejectedValueOnce(new Error('Unavailable'));

    await expect(publishNotificationHint(owner)).resolves.toBeUndefined();
  });

  it('rejects malformed recipients before contacting the hint transport', async () => {
    await expect(publishNotificationHint({ ...owner, accountId: 'invalid' })).rejects.toThrow();
    expect(publishJson).not.toHaveBeenCalled();
  });
});
