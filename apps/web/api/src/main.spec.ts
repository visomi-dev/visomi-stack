import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  signals: new Map<string, () => void>(),
  server: {
    once: vi.fn(),
    listen: vi.fn(),
    close: vi.fn(),
    closeAllConnections: vi.fn(),
  },
  observability: { event: vi.fn(), shutdown: vi.fn() },
  createApp: vi.fn(() => 'synthetic-app'),
  createServer: vi.fn(),
  initialize: vi.fn(),
  createDatabase: vi.fn(),
  smtpConfig: vi.fn(),
  createSmtp: vi.fn(),
  smtp: { send: vi.fn(), close: vi.fn() },
  database: { db: {}, pool: { query: vi.fn() }, close: vi.fn() },
  authConfig: vi.fn(),
  createAuthentication: vi.fn(),
}));

vi.mock('node:http', () => ({ createServer: boundary.createServer }));
vi.mock('@visomi-stack/web-backend-shared', () => ({
  initializeObservability: boundary.initialize,
}));
vi.mock('@visomi-stack/backend-shared', () => ({
  createDatabase: boundary.createDatabase,
  smtpConfig: boundary.smtpConfig,
  createSmtp: boundary.createSmtp,
}));
vi.mock('./app', () => ({
  createApp: boundary.createApp,
  authConfig: boundary.authConfig,
  createAuthentication: boundary.createAuthentication,
}));

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('AUTH_TRUST_PROXY', '');
  boundary.createDatabase.mockReturnValue(boundary.database);
  boundary.smtpConfig.mockReturnValue(undefined);
  boundary.createSmtp.mockReturnValue(boundary.smtp);
  boundary.smtp.close.mockImplementation(() => undefined);
  boundary.database.close.mockResolvedValue(undefined);
  boundary.database.pool.query.mockResolvedValue({ rows: [] });
  boundary.authConfig.mockReturnValue({});
  boundary.createAuthentication.mockReturnValue({});
  vi.stubEnv('HOST', '127.0.0.1');
  vi.stubEnv('PORT', '3456');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NX_READY_SIGNAL_SOCKET', '');
  boundary.events.clear();
  boundary.signals.clear();
  boundary.initialize.mockReturnValue(boundary.observability);
  boundary.createServer.mockReturnValue(boundary.server);
  boundary.server.once.mockImplementation((name: string, callback: () => void) => boundary.events.set(name, callback));
  boundary.server.close.mockImplementation((callback: () => void) => callback());
  boundary.observability.shutdown.mockResolvedValue(true);
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

