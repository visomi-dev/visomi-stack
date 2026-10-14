import { normalize } from 'node:path';

import { start as startProjectsWorkers } from './projects';
import { startOperationWorker } from './operations/worker';
import { stopWorkerRuntime } from './worker-lifecycle';

import { logger, runMigrationsIfEnabled } from 'shared';

async function startWorkerRuntime() {
  await runMigrationsIfEnabled();

  const worker = startProjectsWorkers();
  const stopOperations = startOperationWorker();
  const stop = stopWorkerRuntime([stopOperations, () => worker.close()], {
    exit: (code) => process.exit(code),
    failed: () => logger.error({ code: 'worker_shutdown_failed' }, 'Worker shutdown failed'),
  });

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

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

export { startWorkerRuntime, startOperationWorker };
