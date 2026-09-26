import { AsyncResource } from 'node:async_hooks';

import express, { json } from 'express';
import request from 'supertest';

import {
  correlateJob,
  correlation,
  observeProjectJob,
  operationalMetrics,
  requestId,
  requestObservability,
  setErrorReporter,
  withCorrelation,
} from './observability';

describe('operational observability', () => {
  afterEach(() => setErrorReporter());

  it('isolates overlapping async requests and leaves no ambient context', async () => {
    const values = await Promise.all(
      ['first', 'second'].map((id) =>
        withCorrelation(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, id === 'first' ? 10 : 1));

          return correlation().requestId;
        }),
      ),
    );

    expect(values).toEqual(['first', 'second']);
    expect(correlation()).toEqual({});
  });

  it('replaces invalid, oversized and ambiguous IDs', () => {
    for (const value of [undefined, '', 'a'.repeat(65), 'injected\nheader', 'a,b', ['one', 'two']]) {
      expect(requestId(value)).toMatch(/^[a-f0-9-]{36}$/);
    }
    expect(requestId('request_123-ABC')).toBe('request_123-ABC');
  });

  it('propagates serialized producer context while keeping metadata out of domain input', async () => {
    const input = withCorrelation('producer', () => correlateJob({ accountId: 'account', jobId: 'job' }));
    const sink = jest.fn();
    const before = operationalMetrics();

    await observeProjectJob(
      JSON.parse(JSON.stringify(input)) as typeof input,
      async (data) => {
        expect(data).toEqual({ accountId: 'account', jobId: 'job' });
        expect(correlation().requestId).toBe('producer');
      },
      sink,
    );
    expect(operationalMetrics().jobsCompleted).toBe(before.jobsCompleted + 1);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'producer', code: 'completed' }));
  });

  it('counts failures and reports only safe fields even when the reporter throws', async () => {
    const reporter = jest.fn(() => {
      throw new Error('adapter unavailable');
    });

    setErrorReporter(reporter);
    const before = operationalMetrics();
    const error = new Error('secret-password');

    await expect(
      observeProjectJob(
        {},
        async () => {
          throw error;
        },
        jest.fn(),
      ),
    ).rejects.toBe(error);
    expect(operationalMetrics().jobsFailed).toBe(before.jobsFailed + 1);
    expect(JSON.stringify(reporter.mock.calls)).not.toContain('secret-password');
  });

  it('returns correlation headers, logs no request secrets, and counts completion once', async () => {
    const app = express();
    const sink = jest.fn();
    const before = operationalMetrics();

    app.use(requestObservability(sink));
    app.use(json());
    app.post('/test', (_req, res) => res.status(503).json({ ok: false }));
    const response = await request(app)
      .post('/test?token=url-secret')
      .set('x-request-id', 'safe-id')
      .set('Authorization', 'Bearer header-secret')
      .set('Cookie', 'sid=cookie-secret')
      .send({ otp: 'body-secret' });

    expect(response.headers['x-request-id']).toBe('safe-id');
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503, code: 'http_error', requestId: 'safe-id' }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/url-secret|header-secret|cookie-secret|body-secret|\/test/);
    expect(operationalMetrics().requests).toBe(before.requests + 1);
    expect(operationalMetrics().requestErrors).toBe(before.requestErrors + 1);
    expect(operationalMetrics().requestDurationMs).toBeGreaterThan(before.requestDurationMs);
  });

  it('replaces invalid HTTP correlation and records successful requests without an error', async () => {
    const app = express();
    const sink = jest.fn();
    const before = operationalMetrics();

    app.use(requestObservability(sink));
    app.get('/', (_req, res) => res.sendStatus(204));
    const response = await request(app).get('/').set('x-request-id', 'invalid,combined');

    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ code: 'completed', status: 204 }));
    expect(operationalMetrics().requests).toBe(before.requests + 1);
    expect(operationalMetrics().requestErrors).toBe(before.requestErrors);
  });

  it('shares context, counters and reporter across independently evaluated module copies', async () => {
    let copy!: typeof import('./observability');

    jest.isolateModules(() => {
      copy = jest.requireActual('./observability');
    });
    expect(copy.withCorrelation).not.toBe(withCorrelation);
    const report = jest.fn();
    const before = operationalMetrics();

    copy.setErrorReporter(report);
    const results = await Promise.all(
      ['bundle-first', 'bundle-second'].map((id) =>
        withCorrelation(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, id === 'bundle-first' ? 5 : 1));

          return copy.correlateJob({ job: 'safe' }).observability?.requestId;
        }),
      ),
    );

    expect(results).toEqual(['bundle-first', 'bundle-second']);
    await expect(
      observeProjectJob(
        {},
        async () => {
          throw new Error('private-error');
        },
        jest.fn(),
      ),
    ).rejects.toThrow('private-error');
    expect(copy.operationalMetrics()).toEqual(operationalMetrics());
    expect(copy.operationalMetrics().jobsFailed).toBe(before.jobsFailed + 1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'job_failed' }));
    expect(JSON.stringify(report.mock.calls)).not.toContain('private-error');
    expect(copy.correlation()).toEqual({});
  });

  it('records embedded requests once across module copies and restores context after an async boundary', async () => {
    let copy!: typeof import('./observability');

    jest.isolateModules(() => {
      copy = jest.requireActual('./observability');
    });
    const boundary = new AsyncResource('test-embedded-api');
    const gateway = express();
    const api = express();
    const outer = jest.fn();
    const inner = jest.fn();
    const before = operationalMetrics();

    gateway.use(requestObservability(outer));
    gateway.use((_req, _res, next) =>
      boundary.runInAsyncScope(() => {
        expect(correlation()).toEqual({});
        next();
      }),
    );
    api.use(copy.requestObservability(inner));
    api.use(copy.requestObservability(inner));
    api.get('/job', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      res.json(copy.correlateJob({ job: 'queued' }));
    });
    gateway.use('/api', api);
    try {
      const responses = await Promise.all([request(gateway).get('/api/job'), request(gateway).get('/api/job')]);
      const ids = responses.map((response) => response.headers['x-request-id'] as string);

      expect(ids[0]).not.toBe(ids[1]);
      for (const response of responses) {
        expect(response.body.observability.requestId).toBe(response.headers['x-request-id']);
        expect(outer).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: response.headers['x-request-id'], status: 200 }),
        );
      }
      expect(outer).toHaveBeenCalledTimes(2);
      expect(inner).not.toHaveBeenCalled();
      expect(operationalMetrics().requests).toBe(before.requests + 2);
      expect(copy.operationalMetrics()).toEqual(operationalMetrics());
    } finally {
      boundary.emitDestroy();
    }
  });
});
