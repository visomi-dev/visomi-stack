import { spawn, type ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { createGatewayApp } from './gateway';
import { DurableReplayStore } from './durable-replay-store';
import { createLocalAgentProxy, publicKeyFromPem } from './local-agent-proxy';
import { resolveGatewayPort } from './runtime-config';

import { createAuthRuntimeMiddleware, logger } from 'shared';

type ApiModule = {
  appPromise?: Promise<Express>;
  createEmbeddedApp?: () => Promise<Express>;
};

type RealtimeModule = {
  attachRealtimeServer?: (server: ReturnType<Express['listen']>) => Promise<unknown>;
};

type AngularModule = {
  reqHandler?: RequestHandler;
};

type AstroMiddlewareModule = {
  handler?: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
};

const host = process.env.HOST ?? '0.0.0.0';

type UpgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => void;

type AngularHandler = RequestHandler & {
  upgrade?: UpgradeHandler;
};

const port = resolveGatewayPort();

const appDevServerUrl = process.env.APP_DEV_SERVER_URL;
const localAgentUrl = process.env.LOCAL_AGENT_URL ?? 'http://localhost:4317';

function createLocalAgentFixtureControl(target: URL): RequestHandler {
  return async (req, res) => {
    const state = req.path.split('/').filter(Boolean).pop();
    const controlPath = req.path.includes('/network') ? '/__fixture__/network' : '/__fixture__/sync-phase';

    try {
      const response = await fetch(new URL(`${target.toString().replace(/\/$/, '')}${controlPath}`), {
        body: JSON.stringify(req.path.includes('/network') ? { state } : { phase: state }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      res.status(response.status).end();
    } catch {
      res.status(503).send('fixture control unavailable');
    }
  };
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));

const apiEntryFile = resolve(serverDistFolder, '..', 'api', 'main.js');

const angularEntryFile = resolve(serverDistFolder, '..', 'app', 'server', 'server.mjs');

const astroClientFolder = resolve(serverDistFolder, '..', 'site', 'client');

const astroEntryFile = resolve(serverDistFolder, '..', 'site', 'server', 'entry.mjs');

const realtimeEntryFile = resolve(serverDistFolder, '..', 'realtime', 'main.js');

const workerEntryFile = resolve(serverDistFolder, '..', '..', 'worker', 'main.js');

let workerProcess: ChildProcess | undefined;

let httpServer: ReturnType<Express['listen']> | undefined;

let shuttingDown = false;

function startWorkerRuntime() {
  workerProcess = spawn(process.execPath, [workerEntryFile], {
    env: process.env,
    stdio: 'inherit',
  });

  workerProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;

    logger.error({ reason }, 'Worker process exited');

    process.exit(code ?? 1);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const exit = () => process.exit(0);
  const timer = setTimeout(exit, 10_000);

  timer.unref();

  let serverClosed = !httpServer;
  let workerClosed = !workerProcess || workerProcess.exitCode !== null;
  const finish = () => {
    if (serverClosed && workerClosed) {
      clearTimeout(timer);
      exit();
    }
  };

  workerProcess?.once('exit', () => {
    workerClosed = true;
    finish();
  });
  workerProcess?.kill('SIGTERM');
  httpServer?.close(() => {
    serverClosed = true;
    finish();
  });
  finish();
}

function failBootstrap(error: unknown): void {
  logger.error({ err: error }, 'Failed to bootstrap gateway server');
  // The worker is started before the gateway begins listening. If listen fails
  // (most commonly because a stale gateway still owns the configured port),
  // the parent process can exit while the child remains alive and poisons the
  // next Playwright webServer attempt. Always tear down the child first.
  shutdown();
}

async function loadApiApp() {
  const apiModule = (await import(pathToFileURL(apiEntryFile).href)) as ApiModule;

  if (typeof apiModule.createEmbeddedApp !== 'function') {
    throw new Error(`Could not load the API app from '${apiEntryFile}'.`);
  }

  return apiModule.createEmbeddedApp();
}

async function loadRealtimeAttacher() {
  const realtimeModule = (await import(pathToFileURL(realtimeEntryFile).href)) as RealtimeModule;

  if (typeof realtimeModule.attachRealtimeServer !== 'function') {
    throw new Error(`Could not load the realtime attacher from '${realtimeEntryFile}'.`);
  }

  return realtimeModule.attachRealtimeServer;
}

async function loadAstroRequestHandler() {
  const astroModule = (await import(pathToFileURL(astroEntryFile).href)) as AstroMiddlewareModule;

  if (typeof astroModule.handler !== 'function') {
    throw new TypeError(`Could not load the Astro request handler from '${astroEntryFile}'.`);
  }

  return astroModule.handler;
}

async function loadAngularHandler(): Promise<AngularHandler> {
  if (appDevServerUrl) {
    const proxy = createProxyMiddleware({
      changeOrigin: true,
      target: appDevServerUrl,
      ws: true,
      xfwd: true,
    }) as AngularHandler;

    logger.info({ target: appDevServerUrl }, 'Angular dev server proxy enabled');

    return proxy;
  }

  const angularModule = (await import(pathToFileURL(angularEntryFile).href)) as AngularModule;

  if (!angularModule.reqHandler) {
    throw new Error(`Could not load the Angular request handler from '${angularEntryFile}'.`);
  }

  return angularModule.reqHandler as AngularHandler;
}

async function bootstrap() {
  const readiness = { ready: false };
  const [apiHandler, angularHandler, astroRequestHandler, attachRealtimeServer] = await Promise.all([
    loadApiApp(),
    loadAngularHandler(),
    loadAstroRequestHandler(),
    loadRealtimeAttacher(),
  ]);

  startWorkerRuntime();

  const localAgentPublicKey = publicKeyFromPem(process.env.LOCAL_AGENT_PUBLIC_KEY);
  const localAgentTarget = new URL(localAgentUrl);

  const app = createGatewayApp({
    apiHandler,
    angularHandler,
    astroClientFolder,
    astroRequestHandler,
    authRuntimeHandlers: createAuthRuntimeMiddleware(),
    localAgentHandler: localAgentPublicKey
      ? createLocalAgentProxy({
          publicKey: localAgentPublicKey,
          replayStore: new DurableReplayStore(),
          target: localAgentTarget,
        })
      : (_req, res) => {
          res
            .status(503)
            .json({ code: 'local_agent_unconfigured', message: 'The protected visibility agent is not configured.' });
        },
    localAgentFixtureControl:
      process.env.ENABLE_TEST_API === 'true' ? createLocalAgentFixtureControl(localAgentTarget) : undefined,
    readiness: {
      isReady: () => readiness.ready,
    },
  });

  httpServer = app.listen(port, host, () => {
    logger.info({ host, port }, 'Gateway server ready');
  });

  if (angularHandler.upgrade) {
    httpServer.on('upgrade', (req, socket, head) => {
      if (req.url?.startsWith('/app/')) {
        angularHandler.upgrade?.(req, socket as Socket, head);
      }
    });
  }

  await attachRealtimeServer(httpServer);
  readiness.ready = true;
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap().catch((error: unknown) => {
  failBootstrap(error);
});
