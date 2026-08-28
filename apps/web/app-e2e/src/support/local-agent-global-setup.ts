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

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(readyUrl)).ok) return async () => stopProcess(processHandle);
    } catch {
      await sleep(100);
    }
  }

  processHandle.kill('SIGTERM');
  throw new Error('themis-agent bridge process did not become ready');
}

async function stopProcess(processHandle: ChildProcess): Promise<void> {
  processHandle.kill('SIGTERM');
  await new Promise<void>((resolve) => processHandle.once('exit', () => resolve()));
}
