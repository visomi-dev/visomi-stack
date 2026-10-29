import { fileURLToPath } from 'node:url';

import type { RequestHandler } from 'express';

export type SiteModule = { handler: RequestHandler; clientDirectory: string };

export function resolveSiteHandler(namespace: unknown): RequestHandler {
  if (
    !namespace ||
    typeof namespace !== 'object' ||
    !('handler' in namespace) ||
    typeof namespace.handler !== 'function'
  ) {
    throw new Error('site_module_invalid');
  }

  return namespace.handler as RequestHandler;
}

export async function loadSite(entry: URL): Promise<SiteModule> {
  if (entry.protocol !== 'file:' || !entry.pathname.endsWith('/server/entry.mjs') || entry.search || entry.hash) {
    throw new Error('site_entry_invalid');
  }

  const namespace: unknown = await import(entry.href);

  return { handler: resolveSiteHandler(namespace), clientDirectory: fileURLToPath(new URL('../client/', entry)) };
}
