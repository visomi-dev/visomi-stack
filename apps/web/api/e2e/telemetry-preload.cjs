const { appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// This explicit test entrypoint only instruments the application, never Nx or its watchers.
const entry = process.argv[1]?.replaceAll('\\', '/');
const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

if (directory && (entry?.endsWith('/api/src/main.ts') || entry?.endsWith('/api/main.js'))) {
  require('tsx/cjs');
  const { initializeObservability } = require('../../../../libs/web/backend/shared/src/index');
  const { PeriodicExportingMetricReader, AggregationTemporality } = require('@opentelemetry/sdk-metrics');
  const pendingSpans = new Set();
  const pendingMetrics = new Set();
  const heldSpans = [];
  const write = (file, value) => appendFileSync(join(directory, file), JSON.stringify(value) + '\n');
  const exportRecord = (file, value, callback) => {
    write('pending.jsonl', { file });
    const pending = file === 'spans.jsonl' ? pendingSpans : pendingMetrics;
    const delivery = new Promise((resolve) => {
      const deliver = () => {
        write(file, value);
        callback({ code: 0 });
        resolve();
      };

      if (file === 'spans.jsonl' && process.env.VISOMI_E2E_HOLD_SPANS === 'true') {
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
      export: (metrics, callback) => exportRecord('metrics.jsonl', metrics, callback),
      forceFlush: drainMetrics,
      shutdown: drainMetrics,
    },
  });

  writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, parentPid: process.ppid }));
  initializeObservability({
    service: 'web-api',
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
  });
}
