import { Writable } from 'node:stream';

import pino from 'pino';

import { loggerOptions } from './logger';
import { correlation, withCorrelation } from './observability';

describe('operational logger', () => {
  it('adds async context and redacts request objects, credentials and raw errors', () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const log = pino(loggerOptions, stream);

    withCorrelation('logger-test', () =>
      log.info(
        {
          req: { url: '/?token=secret', headers: { cookie: 'secret' } },
          body: { otp: 'secret' },
          authorization: 'secret',
          password: 'secret',
          err: new Error('secret'),
        },
        'Safe operational event',
      ),
    );
    expect(output).not.toContain('secret');
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({ requestId: 'logger-test', req: '[REDACTED]', err: { type: 'Error' } }),
    );
  });

  it('does not retain previous log fields in the async context', () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const log = pino(loggerOptions, stream);

    withCorrelation('isolated', () => {
      log.info({ transient: 'first-event-only' }, 'Safe event');
      expect(correlation()).toEqual({ requestId: 'isolated' });
    });
  });
});
