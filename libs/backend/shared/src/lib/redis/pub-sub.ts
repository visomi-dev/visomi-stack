import { EventEmitter } from 'node:events';

import { env } from '../env';

import { getRedis, getRedisSubscriber } from './connection';

const memoryKey = Symbol.for('visomi.memory.pub-sub');
const registry = globalThis as typeof globalThis & { [memoryKey]?: EventEmitter };
const memory = (registry[memoryKey] ??= new EventEmitter());

async function publishJson(channel: string, payload: unknown) {
  if (env.DATABASE_DRIVER === 'memory') {
    memory.emit(channel, JSON.stringify(payload));

    return;
  }

  await getRedis().publish(channel, JSON.stringify(payload));
}

async function subscribeToJson<T>(channel: string, onMessage: (payload: T) => void | Promise<void>) {
  const listener = (messageChannel: string, message: string) => {
    if (messageChannel !== channel) {
      return;
    }

    // The transport is not a trust boundary. Malformed events must not crash a runtime.
    try {
      void Promise.resolve(onMessage(JSON.parse(message) as T)).catch(() => undefined);
    } catch {
      return;
    }
  };

  if (env.DATABASE_DRIVER === 'memory') {
    const receive = (message: string) => listener(channel, message);

    memory.on(channel, receive);

    return () => {
      memory.off(channel, receive);
    };
  }
  const subscriber = getRedisSubscriber();

  await subscriber.subscribe(channel);
  subscriber.on('message', listener);

  // Keep the shared connection's channel subscription for other consumers.
  return () => subscriber.off('message', listener);
}

export { publishJson, subscribeToJson };
