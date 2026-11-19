import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';

export function otlpSpanProcessors(env: NodeJS.ProcessEnv): SpanProcessor[] {
  const receiver = env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  const protocol = env['OTEL_EXPORTER_OTLP_PROTOCOL'];
  const headers = env['OTEL_EXPORTER_OTLP_HEADERS'];
  const traceHeaders = env['OTEL_EXPORTER_OTLP_TRACES_HEADERS'];
  const traceEndpoint = env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
  const traceProtocol = env['OTEL_EXPORTER_OTLP_TRACES_PROTOCOL'];

  if (!receiver && !protocol && !headers && !traceHeaders && !traceEndpoint && !traceProtocol) {
    return [];
  }

  let endpoint: URL;
  let authorization: string;

  try {
    endpoint = new URL(receiver!);
    authorization = decodeURIComponent(/^authorization=([^,]+)$/i.exec(headers?.trim() ?? '')?.[1] ?? '');
  } catch {
    throw new Error('observability_configuration_invalid');
  }

  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    !privateReceiver(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    /[?#]/.test(receiver!) ||
    protocol !== 'http/protobuf' ||
    !validAuthorization(authorization) ||
    traceHeaders ||
    (traceProtocol && traceProtocol !== protocol)
  ) {
    throw new Error('observability_configuration_invalid');
  }

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.href.replace(/\/$/, '')}/v1/traces`,
    headers: { authorization },
    httpAgentOptions: { keepAlive: true, rejectUnauthorized: true },
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

function privateReceiver(host: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(host) || /^[a-z0-9-]+\.railway\.internal$/.test(host);
}

function validAuthorization(value: string): boolean {
  if (/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(value)) {
    return true;
  }

  const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(value)?.[1];

  if (!basic || basic.length % 4 !== 0) {
    return false;
  }

  const credentials = Buffer.from(basic, 'base64');
  const separator = credentials.indexOf(58); // Basic encodes a username and password separated by a colon.

  return separator > 0 && separator < credentials.length - 1 && credentials.toString('base64') === basic;
}
