export const redisConnection = Object.freeze({
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: process.env['REDIS_PORT'] ? Number(process.env['REDIS_PORT']) : 6379,
  username: process.env['REDIS_USERNAME'],
  password: process.env['REDIS_PASSWORD'],
});

export const redisConnectionUrl = redisConnection.username
  ? `redis://${redisConnection.username}:${redisConnection.password}@${redisConnection.host}:${redisConnection.port}`
  : `redis://${redisConnection.host}:${redisConnection.port}`;
