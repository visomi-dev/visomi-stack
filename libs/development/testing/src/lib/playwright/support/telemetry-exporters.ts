import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';

import type { ObservabilityOptions } from '@visomi-stack/web-backend-shared';

export function createTelemetryOptions(
  directory: string,
  service: ObservabilityOptions['service'],
  options: { holdSpans?: boolean } = {},
): ObservabilityOptions {
  const pendingSpans = new Set<Promise<void>>();
  const pendingMetrics = new Set<Promise<void>>();
  const heldSpans: (() => void)[] = [];
  const write = (file: string, value: unknown) => appendFileSync(join(directory, file), JSON.stringify(value) + '\n');
  const exportRecord = (file: string, value: unknown, callback: (result: { code: 0 }) => void) => {
    write('pending.jsonl', { file });
    const pending = file === 'spans.jsonl' ? pendingSpans : pendingMetrics;
    const delivery = new Promise<void>((resolve) => {
      const deliver = () => {
        write(file, value);
        callback({ code: 0 });
        resolve();
      };

      if (file === 'spans.jsonl' && options.holdSpans) {
        heldSpans.push(deliver);
      } else {
        setTimeout(deliver, 50);
      }
    });

    pending.add(delivery);
    void delivery.then(() => pending.delete(delivery));
  };
  const drainSpans = async () => {
    for (const deliver of heldSpans.splice(0)) {
      deliver();
    }

    await Promise.all([...pendingSpans]);
  };
  const drainMetrics = async () => {
    await Promise.all([...pendingMetrics]);
  };
  const reader = new PeriodicExportingMetricReader({
    exportIntervalMillis: 100,
    exporter: {
      selectAggregationTemporality: () => AggregationTemporality.CUMULATIVE,
      export: (metrics, callback) =>
        exportRecord(
          'metrics.jsonl',
          {
            resource: { attributes: metrics.resource.attributes },
            scopeMetrics: metrics.scopeMetrics,
          },
          callback,
        ),
      forceFlush: drainMetrics,
      shutdown: drainMetrics,
    },
  });

  return {
    service,
    version: '0.0.1',
    environment: 'test',
    destination: { write: (line) => appendFileSync(join(directory, 'logs.jsonl'), line) },
    metricReader: reader,
    spanExporter: {
      export: (spans, callback) =>
        exportRecord(
          'spans.jsonl',
          spans.map((span) => ({
            name: span.name,
            context: span.spanContext(),
            parent: span.parentSpanContext,
            attributes: span.attributes,
            events: span.events,
            links: span.links,
            status: span.status,
            resource: span.resource.attributes,
            scope: span.instrumentationScope,
          })),
          callback,
        ),
      forceFlush: drainSpans,
      shutdown: drainSpans,
    },
  };
}
