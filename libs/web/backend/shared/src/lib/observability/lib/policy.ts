export type Service = 'web-api' | 'web-gateway' | 'worker' | 'realtime';
export type Environment = 'development' | 'test' | 'production' | 'unknown';
export type Operation = 'http.request' | 'job.execute';
export type Outcome = 'success' | 'client_error' | 'server_error' | 'aborted' | 'job_failed';
export type RuntimeEvent = 'runtime.started' | 'runtime.stopped' | 'runtime.failed';
export type ErrorCode = 'none' | 'startup_failed' | 'shutdown_failed' | 'shutdown_timeout';

export type Correlation = Readonly<{ requestId: string; traceId: string; spanId: string }>;
export type JobContext = Correlation & Readonly<{ version: 1 }>;

export function environment(value: unknown): Environment {
  return value === 'development' || value === 'test' || value === 'production' ? value : 'unknown';
}

export function service(value: unknown): Service {
  return value === 'web-gateway' || value === 'worker' || value === 'realtime' ? value : 'web-api';
}

export function version(value: unknown): string {
  return typeof value === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value) ? value : 'unknown';
}

export function runtimeEvent(value: unknown): RuntimeEvent {
  return value === 'runtime.started' || value === 'runtime.stopped' ? value : 'runtime.failed';
}

export function errorCode(value: unknown): ErrorCode {
  return value === 'startup_failed' || value === 'shutdown_failed' || value === 'shutdown_timeout' ? value : 'none';
}

export function outcome(value: unknown): Outcome {
  return value === 'success' || value === 'client_error' || value === 'aborted' || value === 'job_failed'
    ? value
    : 'server_error';
}

export function statusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

export function jobContext(value: unknown): JobContext | undefined {
  if (!value || typeof value !== 'object') {
    return;
  }

  const input = value as Record<string, unknown>;

  if (
    input.version !== 1 ||
    typeof input.requestId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.requestId) ||
    typeof input.traceId !== 'string' ||
    !/^(?!0{32}$)[a-f0-9]{32}$/.test(input.traceId) ||
    typeof input.spanId !== 'string' ||
    !/^(?!0{16}$)[a-f0-9]{16}$/.test(input.spanId)
  ) {
    return;
  }

  return Object.freeze({ version: 1, requestId: input.requestId, traceId: input.traceId, spanId: input.spanId });
}

export function isolate(work: () => void): void {
  try {
    work();
  } catch {
    // Telemetry must not change an application outcome.
  }
}
