import { randomUUID } from 'node:crypto';

import { ROOT_CONTEXT, SpanKind, SpanStatusCode, TraceFlags, createContextKey, trace } from '@opentelemetry/api';
import type { Context, Counter, Histogram, Span, Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { IMetricReader } from '@opentelemetry/sdk-metrics';
import { AlwaysOnSampler, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';

import {
  environment,
  errorCode,
  isolate,
  jobContext,
  outcome as approvedOutcome,
  runtimeEvent,
  service,
  statusCode,
  version,
} from './policy';
import type { Correlation, Environment, ErrorCode, Operation, Outcome, RuntimeEvent, Service } from './policy';
import { otlpSpanProcessors } from './otlp';

import type { BrowserErrorReport } from '@visomi-stack/web-shared-observability';
import { createInjector, inject, InjectionToken } from '@visomi-stack/backend-shared';

export type ObservabilityOptions = {
  service: Service;
  version: string;
  environment?: string;
  destination?: DestinationStream;
  spanExporter?: SpanExporter;
  metricReader?: IMetricReader;
};

const registryKey = Symbol.for('visomi-stack.observability.v1');
const requestKey = createContextKey('visomi-stack.request');

type Registry = { runtime?: Observability; shuttingDown?: boolean };

const OBSERVABILITY_OPTIONS = new InjectionToken<ObservabilityOptions>('observability options');
const OBSERVABILITY_STATE = new InjectionToken<Registry>('observability state');

function registry(): Registry {
  const host = globalThis as typeof globalThis & { [registryKey]?: Registry };

  return (host[registryKey] ??= {});
}

export function currentObservability(): Observability | undefined {
  return registry().runtime;
}

export function initializeObservability(options: ObservabilityOptions): Observability {
  const state = registry();

  if (state.runtime) {
    if (state.shuttingDown) {
      throw new Error('observability_shutdown_incomplete');
    }

    return state.runtime;
  }

  const runtime = createInjector([
    { provide: OBSERVABILITY_OPTIONS, useValue: options },
    { provide: OBSERVABILITY_STATE, useValue: state },
    ObservabilityRuntime,
  ]).get<ObservabilityRuntime>(ObservabilityRuntime);

  state.runtime = runtime;

  return runtime;
}

class ObservabilityRuntime implements Observability {
  private readonly state = inject<Registry>(OBSERVABILITY_STATE);

  private readonly manager: AsyncLocalStorageContextManager;
  private readonly metadata: { service: Service; version: string; environment: Environment };
  private readonly logger: Logger;
  private readonly provider: TracerProvider;
  private readonly meterProvider: MeterProvider;
  private readonly tracer: Tracer;
  private readonly httpCount: Counter;
  private readonly httpDuration: Histogram;
  private readonly jobCount: Counter;
  private readonly jobDuration: Histogram;

  private stopped = false;
  private shutdownPromise: Promise<boolean> | undefined;

  constructor() {
    const options = inject<ObservabilityOptions>(OBSERVABILITY_OPTIONS);
    const spanProcessors = options.spanExporter
      ? [new SimpleSpanProcessor({ exporter: options.spanExporter })]
      : otlpSpanProcessors(process.env);

    this.manager = new AsyncLocalStorageContextManager().enable();
    this.metadata = {
      service: service(options.service),
      version: version(options.version),
      environment: environment(options.environment),
    };
    const resource = resourceFromAttributes({
      'service.name': this.metadata.service,
      'service.version': this.metadata.version,
      'deployment.environment.name': this.metadata.environment,
    });

    this.logger = pino({ base: null, timestamp: false }, options.destination);
    this.provider = new TracerProvider({
      resource,
      sampler: new AlwaysOnSampler(),
      spanProcessors,
      spanLimits: { eventCountLimit: 0, linkCountLimit: 0, attributeCountLimit: 16 },
    });
    this.meterProvider = new MeterProvider({ resource, readers: options.metricReader ? [options.metricReader] : [] });
    this.tracer = this.provider.getTracer('visomi-stack.operational', this.metadata.version);
    const meter = this.meterProvider.getMeter('visomi-stack.operational', this.metadata.version);

    this.httpCount = meter.createCounter('http.server.requests');
    this.httpDuration = meter.createHistogram('http.server.request.duration', { unit: 's' });
    this.jobCount = meter.createCounter('job.executions');
    this.jobDuration = meter.createHistogram('job.duration', { unit: 's' });

    // Public methods remain safe to pass as callbacks, as the original closures were.
    this.event = this.event.bind(this);
    this.correlation = this.correlation.bind(this);
    this.beginHttp = this.beginHttp.bind(this);
    this.captureJobContext = this.captureJobContext.bind(this);
    this.runJob = this.runJob.bind(this);
    this.frontendError = this.frontendError.bind(this);
    this.shutdown = this.shutdown.bind(this);
  }

  event(name: RuntimeEvent, code: ErrorCode = 'none'): void {
    isolate(() =>
      this.logger.info({ ...this.metadata, event: runtimeEvent(name), code: errorCode(code) }, runtimeEvent(name)),
    );
  }

  correlation(ctx = this.manager.active()): Correlation | undefined {
    const requestId = ctx.getValue(requestKey);
    const span = trace.getSpanContext(ctx);

    if (typeof requestId !== 'string' || !span) {
      return;
    }

    return Object.freeze({ requestId, traceId: span.traceId, spanId: span.spanId });
  }

  beginHttp(): ReturnType<Observability['beginHttp']> {
    return this.begin('http.request');
  }

  frontendError(report: Omit<BrowserErrorReport, 'correlation'> & { release: string }, parent?: Correlation): void {
    const approved = jobContext(parent ? { version: 1, ...parent } : undefined);
    const ctx = approved
      ? trace.setSpanContext(ROOT_CONTEXT, {
          traceId: approved.traceId,
          spanId: approved.spanId,
          traceFlags: TraceFlags.SAMPLED,
          isRemote: true,
        })
      : ROOT_CONTEXT;
    const operation = this.begin('frontend.error', ctx);

    isolate(() =>
      trace.getSpan(operation.ctx)?.setAttributes({
        'frontend.application': report.application,
        'frontend.error.code': report.code,
        'frontend.error.kind': report.kind,
        'frontend.screen': report.screen,
        'frontend.release': report.release,
        ...(report.location
          ? {
              'code.asset': report.location.asset,
              'code.line': report.location.line,
              'code.column': report.location.column,
            }
          : {}),
      }),
    );
    operation.finish('client_error');
  }

  captureJobContext(): ReturnType<Observability['captureJobContext']> {
    const ids = this.correlation();

    return ids ? Object.freeze({ version: 1 as const, ...ids }) : undefined;
  }

  async runJob<T>(carrier: unknown, work: () => Promise<T>): Promise<T> {
    const incoming = jobContext(carrier);
    const parent: Context = incoming
      ? trace.setSpanContext(ROOT_CONTEXT, {
          traceId: incoming.traceId,
          spanId: incoming.spanId,
          traceFlags: TraceFlags.SAMPLED,
          isRemote: true,
        })
      : ROOT_CONTEXT;
    const job = this.begin('job.execute', parent, incoming?.requestId);

    return job.run(async () => {
      try {
        const result = await work();

        job.finish('success');

        return result;
      } catch (error) {
        job.finish('job_failed');

        throw error;
      }
    });
  }

  shutdown(timeoutMs = 1000): Promise<boolean> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    // Only the registered runtime can start shutdown; repeated calls returned above.
    this.state.shuttingDown = true;

    const timeout = Number.isFinite(timeoutMs) ? Math.min(5000, Math.max(1, timeoutMs)) : 1000;

    this.shutdownPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (success: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        this.stopped = true;
        clearTimeout(timer);
        this.manager.disable();

        resolve(success);
      };
      const timer = setTimeout(() => done(false), timeout);
      const flushLogs = new Promise<void>((flushResolve, flushReject) => {
        try {
          this.logger.flush((error) => {
            if (error) {
              flushReject();
            } else {
              flushResolve();
            }
          });
        } catch {
          flushReject();
        }
      });

      void Promise.allSettled([
        Promise.resolve().then(() => this.provider.shutdown()),
        Promise.resolve().then(() => this.meterProvider.shutdown()),
        flushLogs,
      ]).then((results) => {
        const success = results.every((result) => result.status === 'fulfilled');

        // A caller timeout does not prove that the owned resources have stopped.
        if (success && this.state.runtime === this) {
          this.state.runtime = undefined;
          this.state.shuttingDown = false;
        }

        done(success);
      });
    });

    return this.shutdownPromise;
  }

  private begin(operation: Operation, parent = ROOT_CONTEXT, requestId: string = randomUUID()) {
    let span: Span | undefined;

    isolate(() => {
      span = this.tracer.startSpan(
        operation,
        {
          kind:
            operation === 'http.request'
              ? SpanKind.SERVER
              : operation === 'job.execute'
                ? SpanKind.CONSUMER
                : SpanKind.INTERNAL,
        },
        parent,
      );
    });

    const ctx = (span ? trace.setSpan(parent, span) : parent).setValue(requestKey, requestId);
    const started = performance.now();
    let completed = false;
    const finish = (result: Outcome, rawStatus?: number): void => {
      if (completed || this.stopped) {
        return;
      }

      completed = true;
      const outcome = approvedOutcome(result);
      const status = statusCode(rawStatus);
      const duration = Math.max(0, (performance.now() - started) / 1000);
      const attributes = {
        operation,
        outcome,
        ...(status === undefined ? {} : { 'http.response.status_code': status }),
      };
      const ids = this.correlation(ctx);

      isolate(() =>
        this.logger.info(
          {
            ...this.metadata,
            event: operation,
            outcome,
            duration,
            ...(status === undefined ? {} : { status }),
            ...(ids ?? {}),
          },
          operation,
        ),
      );
      if (operation !== 'frontend.error') {
        isolate(() => (operation === 'http.request' ? this.httpCount : this.jobCount).add(1, attributes, ROOT_CONTEXT));
        isolate(() =>
          (operation === 'http.request' ? this.httpDuration : this.jobDuration).record(
            duration,
            attributes,
            ROOT_CONTEXT,
          ),
        );
      }

      isolate(() => span?.setAttributes(attributes));
      isolate(() => span?.setStatus({ code: outcome === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR }));
      isolate(() => span?.end());
    };

    return { ctx, finish, run: <T>(work: () => T): T => this.manager.with(ctx, work) };
  }
}

export type Observability = {
  frontendError: (report: Omit<BrowserErrorReport, 'correlation'> & { release: string }, parent?: Correlation) => void;
  event: (name: RuntimeEvent, code?: ErrorCode) => void;
  correlation: () => Correlation | undefined;
  beginHttp: () => { run: <T>(work: () => T) => T; finish: (outcome: Outcome, status?: number) => void };
  captureJobContext: () => (Correlation & { readonly version: 1 }) | undefined;
  runJob: <T>(carrier: unknown, work: () => Promise<T>) => Promise<T>;
  shutdown: (timeoutMs?: number) => Promise<boolean>;
};