describe('API executable lifecycle', () => {
  it('uses default networking when no host or port is configured', async () => {
    vi.stubEnv('HOST', undefined);
    vi.stubEnv('PORT', undefined);

    await import('./main');

    expect(boundary.server.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
  });

  it('handles composition failure before listening', async () => {
    boundary.createApp.mockImplementationOnce(() => {
      throw new Error('SYNTHETIC_COMPOSITION_FAILURE');
    });

    await import('./main');

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.failed', 'startup_failed');
    expect(process.exitCode).toBe(1);
  });

  it('passes explicit proxy trust and reports idle pool errors without their contents', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    vi.stubEnv('AUTH_TRUST_PROXY', '127.0.0.1, ::1');

    await import('./main');

    const onError = boundary.createDatabase.mock.calls[0][1];

    onError();
    expect(boundary.createApp).toHaveBeenCalledWith(expect.objectContaining({ trustProxy: ['127.0.0.1', '::1'] }));
    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.failed');
  });

  it.each([false, true])('treats Nx readiness as optional when the loader fails: %s', async (fails) => {
    vi.stubEnv('NX_READY_SIGNAL_SOCKET', '/synthetic/ready.sock');

    await import('./main');

    const emitReadySignal = vi.fn();
    const load = fails
      ? vi.fn().mockRejectedValue(new Error('SYNTHETIC_OPTIONAL_IMPORT'))
      : vi.fn().mockResolvedValue({ emitReadySignal });
    const dynamicFunction = vi.spyOn(globalThis, 'Function').mockImplementation(function () {
      return load;
    });

    try {
      await boundary.server.listen.mock.calls[0][2]();

      expect(load).toHaveBeenCalledWith('@nx/js/ready-signal');
      expect(emitReadySignal).toHaveBeenCalledTimes(fails ? 0 : 1);
      expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.started');
    } finally {
      dynamicFunction.mockRestore();
    }
  });
  it('owns initialization and starts listening only from the entrypoint', async () => {
    await import('./main');

    expect(boundary.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'web-api', environment: 'test' }),
    );
    expect(boundary.createApp).toHaveBeenCalledWith({ observability: boundary.observability });
    expect(boundary.createServer).toHaveBeenCalledWith('synthetic-app');
    expect(boundary.server.listen).toHaveBeenCalledWith(3456, '127.0.0.1', expect.any(Function));
    const ready = boundary.server.listen.mock.calls[0][2];

    ready();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.started');
  });

  it.each(['SIGTERM', 'SIGINT'])('closes and flushes once on repeated %s', async (name) => {
    await import('./main');

    const signal = boundary.signals.get(name)!;

    signal();
    signal();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.close).toHaveBeenCalledOnce();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.stopped', 'none');
    expect(boundary.observability.shutdown).toHaveBeenCalledExactlyOnceWith(1000);
    expect(process.exitCode).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports unsuccessful flushing through the exit code', async () => {
    boundary.observability.shutdown.mockResolvedValue(false);

    await import('./main');

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(process.exitCode).toBe(1);
  });

  it.each(['invalid', '-1', '65536', '1.5'])('rejects invalid port %s without listening', async (port) => {
    vi.stubEnv('PORT', port);

    await import('./main');

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed', 'startup_failed');
    expect(process.exitCode).toBe(1);
  });

  it('handles listener errors with controlled telemetry and cleanup', async () => {
    await import('./main');

    boundary.events.get('error')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.observability.event).toHaveBeenCalledExactlyOnceWith('runtime.failed', 'startup_failed');
    expect(boundary.observability.shutdown).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('forces connection drain at three seconds and enforces the five-second deadline', async () => {
    boundary.server.close.mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await import('./main');

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(2999);

    expect(boundary.server.closeAllConnections).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(boundary.server.closeAllConnections).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);

    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.failed', 'shutdown_timeout');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('verifies its owned database before listening and closes it after HTTP draining', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');

    await import('./main');

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.database.pool.query).toHaveBeenCalledWith('SELECT 1');
    expect(boundary.server.listen).toHaveBeenCalledOnce();
    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.database.close).toHaveBeenCalledOnce();
    expect(boundary.server.close.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.database.close.mock.invocationCallOrder[0],
    );
    expect(boundary.database.close.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.observability.shutdown.mock.invocationCallOrder[0],
    );
  });

  it('closes an owned database after startup failure without logging driver errors', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    boundary.database.pool.query.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DATABASE_ERROR'));

    await import('./main');

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(boundary.database.close).toHaveBeenCalledOnce();
    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.failed', 'startup_failed');
    expect(process.exitCode).toBe(1);
  });

  it('still flushes telemetry when closing the database fails', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    boundary.database.close.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DATABASE_ERROR'));

    await import('./main');

    await vi.advanceTimersByTimeAsync(0);

    boundary.signals.get('SIGTERM')!();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.observability.event).toHaveBeenCalledWith('runtime.failed', 'shutdown_failed');
    expect(boundary.observability.shutdown).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
  it('does not start listening after shutdown begins while the database is connecting', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic/unused');
    let ready: () => void = () => undefined;

    boundary.database.pool.query.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );

    await import('./main');

    boundary.signals.get('SIGTERM')!();
    ready();

    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.server.listen).not.toHaveBeenCalled();
    expect(boundary.database.close).toHaveBeenCalledOnce();
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
