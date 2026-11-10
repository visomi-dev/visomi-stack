import { EventEmitter } from 'node:events';

import { expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({ all: [] as RedisFixture[] }));

class RedisFixture extends EventEmitter {
  status = 'wait';
  connect = vi.fn(async () => {
    this.status = 'ready';
  });
  publish = vi.fn();
  subscribe = vi.fn();
  disconnect = vi.fn();

  constructor() {
    super();
    clients.all.push(this);
  }

  duplicate() {
    return new RedisFixture();
  }
}

vi.mock('ioredis', () => ({
  Redis: function RedisMock() {
    return new RedisFixture();
  },
}));

import { createRedisRealtimeTransport } from './realtime-redis';

it('accepts Redis URLs, validates messages and separates subscriber from publisher', async () => {
  const onError = vi.fn();
  const transport = createRedisRealtimeTransport('rediss://synthetic', onError);
  const event = { kind: 'session', id: 'synthetic-session' } as const;
  const receive = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('synthetic'));

  await transport.subscribe(receive);

  await expect(transport.subscribe(receive)).rejects.toThrow('realtime_transport_already_subscribed');

  await transport.publish(event);

  await transport.publish(event);

  const [publisher, subscriber] = clients.all;

  expect(publisher.connect).toHaveBeenCalledOnce();
  expect(publisher.publish).toHaveBeenCalledWith('visomi-stack:realtime:v1', JSON.stringify(event));
  expect(subscriber.subscribe).toHaveBeenCalledWith('visomi-stack:realtime:v1');
  for (const data of [
    'x'.repeat(513),
    'invalid-json',
    '{"kind":"unknown"}',
    JSON.stringify(event),
    JSON.stringify(event),
  ]) {
    subscriber.emit('message', 'visomi-stack:realtime:v1', data);
  }

  await Promise.resolve();

  expect(receive.mock.calls).toEqual([[event], [event]]);
  expect(onError).toHaveBeenCalledOnce();
  transport.close();
  expect(publisher.disconnect).toHaveBeenCalledOnce();
  expect(subscriber.disconnect).toHaveBeenCalledOnce();
});

it('rejects other protocols and can close before subscribing', () => {
  const onError = vi.fn();

  expect(() => createRedisRealtimeTransport('https://synthetic', onError)).toThrow('realtime_transport_invalid');
  const transport = createRedisRealtimeTransport('redis://synthetic', onError);

  transport.close();
  expect(clients.all.at(-1)?.disconnect).toHaveBeenCalledOnce();
});
