import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';

// Opt-in is separate from Railway's edge tracing switch: the edge has its own capture policy.
export function railwaySpanProcessors(env: NodeJS.ProcessEnv): SpanProcessor[] {
  if (env.VISOMI_RAILWAY_TRACING !== 'true') {
    return [];
  }

  let endpoint: URL;

  try {
    endpoint = new URL(env.OTEL_EXPORTER_OTLP_ENDPOINT!);
  } catch {
    throw new Error('observability_configuration_invalid');
  }

  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    env.OTEL_EXPORTER_OTLP_PROTOCOL !== 'http/protobuf' ||
    !env.OTEL_EXPORTER_OTLP_HEADERS
  ) {
    throw new Error('observability_configuration_invalid');
  }

  // The official exporter reads authentication headers, never resource detectors or instrumentation.
  const exporter = new OTLPTraceExporter({
    url: `${endpoint.href.replace(/\/$/, '')}/v1/traces`,
    timeoutMillis: 500,
  });

  return [
    new BatchSpanProcessor({
      exporter,
      maxQueueSize: 512,
      maxExportBatchSize: 128,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 750,
    }),
  ];
}
