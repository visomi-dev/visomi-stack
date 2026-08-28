import express, {
  type RequestHandler,
  static as serveStatic,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';

import { logger } from 'shared';

type AstroRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

type GatewayDeps = {
  apiHandler: RequestHandler;
  angularHandler: RequestHandler;
  astroClientFolder: string;
  astroRequestHandler: AstroRequestHandler;
  authRuntimeHandlers: RequestHandler[];
  localAgentHandler?: RequestHandler;
  localAgentFixtureControl?: RequestHandler;
  readiness?: {
    isReady: () => boolean;
  };
};

const gatewaySecurityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  },
});

function createGatewayApp({
  angularHandler,
  apiHandler,
  astroClientFolder,
  astroRequestHandler,
  authRuntimeHandlers,
  localAgentHandler,
  localAgentFixtureControl,
  readiness,
}: GatewayDeps) {
  const app = express();

  app.use(gatewaySecurityHeaders);
  app.use(...authRuntimeHandlers);
  app.get('/healthz', (_req, res) => {
    res.send({ status: 'ok' });
  });
  app.get('/readyz', (_req, res) => {
    if (readiness && !readiness.isReady()) {
      res.status(503).send({ status: 'not_ready' });

      return;
    }

    res.send({ status: 'ready' });
  });
  app.get('/', (_req, res) => {
    res.redirect(302, '/en/');
  });

  // This same-origin route is the only browser path to protected local-agent
  // views. It preserves the authenticated request/handshake while preventing
  // the cloud API from becoming a plaintext visibility fallback.
  if (localAgentHandler) {
    app.use('/v1/browser-vault', localAgentHandler);
    app.use('/v1/product-visibility', localAgentHandler);
    app.use('/v1/local-agent', localAgentHandler);
  }

  if (localAgentFixtureControl) {
    app.use('/__fixture__/local-agent', localAgentFixtureControl);
  }

  app.use('/api', apiHandler);

  logger.info({ path: '/api' }, 'API Mounted');

  app.use('/app', angularHandler);

  logger.info({ path: '/app' }, 'App Mounted');

  app.use(
    serveStatic(astroClientFolder, {
      index: false,
      maxAge: '1y',
      redirect: false,
    }),
  );
  app.use((req, res, next) => astroRequestHandler(req, res, next));

  logger.info({ path: '/' }, 'Site Mounted');

  return app;
}

export { createGatewayApp };
export type { GatewayDeps };
