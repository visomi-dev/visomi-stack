import { Writable } from 'node:stream';

import express, { type RequestHandler } from 'express';
import pino from 'pino';
import request from 'supertest';

import { createApp } from './app';

import { logger, operationalMetrics, requestObservability } from 'shared';

jest.mock('shared', () => ({
  ...jest.requireActual('shared'),
  runMigrationsIfEnabled: jest.fn().mockResolvedValue(undefined),
  createAuthRuntimeMiddleware: jest.fn(() => [((_req, _res, next) => next()) satisfies RequestHandler]),
}));

describe('API operational logging wiring', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])('logs redacted HTTP completion once (embedded=%s)', async (embedded) => {
    const records: unknown[] = [];
    let standardOutput = '';
    const capture = pino(
      new Writable({
        write(chunk, _encoding, callback) {
          records.push(JSON.parse(String(chunk)) as unknown);
          callback();
        },
      }),
    );

    jest.spyOn(logger, 'info').mockImplementation(capture.info.bind(capture));
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      standardOutput += String(chunk);

      return true;
    });
    const before = operationalMetrics();
    const api = await createApp({ mountAuthRuntime: !embedded });
    const app = express();

    if (embedded) app.use(requestObservability((event) => logger.info(event, 'HTTP request completed')));
    app.use(api);
    const response = await request(app)
      .get('/health?token=secret-query')
      .set('x-request-id', 'api-wire-test')
      .set('Authorization', 'Bearer secret-header')
      .set('Cookie', 'sid=secret-cookie');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBe('api-wire-test');
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        requestId: 'api-wire-test',
        operation: 'http',
        status: 200,
        code: 'completed',
        msg: 'HTTP request completed',
      }),
    );
    expect(JSON.stringify(records)).not.toMatch(/secret-|\/health|authorization|cookie/);
    expect(standardOutput).not.toMatch(/secret-|\/health/);
    expect(operationalMetrics().requests).toBe(before.requests + 1);
  });
});
