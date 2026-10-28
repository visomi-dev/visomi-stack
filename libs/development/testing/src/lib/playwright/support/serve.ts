import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runTestCompose } from '../../compose';
import type { TestCompose } from '../../compose';
import { testPostgres } from '../../postgres';

export async function serveTestApplication(app: TestCompose['app']) {
  const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

  if (!directory) {
    throw new Error('isolated_telemetry_directory_required');
  }

  const controller = new AbortController();
  let postgres: Awaited<ReturnType<typeof testPostgres>> | undefined;
  let resolveStopped: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = () => {
    controller.abort();
    resolveStopped();
  };
  // Detached containers do not keep Node's event loop alive while Playwright owns this wrapper.
  const keepAlive = setInterval(() => undefined, 1000);

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    const resource = await testPostgres(join(directory, 'postgres.json'), app, controller.signal);

    postgres = resource;
    controller.signal.throwIfAborted();

    await writeFile(join(directory, 'database.json'), JSON.stringify({ url: postgres.url }));

    await runTestCompose(postgres.compose, ['build', 'database-init', 'app'], controller.signal);

    // Await successful initialization explicitly; some Compose providers mishandle one-shot dependencies.
    await runTestCompose(postgres.compose, ['run', '--rm', '--no-deps', 'database-init'], controller.signal);

    await runTestCompose(postgres.compose, ['up', '-d', '--no-deps', 'app'], controller.signal);

    await stopped;
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    clearInterval(keepAlive);

    await postgres?.stop();
  }
}
