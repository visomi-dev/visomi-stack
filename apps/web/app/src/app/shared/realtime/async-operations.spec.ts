import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DateTime } from 'luxon';

import { AsyncOperations } from './async-operations';
import { Realtime } from './realtime';
import type { OperationEvent } from './operation-contract';

const operationId = '22222222-2222-4222-8222-222222222222';

describe('AsyncOperations', () => {
  let receive: (event: OperationEvent) => void;
  const unwatch = vi.fn();
  const ticket = () => ({ operationId, expiresAt: DateTime.utc().plus({ minutes: 1 }).toISO()! });

  beforeEach(() => {
    unwatch.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Realtime,
          useValue: {
            watchOperation: vi.fn((_id, callback) => {
              receive = callback;

              return unwatch;
            }),
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });

  it('recovers completed routing metadata through HTTP when live delivery is unavailable', async () => {
    const result = TestBed.inject(AsyncOperations).wait(ticket());

    TestBed.inject(HttpTestingController)
      .expectOne(`/api/operations/${operationId}`)
      .flush({ data: { operationId, status: 'completed', result: { jobId: operationId } } });
    await expect(result).resolves.toEqual({ jobId: operationId });
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('accepts validated live completion and cancels the outstanding HTTP read', async () => {
    const result = TestBed.inject(AsyncOperations).wait(ticket());
    const http = TestBed.inject(HttpTestingController).expectOne(`/api/operations/${operationId}`);

    receive({ operationId, status: 'completed', result: { jobId: operationId } });
    await expect(result).resolves.toEqual({ jobId: operationId });
    expect(http.cancelled).toBe(true);
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('polls after temporary transport failures and rejects permanent authority loss', async () => {
    vi.useFakeTimers();
    const result = TestBed.inject(AsyncOperations).wait(ticket());
    const rejection = expect(result).rejects.toThrow('operation_unavailable');
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(`/api/operations/${operationId}`).flush({}, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(2000);
    http.expectOne(`/api/operations/${operationId}`).flush({}, { status: 401, statusText: 'Unauthorized' });
    await rejection;
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('tears down polling and subscriptions when the caller cancels', async () => {
    const abort = new AbortController();
    const result = TestBed.inject(AsyncOperations).wait(ticket(), abort.signal);
    const rejection = expect(result).rejects.toThrow('operation_cancelled');
    const http = TestBed.inject(HttpTestingController).expectOne(`/api/operations/${operationId}`);

    abort.abort();
    await rejection;
    expect(http.cancelled).toBe(true);
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('cancels a stalled HTTP read after ten seconds and retries without losing its live watch', async () => {
    vi.useFakeTimers();
    const result = TestBed.inject(AsyncOperations).wait(ticket());
    const http = TestBed.inject(HttpTestingController);
    const stalled = http.expectOne(`/api/operations/${operationId}`);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(stalled.cancelled).toBe(true);
    expect(unwatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    http.expectOne(`/api/operations/${operationId}`).flush({
      data: { operationId, status: 'completed', result: { jobId: operationId } },
    });
    await expect(result).resolves.toEqual({ jobId: operationId });
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('cancels a stalled retry and its timeout when live completion arrives', async () => {
    vi.useFakeTimers();
    const result = TestBed.inject(AsyncOperations).wait(ticket());
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(`/api/operations/${operationId}`);
    await vi.advanceTimersByTimeAsync(12_000);
    const retry = http.expectOne(`/api/operations/${operationId}`);

    receive({ operationId, status: 'completed', result: { jobId: operationId } });
    await expect(result).resolves.toEqual({ jobId: operationId });
    expect(retry.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    http.expectNone(`/api/operations/${operationId}`);
    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('rejects malformed, expired and cross-operation HTTP responses', async () => {
    await expect(
      TestBed.inject(AsyncOperations).wait({ operationId, expiresAt: DateTime.utc().minus({ seconds: 1 }).toISO()! }),
    ).rejects.toThrow('operation_expired');
    const result = TestBed.inject(AsyncOperations).wait(ticket());
    const rejection = expect(result).rejects.toThrow('operation_response_invalid');

    TestBed.inject(HttpTestingController)
      .expectOne(`/api/operations/${operationId}`)
      .flush({ data: { operationId, status: 'completed', result: { jobId: operationId, secret: 'must-reject' } } });
    await rejection;
    expect(unwatch).toHaveBeenCalledOnce();
  });
});
