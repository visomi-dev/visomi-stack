import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { RequestHandler, Response } from 'express';

type Context = { requestId: string };
type Event = Context & {
  operation: 'http' | 'project-seed';
  durationMs: number;
  status?: number;
  code: 'completed' | 'http_error' | 'aborted' | 'job_failed';
};
type Sink = (event: Event) => void | Promise<void>;
export type CorrelatedJob<T> = T & { observability?: Context };
type State = {
  context: AsyncLocalStorage<Context>;
  requests: WeakMap<Response, Context>;
  counters: {
    requests: number;
    requestErrors: number;
    requestDurationMs: number;
    jobsCompleted: number;
    jobsFailed: number;
  };
  reporter?: Sink;
};
// Gateway and API bundles can each contain this module. A versioned process-global
// registry shares context and instrumentation ownership across those copies.
const stateKey = Symbol.for('visomi-stack.observability.v1');
const registry = globalThis as typeof globalThis & { [stateKey]?: State };
const state: State = (registry[stateKey] ??= {
  context: new AsyncLocalStorage<Context>(),
  requests: new WeakMap<Response, Context>(),
  counters: { requests: 0, requestErrors: 0, requestDurationMs: 0, jobsCompleted: 0, jobsFailed: 0 },
});
const { context, counters } = state;

export function requestId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ? value : randomUUID();
}

export function correlation(): Context | Record<string, never> {
  // Pino merges log fields into its mixin result. Never expose the ALS store itself.
  const store = context.getStore();

  return store ? { ...store } : {};
}

export function withCorrelation<T>(id: unknown, work: () => T): T {
  return context.run({ requestId: requestId(id) }, work);
}

/** Opt-in adapter receives only bounded operational fields, never the original error. */
export function setErrorReporter(adapter?: Sink): void {
  state.reporter = adapter;
}

function emit(event: Event, sink: Sink): void {
  try {
    void Promise.resolve(sink(event)).catch(() => undefined);
  } catch {
    /* Telemetry must not break application work. */
  }
  if (event.code !== 'completed') {
    try {
      void Promise.resolve(state.reporter?.(event)).catch(() => undefined);
    } catch {
      /* Reporter failure is isolated. */
    }
  }
}

export function operationalMetrics() {
  return { ...counters };
}

export function requestObservability(sink: Sink): RequestHandler {
  return (req, res, next) => {
    const existing = state.requests.get(res);

    // Re-enter the original context even if an embedded boundary lost its ALS
    // scope. Only the first middleware owns the header, listeners and counters.
    if (existing) return context.run(existing, next);

    return withCorrelation(req.headers['x-request-id'], () => {
      const id = context.getStore()!.requestId;
      const started = performance.now();
      let recorded = false;

      state.requests.set(res, { requestId: id });
      res.setHeader('x-request-id', id);
      const record = (aborted: boolean) => {
        if (recorded) return;
        recorded = true;
        const durationMs = performance.now() - started;
        const code = aborted ? 'aborted' : res.statusCode >= 400 ? 'http_error' : 'completed';

        counters.requests += 1;
        counters.requestDurationMs += durationMs;
        if (code !== 'completed') counters.requestErrors += 1;
        emit({ requestId: id, operation: 'http', durationMs, status: res.statusCode, code }, sink);
      };

      res.once('finish', () => record(false));
      res.once('close', () => record(!res.writableFinished));
      next();
    });
  };
}

export function correlateJob<T extends object>(data: T): CorrelatedJob<T> {
  return { ...data, observability: { requestId: context.getStore()?.requestId ?? randomUUID() } };
}

export async function observeProjectJob<T extends object, R>(
  input: CorrelatedJob<T>,
  work: (data: Omit<CorrelatedJob<T>, 'observability'>) => Promise<R>,
  sink: Sink,
): Promise<R> {
  const { observability, ...data } = input ?? ({} as CorrelatedJob<T>);

  return withCorrelation(observability?.requestId, async () => {
    const started = performance.now();
    let code: Event['code'] = 'completed';

    try {
      const result = await work(data);

      counters.jobsCompleted += 1;

      return result;
    } catch (error) {
      counters.jobsFailed += 1;
      code = 'job_failed';
      throw error;
    } finally {
      emit(
        {
          requestId: context.getStore()!.requestId,
          operation: 'project-seed',
          durationMs: performance.now() - started,
          code,
        },
        sink,
      );
    }
  });
}
