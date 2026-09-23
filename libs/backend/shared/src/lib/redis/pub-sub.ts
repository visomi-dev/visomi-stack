import { env } from '../env';

import { getRedis, getRedisSubscriber } from './connection';

async function publishJson(channel: string, payload: unknown) {
  if (env.DATABASE_DRIVER === 'memory') {
    return;
  }

  await getRedis().publish(channel, JSON.stringify(payload));
}

async function subscribeToJson<T>(channel: string, onMessage: (payload: T) => void | Promise<void>) {
  if (env.DATABASE_DRIVER === 'memory') {
    return;
  }

  const subscriber = getRedisSubscriber();

  await subscriber.subscribe(channel);
  subscriber.on('message', (messageChannel, message) => {
    if (messageChannel !== channel) {
      return;
    }

    void onMessage(JSON.parse(message) as T);
  });
}

export { publishJson, subscribeToJson };
