import { createServer } from 'node:http';

import {
  createDatabase,
  createRedisRealtimeTransport,
  subscribeRealtime,
  type Database,
  type DatabaseResource,
  type RealtimeRuntime,
  type RealtimeTransport,
} from '@visomi-stack/backend-shared';
import type { Pool } from 'pg';

import { attachRealtimeServer, type RealtimeAccess } from './app';

type AuthApi = {
  authConfig(input: { origin: string; rpId: string; secret: string }): unknown;
  createAuthentication(input: { database: Database; pool: Pool; config: unknown }): { realtime: RealtimeAccess };
};

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
let database: DatabaseResource | undefined;
let transport: RealtimeTransport | undefined;
let realtime: RealtimeRuntime | undefined;
let stopping = false;

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');

    return;
  }

  response.writeHead(404).end();
});

async function stop(failed = false): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  transport?.close();

  try {
    if (realtime) {
      await realtime.close();
    } else {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await database?.close();

    process.exitCode = failed ? 1 : 0;
  }
}

function stopRuntime(failed: boolean): void {
  void stop(failed).catch(() => {
    process.exitCode = 1;
  });
}

async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REALTIME_REDIS_URL;

  if (!Number.isInteger(port) || port < 0 || port > 65535 || Boolean(databaseUrl) !== Boolean(redisUrl)) {
    throw new Error('realtime_configuration_invalid');
  }

  if (databaseUrl && redisUrl) {
    const api: AuthApi = await import(new URL('../api/app.js', import.meta.url).href);

    if (stopping) {
      return;
    }

    const config = api.authConfig({
      origin: process.env.AUTH_ORIGIN!,
      rpId: process.env.AUTH_RP_ID!,
      secret: process.env.SESSION_SECRET!,
    });

    database = createDatabase(databaseUrl, () => console.error('realtime_database_unavailable'));
    transport = createRedisRealtimeTransport(redisUrl, () => console.error('realtime_transport_unavailable'));

    await database.pool.query('SELECT 1');

    if (stopping) {
      return;
    }

    const auth = api.createAuthentication({ database: database.db, pool: database.pool, config });

    realtime = attachRealtimeServer(server, auth.realtime);

    await subscribeRealtime(transport, realtime);
  }

  if (!stopping) {
    server.listen(port, host);
  }
}

process.once('SIGINT', () => stopRuntime(false));
process.once('SIGTERM', () => stopRuntime(false));
server.once('error', () => stopRuntime(true));

void bootstrap().catch(() => {
  console.error('realtime_startup_failed');
  stopRuntime(true);
});
