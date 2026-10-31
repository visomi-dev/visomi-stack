import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { RequestHandler, Response } from 'express';
import helmet from 'helmet';

export function securityHeaders(options: { production?: boolean; nonce?: boolean } = {}): RequestHandler {
  const production = options.production ?? process.env['NODE_ENV'] === 'production';
  const nonceSource = (_request: unknown, response: ServerResponse) =>
    `'nonce-${(response as Response).locals['cspNonce']}'`;
  const sources = ["'self'", ...(options.nonce ? [nonceSource] : [])];
  const headers = helmet({
    contentSecurityPolicy: {
      directives: {
        styleSrc: sources,
        scriptSrc: sources,
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    // HTTPS policy must not pin local HTTP development or unrelated subdomains.
    strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: false } : false,
  });

  return (request, response, next) => {
    if (options.nonce) {
      response.locals['cspNonce'] = randomBytes(32).toString('base64');
    }

    headers(request, response, next);
  };
}
