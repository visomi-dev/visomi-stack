import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { stopTestPostgres } from '../../postgres';
import type { TestCompose } from '../../compose';

async function stopApplication() {
  const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

  if (!directory) {
    return;
  }

  let owner: { pid: number; parentPid: number };

  try {
    const text = await readFile(join(directory, 'owner.json'), 'utf8');

    owner = JSON.parse(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const signal = (pid: number, name: NodeJS.Signals) => {
    try {
      process.kill(pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error;
      }
    }
  };

  // Nx's continuous target owns a separate watcher; Playwright cannot close it itself.
  signal(owner.parentPid, 'SIGTERM');
  signal(owner.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      process.kill(owner.pid, 0);
    } catch {
      return;
    }
    await delay(100);
  }
  signal(owner.pid, 'SIGKILL');
}

async function stopDatabase() {
  const directory = process.env.VISOMI_E2E_TELEMETRY_DIR;

  if (!directory) {
    return;
  }

  let cluster: { directory: string; compose: TestCompose };

  try {
    const manifest = await readFile(join(directory, 'postgres.json'), 'utf8');

    cluster = JSON.parse(manifest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  await stopTestPostgres(cluster.directory, cluster.compose);
}

export default async function teardown() {
  const failures: unknown[] = [];

  try {
    await stopApplication();
  } catch (error) {
    failures.push(error);
  }

  try {
    await stopDatabase();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length) {
    throw failures[0];
  }
}
