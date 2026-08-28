import { normalize } from 'node:path';

import { attachRealtimeServer, createRealtimeServer } from './shared/socket-server';
import { startRealtime } from './projects/project-seed';

import { logger, runMigrationsIfEnabled } from 'shared';

const host = process.env.HOST ?? '127.0.0.1';

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

async function bootstrap() {
  await runMigrationsIfEnabled();
  const { io, server } = await createRealtimeServer();

  await startRealtime(io);

  server.listen(port, host, () => {
    logger.info({ host, port }, 'Realtime server listening');
  });
}

function isMainModule() {
  const entryFile = process.argv[1];

  if (!entryFile) {
    return false;
  }

  return normalize(entryFile).endsWith(normalize('dist/apps/web/realtime/main.js')) || require.main === module;
}

if (isMainModule()) {
  bootstrap().catch((error: unknown) => {
    logger.error({ error }, 'Failed to bootstrap realtime runtime');
    process.exit(1);
  });
}

export { attachRealtimeServer };
