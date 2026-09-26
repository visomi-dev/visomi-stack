import { Writable } from 'node:stream';

import express, { json } from 'express';
import pino from 'pino';
import request from 'supertest';

import { HttpError, errorHandler, redactedErrorDetails } from './http';
import { logger, loggerOptions } from './logger';
import { requestObservability } from './observability';

describe('HttpError', () => {
  it('stores response metadata', () => {
    const error = new HttpError({
      code: 'bad_request',
      data: { field: 'email' },
      message: 'Invalid request.',
      statusCode: 400,
    });

    expect(error.code).toBe('bad_request');
    expect(error.data).toEqual({ field: 'email' });
    expect(error.message).toBe('Invalid request.');
    expect(error.statusCode).toBe(400);
  });

  it('redacts error payloads and messages before audit logging', () => {
    const error = new HttpError({
      code: 'challenge_mismatch',
      data: { challenge: 'secret-challenge', credentialId: 'secret-credential' },
      message: 'secret challenge details',
      statusCode: 400,
    });

    expect(redactedErrorDetails(error)).toEqual({ code: 'challenge_mismatch', statusCode: 400 });
    expect(JSON.stringify(redactedErrorDetails(error))).not.toContain('secret');
  });
});

describe('correlated HTTP error logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['application', 'parser', 'unexpected'] as const)(
    'preserves the %s response contract while logging only safe correlated fields',
    async (kind) => {
      let output = '';
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          output += String(chunk);
          callback();
        },
      });
      const capture = pino(loggerOptions, stream);

      jest.spyOn(logger, 'error').mockImplementation(capture.error.bind(capture));
      const app = express();
      const completed = jest.fn();

      app.use(requestObservability(completed));
      app.use(json());
      app.post('/fail', () => {
        if (kind === 'application')
          throw new HttpError({
            code: 'secret-error-code',
            message: 'secret-message',
            data: { token: 'secret-data' },
            statusCode: 409,
          });
        throw new Error('secret-exception');
      });
      app.use(errorHandler);
      const response = await request(app)
        .post('/fail?token=secret-query')
        .set('x-request-id', 'error-correlation')
        .set('Authorization', 'Bearer secret-header')
        .set('Cookie', 'sid=secret-cookie')
        .set('Content-Type', 'application/json')
        .send(kind === 'parser' ? '{"token":"secret-body",' : { token: 'secret-body' });
      const expected =
        kind === 'application'
          ? {
              status: 409,
              body: { code: 'secret-error-code', message: 'secret-message', data: { token: 'secret-data' } },
              logCode: 'http_error',
            }
          : kind === 'parser'
            ? {
                status: 400,
                body: { code: 'invalid_request', message: 'The request payload is invalid.' },
                logCode: 'invalid_request',
              }
            : {
                status: 500,
                body: { code: 'internal_server_error', message: 'The request could not be completed.' },
                logCode: 'internal_server_error',
              };

      expect(response.status).toBe(expected.status);
      expect(response.body).toEqual(expected.body);
      expect(JSON.parse(output)).toEqual(
        expect.objectContaining({
          requestId: 'error-correlation',
          code: expected.logCode,
          statusCode: expected.status,
          msg: 'API request failed',
        }),
      );
      expect(output).not.toMatch(/secret-|\/fail|authorization|cookie|stack/);
      expect(completed).toHaveBeenCalledTimes(1);
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'error-correlation', status: expected.status, code: 'http_error' }),
      );
      expect(JSON.stringify(completed.mock.calls)).not.toContain('secret-');
    },
  );
});
