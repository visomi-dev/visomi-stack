const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Only the owning application process installs test exporters, never Nx or its watchers.
const entry = process.argv[1]?.replaceAll('\\', '/');
const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

if (directory && /\/api\/(src\/)?main\.(ts|js)$/.test(entry ?? '')) {
  require('tsx/cjs');
  const { initializeObservability } = require('../../../../../libs/web/backend/shared/src/index');
  const { createTelemetryOptions } = require('../../../../../e2e/support/telemetry-exporters.cjs');

  writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, parentPid: process.ppid }));
  initializeObservability(
    createTelemetryOptions(directory, 'web-api', {
      holdSpans: process.env.VISOMI_E2E_HOLD_SPANS === 'true',
    }),
  );
}
