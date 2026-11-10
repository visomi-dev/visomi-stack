import type { Server } from 'node:http';

import type { RealtimeRuntime } from '@visomi-stack/backend-shared';

import type { EmbeddedAuthentication } from './api-module';

type RealtimeModule = {
  attachRealtimeServer(server: Server, access: NonNullable<EmbeddedAuthentication['realtime']>): RealtimeRuntime;
};

export async function loadRealtime(entry: URL): Promise<RealtimeModule> {
  return import(entry.href);
}
