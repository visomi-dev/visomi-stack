import { normalize } from 'node:path';

import { start as startProjectsWorkers } from './projects';

import { logger, runMigrationsIfEnabled } from 'shared';

async function startWorkerRuntime() {
  await runMigrationsIfEnabled();

  startProjectsWorkers();

  logger.info('Worker runtime ready');
}

function isMainModule() {
  const entryFile = process.argv[1];

  if (!entryFile) {
    return false;
  }

  return normalize(entryFile).endsWith(normalize('dist/apps/worker/main.js')) || require.main === module;
}

if (isMainModule()) {
  startWorkerRuntime().catch((error: unknown) => {
    logger.error({ error }, 'Failed to bootstrap worker runtime');
    process.exit(1);
  });
}

export { startWorkerRuntime };
