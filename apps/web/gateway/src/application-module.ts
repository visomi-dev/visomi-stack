import type { Observability } from '@visomi-stack/web-backend-shared';
import type { Request, RequestHandler } from 'express';

export type AuthSnapshot = {
  authenticated: boolean;
  user: { id: string; email: string | null; emailVerified: boolean } | null;
  access: 'anonymous' | 'unverified' | 'full' | 'recovery' | 'enrollment';
  method: 'passkey' | 'password' | 'google' | 'recovery' | 'device' | null;
  nextStep: 'verify_email' | 'add_email' | 'enroll_method' | null;
};

export type ApplicationModule = {
  createApp(options: {
    observability?: Observability;
    errorMode: 'inherited';
    helmetMode: 'inherited';
    trustProxy?: string[];
    authContext?: (request: Request) => { available: boolean; session: AuthSnapshot | null };
  }): RequestHandler;
  clientDirectory: string;
};

export function resolveApplicationModule(namespace: unknown): ApplicationModule {
  if (
    !namespace ||
    typeof namespace !== 'object' ||
    !('createApp' in namespace) ||
    typeof namespace.createApp !== 'function' ||
    !('clientDirectory' in namespace) ||
    typeof namespace.clientDirectory !== 'string'
  ) {
    throw new Error('application_module_invalid');
  }

  return namespace as ApplicationModule;
}

export async function loadApplication(entry: URL): Promise<ApplicationModule> {
  if (entry.protocol !== 'file:' || !entry.pathname.endsWith('/server/server.mjs') || entry.search || entry.hash) {
    throw new Error('application_entry_invalid');
  }

  const namespace: unknown = await import(entry.href);
  const application = resolveApplicationModule(namespace);

  return application;
}
