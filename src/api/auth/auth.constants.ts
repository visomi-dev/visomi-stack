import IORedis from 'ioredis';

if (!process.env['REDIS_URL']) {
  throw new Error('REDIS_URL environment variable is required');
}

export const TEMPORARY_ONE_TIME_CODES_QUEUE = 'temporary_one_time_codes';

export const redisConnection = new IORedis(process.env['REDIS_URL'], {
  maxRetriesPerRequest: null,
});
