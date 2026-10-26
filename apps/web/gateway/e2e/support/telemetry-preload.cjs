const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Only the owning application process installs test exporters, never Nx or its watchers.
const entry = process.argv[1]?.replaceAll('\\', '/');
const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

if (directory && /\/gateway\/(src\/)?main\.(ts|js)$/.test(entry ?? '')) {
  process.env.TSX_TSCONFIG_PATH = join(__dirname, '../../tsconfig.spec.json');
  require('tsx/cjs');
  const { initializeObservability } = require('@visomi-stack/web-backend-shared');
  const { createTelemetryOptions } = require('@visomi-stack/dev-testing/telemetry');

  if (process.env.VISOMI_E2E_CONTAINER !== 'true') {
    writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, parentPid: process.ppid }));
  }

  initializeObservability(
    createTelemetryOptions(directory, 'web-gateway', {
      holdSpans: process.env.VISOMI_E2E_HOLD_SPANS === 'true',
    }),
  );
}
