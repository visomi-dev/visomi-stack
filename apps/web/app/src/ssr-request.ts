import type { IncomingMessage } from 'node:http';

import { createWebRequestFromNodeRequest } from '@angular/ssr/node';

// Rendering needs the canonical URL and request-scoped credentials, not network identity.
const networkIdentityHeaders = [
  'forwarded',
  'x-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'true-client-ip',
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'cf-pseudo-ipv4',
  'cf-ipcountry',
  'fastly-client-ip',
  'fly-client-ip',
];

export function createSsrRequest(request: IncomingMessage, trustProxyHeaders: string[] = []) {
  // The official adapter preserves method, streaming body, original URL and cancellation.
  // Its Headers instance is independent of Express headers/rawHeaders and socket state.
  const renderedRequest = createWebRequestFromNodeRequest(request, trustProxyHeaders);

  for (const header of networkIdentityHeaders) {
    renderedRequest.headers.delete(header);
  }

  return renderedRequest;
}
