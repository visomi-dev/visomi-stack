import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export default async function teardown() {
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
