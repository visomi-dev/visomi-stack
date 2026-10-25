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
}));

vi.mock('node:http', () => ({ createServer: boundary.createServer }));
vi.mock('@visomi-stack/web-backend-shared', () => ({ initializeObservability: boundary.initialize }));
vi.mock('./app', () => ({ createApp: boundary.createApp }));

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
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
});
