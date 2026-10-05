import express, { type RequestHandler } from 'express';
import { MemoryStore } from 'express-session';
import request from 'supertest';

import { createGatewayApp } from './gateway';

import { createSessionMiddleware } from 'shared';

describe('createGatewayApp', () => {
  const createDeps = () => {
    const apiHandler = express();

    apiHandler.get('/hello', (_req, res) => {
      res.send({ message: 'hello' });
    });

    const angularHandler = express();

    angularHandler.get('/sign-in', (_req, res) => {
      res.type('html').send('<base href="/app/en/" /><app-root></app-root>');
    });

    const astroRequestHandler = (_req: express.Request, res: express.Response) => {
      res.type('html').send('<main>Themis</main>');
    };

    return {
      apiHandler,
      angularHandler,
      astroClientFolder: __dirname,
      astroRequestHandler,
      authRuntimeHandlers: [((_req, _res, next) => next()) satisfies RequestHandler],
    };
  };

  it('exposes the health endpoint', async () => {
    const app = createGatewayApp(createDeps());

    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it.each([0, 1])('only issues secure session cookies through configured proxy hops: %s', async (trustProxyHops) => {
    const middleware = createSessionMiddleware(
      {
        cookieSecure: true,
        databaseDriver: 'memory',
        sessionMaxAgeMs: 60_000,
        sessionSecret: 'gateway-proxy-regression-session-secret',
      },
      new MemoryStore(),
    );
    const initializeSession: RequestHandler = (req, _res, next) => {
      Object.assign(req.session, { probe: true });
      next();
    };
    const app = createGatewayApp({
      ...createDeps(),
      trustProxyHops,
      authRuntimeHandlers: [middleware, initializeSession],
    });
    const response = await request(app).get('/healthz').set('X-Forwarded-Proto', 'https');
    const cookies = response.headers['set-cookie'];

    expect(response.status).toBe(200);

    if (trustProxyHops === 1) {
      expect(cookies).toEqual([expect.stringContaining('; Secure')]);
    } else {
      expect(cookies).toBeUndefined();
    }

    const plainResponse = await request(app).get('/healthz');

    expect(plainResponse.headers['set-cookie']).toBeUndefined();
  });

  it('exposes a readiness endpoint only after the gateway dependencies are mounted', async () => {
    const response = await request(createGatewayApp(createDeps())).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('fails readiness closed while a composed dependency is bootstrapping', async () => {
    const response = await request(
      createGatewayApp({
        ...createDeps(),
        readiness: { isReady: () => false },
      }),
    ).get('/readyz');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
  });

  it('redirects the root path to the english site', async () => {
    const app = createGatewayApp(createDeps());

    const response = await request(app).get('/');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/en/');
  });

  it('mounts the api and angular handlers on their prefixes', async () => {
    const app = createGatewayApp(createDeps());

    const apiResponse = await request(app).get('/api/hello');

    const angularResponse = await request(app).get('/app/sign-in');

    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body).toEqual({ message: 'hello' });
    expect(angularResponse.status).toBe(200);
    expect(angularResponse.text).toContain('<app-root>');
  });

  it.each([
    'ngsw-worker.js',
    'ngsw.json?ngsw-cache-bust=1',
    'index.csr.html',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'media/font.woff2',
  ])('serves public PWA asset %s without session initialization', async (asset) => {
    const deps = createDeps();
    const session = jest
      .fn<ReturnType<RequestHandler>, Parameters<RequestHandler>>()
      .mockImplementation((_req, res, next) => {
        res.cookie('probe', 'session');
        next();
      });
    const handler = express();

    handler.use((_req, res) => res.status(200).send('public asset'));
    const app = createGatewayApp({ ...deps, angularHandler: handler, authRuntimeHandlers: [session] });
    const response = await request(app).get(`/app/en/${asset}`);

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(session).not.toHaveBeenCalled();
    await request(app).get('/api/hello');
    expect(session).toHaveBeenCalledTimes(1);
  });

  it('honors the configured default locale before delegating to Astro', async () => {
    const response = await request(createGatewayApp({ ...createDeps(), defaultLocale: 'es' })).get('/');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/es/');
  });

  it('mounts the authenticated same-origin local-agent boundary without using the cloud API', async () => {
    const deps = createDeps();
    const localAgentHandler = express();

    localAgentHandler.get('/projects/project-1', (req, res) => {
      res.send({ cookie: req.headers.cookie ?? null });
    });
    const app = createGatewayApp({ ...deps, localAgentHandler });

    const response = await request(app)
      .get('/v1/product-visibility/projects/project-1')
      .set('Cookie', 'sid=authenticated-session');

    expect(response.status).toBe(200);

    expect(response.body).toEqual({ cookie: 'sid=authenticated-session' });
  });

  it('sets gateway security headers with same-origin connect policy', async () => {
    const app = createGatewayApp(createDeps());

    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers['content-security-policy']).toContain("script-src-attr 'unsafe-inline'");
    expect(response.headers['content-security-policy']).toContain('https://accounts.google.com/gsi/style');
    expect(response.headers['content-security-policy']).toContain("object-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('permits embedded WASM only in the dedicated PIN worker and denies its network access', async () => {
    const handler = express();

    handler.use((_req, res) => res.status(200).send('asset'));
    const app = createGatewayApp({ ...createDeps(), angularHandler: handler });

    for (const locale of ['en', 'es']) {
      const response = await request(app).get(`/app/${locale}/vault-pin-worker.js`);

      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'",
      );
    }
    for (const path of ['/healthz', '/app/en/main.js', '/app/en/not-vault-pin-worker.js', '/app/en/sign-in']) {
      const response = await request(app).get(path);

      expect(response.headers['content-security-policy']).not.toContain("'wasm-unsafe-eval'");
      expect(response.headers['content-security-policy']).not.toContain("'unsafe-eval'");
    }
  });
});
