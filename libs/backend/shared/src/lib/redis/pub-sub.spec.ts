import { randomUUID } from 'node:crypto';

import { publishJson, subscribeToJson } from './pub-sub';

jest.mock('../env', () => ({ env: { DATABASE_DRIVER: 'memory' } }));
jest.mock('./connection', () => ({ getRedis: jest.fn(), getRedisSubscriber: jest.fn() }));

describe('memory pub-sub transport', () => {
  it('delivers JSON snapshots without sharing references and stops delivery on cleanup', async () => {
    const channel = randomUUID();
    const receive = jest.fn();
    const unsubscribe = await subscribeToJson(channel, receive);
    const payload = { value: 'first' };

    await publishJson(channel, payload);
    payload.value = 'changed';
    expect(receive).toHaveBeenCalledWith({ value: 'first' });
    unsubscribe();
    await publishJson(channel, payload);
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('isolates channels and handles rejecting consumers without breaking other subscribers', async () => {
    const channel = randomUUID();
    const other = jest.fn();
    const receive = jest.fn();
    const cleanup = await Promise.all([
      subscribeToJson(channel, async () => {
        throw new Error('Unavailable');
      }),
      subscribeToJson(channel, receive),
      subscribeToJson(randomUUID(), other),
    ]);

    await publishJson(channel, { operationId: 'metadata-only' });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    for (const unsubscribe of cleanup) unsubscribe();
  });
});
