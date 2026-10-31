import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  signals: new Map<string, () => void>(),
  events: new Map<string, () => void>(),
  server: { once: vi.fn(), on: vi.fn(), listen: vi.fn(), close: vi.fn(), closeAllConnections: vi.fn() },
  observability: { event: vi.fn(), shutdown: vi.fn() },
  database: { db: {}, pool: { query: vi.fn() }, close: vi.fn() },
  api: { authConfig: vi.fn(), createAuthentication: vi.fn(), createApp: vi.fn() },
  auth: { middleware: [] },
  initialize: vi.fn(),
  createDatabase: vi.fn(),
  smtpConfig: vi.fn(),
  createSmtp: vi.fn(),
  smtp: { send: vi.fn(), close: vi.fn() },
  createServer: vi.fn(),
  createGatewayApp: vi.fn(),
  loadApi: vi.fn(),
  loadSite: vi.fn(),
  browserAssets: vi.fn(),
  browserTelemetry: vi.fn(),
  closeBrowserTelemetry: vi.fn(),
  site: { handler: vi.fn(), clientDirectory: '/synthetic/site/client' },
  ready: vi.fn(),
}));

vi.mock('node:http', () => ({ createServer: boundary.createServer }));
vi.mock('@visomi-stack/web-backend-shared', () => ({
  initializeObservability: boundary.initialize,
  browserAssets: boundary.browserAssets,
  createBrowserTelemetry: boundary.browserTelemetry,
}));
vi.mock('@visomi-stack/backend-shared', () => ({
  createDatabase: boundary.createDatabase,
  smtpConfig: boundary.smtpConfig,
  createSmtp: boundary.createSmtp,
}));
vi.mock('./api-module', () => ({ loadApi: boundary.loadApi }));
vi.mock('./site-module', () => ({ loadSite: boundary.loadSite }));
vi.mock('./app', () => ({ createGatewayApp: boundary.createGatewayApp }));
vi.mock('@nx/js/ready-signal', () => ({ emitReadySignal: boundary.ready }));

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('API_APP_PATH', '/synthetic/compiled/api/app.js');
  vi.stubEnv('SITE_APP_PATH', '/synthetic/compiled/site/server/entry.mjs');
  vi.stubEnv('AUTH_TRUST_PROXY', '');
  vi.stubEnv('HOST', '127.0.0.1');
  vi.stubEnv('PORT', '3456');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NX_READY_SIGNAL_SOCKET', '');
  vi.stubEnv('VISOMI_BROWSER_TELEMETRY', '');
  vi.stubEnv('BROWSER_TELEMETRY_ORIGIN', undefined);
  boundary.browserAssets.mockResolvedValue(new Map());
  boundary.browserTelemetry.mockReturnValue({
    context: 'synthetic-context',
    router: 'synthetic-router',
    close: boundary.closeBrowserTelemetry,
  });
  boundary.signals.clear();
  boundary.events.clear();
  boundary.initialize.mockReturnValue(boundary.observability);
  boundary.createDatabase.mockReturnValue(boundary.database);
  boundary.smtpConfig.mockReturnValue(undefined);
  boundary.createSmtp.mockReturnValue(boundary.smtp);
  boundary.smtp.close.mockImplementation(() => undefined);
  boundary.database.pool.query.mockResolvedValue({ rows: [] });
  boundary.database.close.mockResolvedValue(undefined);
  boundary.observability.shutdown.mockResolvedValue(true);
  boundary.api.authConfig.mockReturnValue({});
  boundary.api.createAuthentication.mockReturnValue(boundary.auth);
  boundary.loadApi.mockResolvedValue(boundary.api);
  boundary.loadSite.mockResolvedValue(boundary.site);
  boundary.createGatewayApp.mockReturnValue('synthetic-app');
  boundary.createServer.mockReturnValue(boundary.server);
  boundary.server.once.mockImplementation((name, callback) => boundary.events.set(name, callback));
  boundary.server.close.mockImplementation((callback) => callback());
  vi.spyOn(process, 'once').mockImplementation((name, callback) => {
    boundary.signals.set(String(name), callback as () => void);

    return process;
  });
  vi.spyOn(process, 'off').mockReturnValue(process);
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function start() {
  await import('./main');

  await vi.advanceTimersByTimeAsync(0);
}

