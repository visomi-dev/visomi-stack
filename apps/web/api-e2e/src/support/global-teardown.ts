import { readFile, rm } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import { stopGateway } from './gateway-process';

const SERVER_PID_PATH = resolve(__dirname, '../../.api-e2e-server.pid');

const teardownState = globalThis as typeof globalThis & {
  __TEARDOWN_MESSAGE__?: string;
  __API_E2E_GATEWAY__?: ChildProcess;
};

module.exports = async function () {
  const child = teardownState.__API_E2E_GATEWAY__;

  if (!child) throw new Error('The API E2E fixture has no owned gateway to stop; refusing a stale PID file.');
  await stopGateway(child);
  delete teardownState.__API_E2E_GATEWAY__;
  try {
    const pid = Number((await readFile(SERVER_PID_PATH, 'utf8')).trim());

    // Concurrent isolated runs may have replaced the diagnostic file. Never remove theirs.
    if (pid === child.pid) await rm(SERVER_PID_PATH, { force: true });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== 'ENOENT' && nodeError.code !== 'ESRCH') {
      throw error;
    }
  }

  console.log(teardownState.__TEARDOWN_MESSAGE__ ?? '\nTearing down...\n');
};
