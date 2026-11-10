import type { Database, MailTransport, RealtimePublisher } from '@visomi-stack/backend-shared';
import type { Observability } from '@visomi-stack/web-backend-shared';
import type { Request, RequestHandler } from 'express';
import type { Pool } from 'pg';

import type { AuthSnapshot } from './application-module';

// The gateway depends on the compiled public surface, not API source or auth internals.
export type EmbeddedAuthentication = {
  middleware: RequestHandler[];
  snapshot?: (request: Request) => AuthSnapshot;
  googleEnabled?: boolean;
  realtime?: {
    origin: string;
    readSession: RequestHandler;
    readUser(serialized: unknown): Promise<string | null>;
    watchExpiration(sessionId: string, requestId: string): Promise<number>;
  };
};
export type ApiModule = {
  createApp(options: {
    observability?: Observability;
    basePath?: string;
    auth?: EmbeddedAuthentication;
    authMode: 'inherited';
    errorMode: 'inherited';
    helmetMode: 'inherited';
  }): RequestHandler;
  authConfig(input: {
    origin: string;
    rpId: string;
    secret: string;
    googleClientId?: string;
    totpKey?: string;
  }): unknown;
  createAuthentication(input: {
    database: Database;
    pool: Pool;
    config: unknown;
    mail?: MailTransport;
    realtimePublisher?: RealtimePublisher;
  }): EmbeddedAuthentication;
};

export function resolveApiModule(namespace: unknown): ApiModule {
  if (!namespace || typeof namespace !== 'object') {
    throw new Error('api_module_invalid');
  }

  const candidate = 'default' in namespace ? namespace.default : namespace;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('createApp' in candidate) ||
    typeof candidate.createApp !== 'function' ||
    !('authConfig' in candidate) ||
    typeof candidate.authConfig !== 'function' ||
    !('createAuthentication' in candidate) ||
    typeof candidate.createAuthentication !== 'function'
  ) {
    throw new Error('api_module_invalid');
  }

  return candidate as ApiModule;
}

export async function loadApi(entry: URL): Promise<ApiModule> {
  if (entry.protocol !== 'file:' || !entry.pathname.endsWith('/app.js') || entry.search || entry.hash) {
    throw new Error('api_entry_invalid');
  }

  const namespace: unknown = await import(entry.href);

  return resolveApiModule(namespace);
}
