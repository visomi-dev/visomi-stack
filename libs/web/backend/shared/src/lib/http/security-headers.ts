import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { RequestHandler, Response } from 'express';
import helmet from 'helmet';

export function securityHeaders(
  options: { production?: boolean; nonce?: boolean; google?: boolean } = {},
): RequestHandler {
  const production = options.production ?? process.env['NODE_ENV'] === 'production';
  const nonceSource = (_request: unknown, response: ServerResponse) =>
    `'nonce-${(response as Response).locals['cspNonce']}'`;
  const sources = ["'self'", ...(options.nonce ? [nonceSource] : [])];
  const headers = helmet({
    contentSecurityPolicy: {
      directives: {
        styleSrc: [...sources, ...(options.google ? ['https://accounts.google.com/gsi/style'] : [])],
        scriptSrc: [...sources, ...(options.google ? ['https://accounts.google.com/gsi/client'] : [])],
        ...(options.google
          ? {
              connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
              frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
            }
          : {}),
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    // HTTPS policy must not pin local HTTP development or unrelated subdomains.
    strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: false } : false,
    ...(options.google
      ? {
          crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' as const },
          // GIS checks the embedding origin; never disclose a document's path or query.
          referrerPolicy: { policy: 'strict-origin' as const },
        }
      : {}),
  });

  return (request, response, next) => {
    if (options.nonce) {
      response.locals['cspNonce'] = randomBytes(32).toString('base64');
    }

    headers(request, response, next);
  };
}
