import type { RequestHandler } from 'express';
import helmet from 'helmet';

export function securityHeaders(options: { production?: boolean } = {}): RequestHandler {
  const production = options.production ?? process.env.NODE_ENV === 'production';

  return helmet({
    contentSecurityPolicy: {
      directives: {
        styleSrc: ["'self'"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    // HTTPS policy must not pin local HTTP development or unrelated subdomains.
    strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: false } : false,
  });
}
