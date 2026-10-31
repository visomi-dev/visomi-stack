import { describe, expect, it, vi } from 'vitest';

import {
  environment,
  errorCode,
  isolate,
  jobContext,
  outcome,
  runtimeEvent,
  service,
  statusCode,
  version,
} from './policy';

describe('operational capture policy', () => {
  it.each(['development', 'test', 'production'])('accepts the controlled environment %s', (value) => {
    expect(environment(value)).toBe(value);
  });

  it.each(['web-api', 'web-gateway', 'web-app', 'worker', 'realtime'])('accepts the controlled service %s', (value) => {
    expect(service(value)).toBe(value);
  });

  it('normalizes uncontrolled values without copying them into telemetry', () => {
    for (const value of [undefined, null, {}, 42, 'SYNTHETIC_PRIVATE_MARKER']) {
      expect(environment(value)).toBe('unknown');
      expect(service(value)).toBe('web-api');
      expect(version(value)).toBe('unknown');
      expect(runtimeEvent(value)).toBe('runtime.failed');
      expect(errorCode(value)).toBe('none');
      expect(outcome(value)).toBe('server_error');
      expect(statusCode(value)).toBeUndefined();
      expect(jobContext(value)).toBeUndefined();
    }
  });

  it.each(['0.0.1', '12345.12345.12345'])('accepts a bounded numeric version %s', (value) => {
    expect(version(value)).toBe(value);
  });

  it.each(['1.2', '1.2.3-beta', '123456.0.0', '1.2.3\n'])('rejects an uncontrolled version %s', (value) => {
    expect(version(value)).toBe('unknown');
  });

  it('retains the allowed events, codes and outcomes', () => {
    for (const value of ['runtime.started', 'runtime.stopped', 'runtime.failed']) {
      expect(runtimeEvent(value)).toBe(value);
    }
    for (const value of ['none', 'startup_failed', 'shutdown_failed', 'shutdown_timeout']) {
      expect(errorCode(value)).toBe(value);
    }
    for (const value of ['success', 'client_error', 'server_error', 'aborted', 'job_failed']) {
      expect(outcome(value)).toBe(value);
    }
  });

  it.each([100, 200, 599])('accepts HTTP status %s', (value) => {
    expect(statusCode(value)).toBe(value);
  });

  it.each([99, 600, 200.5, NaN, Infinity, '200'])('rejects invalid HTTP status %s', (value) => {
    expect(statusCode(value)).toBeUndefined();
  });

  const carrier = {
    version: 1,
    requestId: '12345678-1234-4234-8234-123456789abc',
    traceId: '1'.repeat(32),
    spanId: '2'.repeat(16),
  };

  it('returns an immutable technical projection of a valid job carrier', () => {
    const input = { ...carrier, payload: 'SYNTHETIC_PRIVATE_MARKER', baggage: 'SYNTHETIC_PRIVATE_MARKER' };
    const result = jobContext(input);

    expect(result).toEqual(carrier);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    { version: '1' },
    { requestId: '12345678-1234-1234-8234-123456789abc' },
    { requestId: '12345678-1234-4234-7234-123456789abc' },
    { traceId: '0'.repeat(32) },
    { traceId: 'F'.repeat(32) },
    { traceId: '1'.repeat(31) },
    { spanId: '0'.repeat(16) },
    { spanId: 'F'.repeat(16) },
    { spanId: '2'.repeat(17) },
  ])('rejects an invalid carrier field %j', (invalid) => {
    expect(jobContext({ ...carrier, ...invalid })).toBeUndefined();
  });

  it('executes telemetry work once and contains synchronous failures', () => {
    const work = vi.fn(() => {
      throw new Error('SYNTHETIC_PRIVATE_MARKER');
    });

    expect(() => isolate(work)).not.toThrow();
    expect(work).toHaveBeenCalledOnce();
  });
});
