import IORedis from 'ioredis';

import { env } from '../env';

const connectionKey = '__themisRedisConnection';

const subscriberKey = '__themisRedisSubscriberConnection';

const globalState = globalThis as typeof globalThis & {
  [connectionKey]?: IORedis;
  [subscriberKey]?: IORedis;
};

function createConnection() {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

function getRedis() {
  globalState[connectionKey] ??= createConnection();

  return globalState[connectionKey] as IORedis;
}

function getRedisSubscriber() {
  globalState[subscriberKey] ??= createConnection();

  return globalState[subscriberKey] as IORedis;
}

export { getRedis, getRedisSubscriber };
