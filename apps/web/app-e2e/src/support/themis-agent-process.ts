import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { workspaceRoot } from '@nx/devkit';

import { startLocalAgentFixture } from './local-agent-fixture.ts';

const port = Number(process.env['LOCAL_AGENT_PROCESS_PORT'] ?? 4318);
const logPath = process.env['LOCAL_AGENT_PROCESS_LOG'];

if (logPath) mkdirSync(logPath.slice(0, logPath.lastIndexOf('/')), { recursive: true });

const server = await startLocalAgentFixture({
  port,
  logPath,
  dynamicScope: true,
  themisStatePath:
    process.env['THEMIS_PROJECT_STATE_PATH'] ?? path.join(workspaceRoot, '.themis/fixtures/sample-workflow.json'),
});

process.stdout.write(`${JSON.stringify({ event: 'process.started', pid: process.pid, port })}\n`);

const shutdown = async (signal: string): Promise<void> => {
  process.stdout.write(`${JSON.stringify({ event: 'process.stopping', signal })}\n`);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  process.stdout.write(`${JSON.stringify({ event: 'process.stopped' })}\n`);
};

process.once('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));
process.once('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