describe('gateway executable ownership', () => {
  it.each([undefined, 'https://frontend.example.test'])(
    'owns opt-in browser telemetry using origin %s',
    async (origin) => {
      vi.stubEnv('VISOMI_BROWSER_TELEMETRY', 'true');
      vi.stubEnv('BROWSER_TELEMETRY_ORIGIN', origin);

      await start();

      expect(boundary.browserAssets).toHaveBeenCalledWith(boundary.site.clientDirectory);
      expect(boundary.browserTelemetry).toHaveBeenCalledWith({
        observability: boundary.observability,
        application: 'web-site',
        assets: new Map(),
        origin: origin ?? 'https://stack.visomi.dev',
      });
      expect(boundary.createGatewayApp).toHaveBeenCalledWith(
        expect.objectContaining({
          browserTelemetry: {
            context: 'synthetic-context',
            router: 'synthetic-router',
            close: boundary.closeBrowserTelemetry,
          },
        }),
      );
      boundary.signals.get('SIGTERM')!();

      await vi.advanceTimersByTimeAsync(0);

      expect(boundary.closeBrowserTelemetry).toHaveBeenCalledOnce();
    },
  );

  it('does not create browser telemetry when the website is unavailable', async () => {
    vi.stubEnv('VISOMI_BROWSER_TELEMETRY', 'true');
    boundary.loadSite.mockResolvedValue(undefined);

    await start();

    expect(boundary.browserTelemetry).not.toHaveBeenCalled();
  });
  it('does not create intake resources after shutdown while the asset allowlist is loading', async () => {
    let loaded!: (assets: Map<string, unknown>) => void;

    vi.stubEnv('VISOMI_BROWSER_TELEMETRY', 'true');
    boundary.browserAssets.mockReturnValue(
      new Promise((resolve) => {
        loaded = resolve;
      }),
    );

    await start();

    boundary.signals.get('SIGTERM')!();
    loaded(new Map());

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.browserTelemetry).not.toHaveBeenCalled();
    expect(boundary.server.listen).not.toHaveBeenCalled();
  });
  it('uses default networking and the adjacent compiled API when no overrides are configured', async () => {
    vi.stubEnv('HOST', undefined);
    vi.stubEnv('PORT', undefined);
    vi.stubEnv('API_APP_PATH', '');
    vi.stubEnv('SITE_APP_PATH', '');

    await start();

    expect(boundary.server.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
    expect(boundary.loadApi.mock.calls[0][0].pathname).toMatch(/\/api\/app.js$/);
    expect(boundary.loadSite.mock.calls[0][0].pathname).toMatch(/\/site\/server\/entry.mjs$/);
  });

  it.each([false, true])('does not fail startup if optional Nx readiness fails: %s', async (fails) => {
    vi.stubEnv('NX_READY_SIGNAL_SOCKET', '/synthetic/ready.sock');
    if (fails) {
      boundary.ready.mockImplementation(() => {
        throw new Error('SYNTHETIC_OPTIONAL_READY');
      });
    }

    await start();

    await boundary.server.listen.mock.calls[0][2]();

    expect(boundary.ready).toHaveBeenCalledWith(boundary.server);
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.started');
  });

  it('reports an idle pool failure using only a controlled operational event', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');

    await start();

    boundary.createDatabase.mock.calls[0][1]();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed');
  });

  it('handles listener failure and an unsuccessful telemetry flush', async () => {
    await start();

    boundary.observability.shutdown.mockResolvedValue(false);
    boundary.events.get('error')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(process.exitCode).toBe(1);
    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.failed', 'startup_failed');
  });

  it('does not restart shutdown when module loading rejects after a signal', async () => {
    let reject!: (error: Error) => void;

    boundary.loadApi.mockReturnValue(
      new Promise((_resolve, failed) => {
        reject = failed;
      }),
    );

    await start();

    boundary.signals.get('SIGTERM')!();
    reject(new Error('SYNTHETIC_LATE_IMPORT_FAILURE'));

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.close).toHaveBeenCalledOnce();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.stopped', 'none');
  });
  it('loads the compiled public API and initializes one host runtime', async () => {
    await start();

    expect(boundary.initialize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ service: 'web-gateway' }));
    expect(boundary.loadApi.mock.calls[0][0].href).toBe('file:///synthetic/compiled/api/app.js');
    expect(boundary.createGatewayApp).toHaveBeenCalledWith({
      api: boundary.api,
      site: boundary.site,
      auth: undefined,
      observability: boundary.observability,
    });
    expect(boundary.server.on).toHaveBeenCalledWith('request', 'synthetic-app');
    expect(boundary.server.listen).toHaveBeenCalledWith(3456, '127.0.0.1', expect.any(Function));
    expect(boundary.createDatabase).not.toHaveBeenCalled();
    boundary.server.listen.mock.calls[0][2]();
    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.started');
  });

  it('creates one pool and passes the API-owned authentication chain to the host', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    vi.stubEnv('AUTH_TRUST_PROXY', '127.0.0.1, ::1');

    await start();

    expect(boundary.database.pool.query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
    expect(boundary.api.createAuthentication).toHaveBeenCalledExactlyOnceWith({
      database: boundary.database.db,
      pool: boundary.database.pool,
      config: {},
    });
    expect(boundary.createGatewayApp).toHaveBeenCalledWith(
      expect.objectContaining({ auth: boundary.auth, trustProxy: ['127.0.0.1', '::1'] }),
    );
    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.database.close).toHaveBeenCalledOnce();
    expect(boundary.database.close.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.observability.shutdown.mock.invocationCallOrder[0],
    );
  });

  it.each(['SIGTERM', 'SIGINT'])('drains and flushes exactly once on repeated %s', async (signal) => {
    await start();

    boundary.signals.get(signal)!();
    boundary.signals.get(signal)!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.close).toHaveBeenCalledOnce();
    expect(boundary.observability.shutdown).toHaveBeenCalledExactlyOnceWith(1000);
    expect(process.exitCode).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sanitizes failed module loading without opening a port', async () => {
    boundary.loadApi.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_PATH'));

    await start();

    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed', 'startup_failed');
    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid networking configuration before importing the API', async () => {
    vi.stubEnv('PORT', 'invalid');

    await start();

    expect(boundary.loadApi).not.toHaveBeenCalled();
    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('closes an owned pool after failed database startup', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    boundary.database.pool.query.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DATABASE'));

    await start();

    expect(boundary.database.close).toHaveBeenCalledOnce();
    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed', 'startup_failed');
    expect(process.exitCode).toBe(1);
  });

  it('flushes telemetry even when database cleanup fails', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');

    await start();

    boundary.database.close.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DATABASE'));
    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.observability.shutdown).toHaveBeenCalledOnce();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed', 'shutdown_failed');
    expect(process.exitCode).toBe(1);
  });

  it('does not create resources after shutdown interrupts module loading', async () => {
    let resolve: (api: typeof boundary.api) => void = () => undefined;

    boundary.loadApi.mockReturnValue(
      new Promise((ready) => {
        resolve = ready;
      }),
    );

    await start();

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    resolve(boundary.api);

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.createDatabase).not.toHaveBeenCalled();
    expect(boundary.server.listen).not.toHaveBeenCalled();
  });

  it('does not listen when database connectivity finishes after shutdown', async () => {
    let resolve: () => void = () => undefined;

    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    boundary.database.pool.query.mockReturnValue(
      new Promise<void>((ready) => {
        resolve = ready;
      }),
    );

    await start();

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    resolve();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.database.close).toHaveBeenCalledOnce();
    expect(boundary.server.listen).not.toHaveBeenCalled();
  });

  it('enforces the drain and shutdown deadlines', async () => {
    boundary.server.close.mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await start();

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(3000);

    expect(boundary.server.closeAllConnections).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);

    expect(exit).toHaveBeenCalledWith(1);
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed', 'shutdown_timeout');
  });
});

it.each([false, true])(
  'closes its owned SMTP transport and still closes PostgreSQL after SMTP failure: %s',
  async (fails) => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    vi.stubEnv('GOOGLE_AUTH_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('AUTH_TOTP_ENCRYPTION_KEY', 'synthetic-key');
    boundary.smtpConfig.mockReturnValue({ host: 'smtp.example.test' });
    if (fails) {
      boundary.smtp.close.mockImplementation(() => {
        throw new Error('synthetic_smtp_close_failure');
      });
    }

    await import('./main');

    await vi.advanceTimersByTimeAsync(0);

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.createSmtp).toHaveBeenCalledOnce();
    expect(boundary.smtp.close).toHaveBeenCalledOnce();
    expect(boundary.database.close).toHaveBeenCalledOnce();
    expect(boundary.observability.event).toHaveBeenCalledWith(
      fails ? 'runtime.failed' : 'runtime.stopped',
      fails ? 'shutdown_failed' : 'none',
    );
  },
);
