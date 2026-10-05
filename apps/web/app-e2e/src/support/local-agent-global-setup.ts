import { mkdirSync, openSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { FullConfig } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

export default async function globalSetup(_config: FullConfig) {
  const reportDir = path.join(workspaceRoot, 'playwright-report/agent-bridge');
  const port = process.env['LOCAL_AGENT_PROCESS_PORT'] ?? '4318';
  const readyUrl = `http://127.0.0.1:${port}/__fixture__/ready`;

  mkdirSync(reportDir, { recursive: true });
  const occupied = await fetch(readyUrl, { signal: AbortSignal.timeout(1000) }).then(
    (response) => response.ok,
    () => false,
  );

  if (occupied) throw new Error(`Local-agent fixture port ${port} is already occupied.`);
  const processHandle: ChildProcess = spawn(
    process.execPath,
    ['--experimental-strip-types', path.join(workspaceRoot, 'apps/web/app-e2e/src/support/themis-agent-process.ts')],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        LOCAL_AGENT_PROCESS_PORT: port,
        LOCAL_AGENT_PROCESS_LOG: path.join(reportDir, 'bridge.ndjson'),
      },
      stdio: [
        'ignore',
        openSync(path.join(reportDir, 'process.stdout.log'), 'w'),
        openSync(path.join(reportDir, 'process.stderr.log'), 'w'),
      ],
    },
  );
  const exited = new Promise<void>((resolve) => {
    processHandle.once('exit', () => resolve());
    processHandle.once('error', () => resolve());
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error('Local-agent fixture exited before becoming ready. Inspect its process logs.');
    }
    try {
      if ((await fetch(readyUrl, { signal: AbortSignal.timeout(1000) })).ok) {
        if (processHandle.exitCode === null && processHandle.signalCode === null) {
          return async () => stopProcess(processHandle, exited);
        }
      }
    } catch {
      await sleep(100);
    }
  }

  await stopProcess(processHandle, exited);
  throw new Error('themis-agent bridge process did not become ready');
}

async function stopProcess(processHandle: ChildProcess, exited: Promise<void>): Promise<void> {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  processHandle.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]);

  if (!stopped) {
    processHandle.kill('SIGKILL');
    await exited;
  }
}
