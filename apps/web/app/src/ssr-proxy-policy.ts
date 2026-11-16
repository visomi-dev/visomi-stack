import type { IncomingMessage } from 'node:http';

/**
 * The ingress terminates TLS before Node. Configure Angular's official adapter,
 * independently of Express's client-IP policy. A canonical origin guard limits
 * the URL even for direct private-network callers; it is not proof of peer identity.
 */
export function createSsrProxyPolicy(environment: NodeJS.ProcessEnv) {
  if (environment['NODE_ENV'] !== 'production') {
    return undefined;
  }

  const configuredOrigin = environment['AUTH_ORIGIN'];

  // Production builds also run standalone and in local browser/container tests.
  // No public origin means no proxy trust, not an invented ingress boundary.
  if (!configuredOrigin) {
    return undefined;
  }

  let origin: URL;

  try {
    origin = new URL(configuredOrigin);
  } catch {
    throw new Error('ssr_public_origin_invalid');
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);

  if (
    loopback &&
    origin.protocol === 'http:' &&
    !origin.username &&
    !origin.password &&
    origin.pathname === '/' &&
    !origin.search &&
    !origin.hash
  ) {
    return undefined;
  }

  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    loopback
  ) {
    throw new Error('ssr_public_origin_invalid');
  }

  return {
    // Do not trust Forwarded, arbitrary X-Forwarded-* or client-IP claims.
    // Network identity is removed only from the separate Angular request.
    engineOptions: { trustProxyHeaders: ['x-forwarded-host', 'x-forwarded-proto'] },
    accepts(request: Pick<IncomingMessage, 'headers' | 'rawHeaders'>) {
      for (const [name, expected] of [
        ['host', origin.host],
        ['x-forwarded-host', origin.host],
        ['x-forwarded-proto', 'https'],
      ]) {
        const occurrences = request.rawHeaders.filter(
          (_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === name,
        ).length;

        // Exact single values reject comma lists, duplicate fields, foreign ports,
        // userinfo, path material and insecure schemes. Never rewrite headers.
        if (occurrences !== 1 || request.headers[name] !== expected) {
          return false;
        }
      }

      return true;
    },
  };
}
