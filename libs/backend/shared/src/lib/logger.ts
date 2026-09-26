import pino, { type LoggerOptions } from 'pino';
import pretty from 'pino-pretty';

import { correlation } from './observability';

export const loggerOptions: LoggerOptions = {
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  mixin: correlation,
  serializers: { err: () => ({ type: 'Error' }) },
  redact: {
    paths: [
      'req',
      'res',
      'headers',
      'body',
      'cookies',
      'cookie',
      'authorization',
      'password',
      'otp',
      'token',
      'url',
      'originalUrl',
      '*.password',
      '*.token',
      '*.otp',
      '*.authorization',
      '*.cookie',
    ],
    censor: '[REDACTED]',
  },
};

export const logger =
  process.env['NODE_ENV'] === 'production' ? pino(loggerOptions) : pino(loggerOptions, pretty({ colorize: true }));
