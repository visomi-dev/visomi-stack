import { defineConfig, triggers } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'stack-malformed-path-guard',
    compatibilityDate: '2026-11-01',
    entrypoint: './src/worker.ts',
    workersDev: false,
    previewUrls: false,
    logpush: false,
    observability: {
      enabled: false,
      logs: { enabled: false, invocationLogs: false },
      traces: { enabled: false },
    },
    triggers: [triggers.fetch({ pattern: 'stack.visomi.dev/*', zone: 'visomi.dev' })],
  },
});
