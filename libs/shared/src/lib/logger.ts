import pino from 'pino';
import pretty from 'pino-pretty';

const stream = pretty({
  colorize: true,
});

export const logger = pino(
  {
    level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  },
  stream,
);
