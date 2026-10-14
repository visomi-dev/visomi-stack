import type { ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function requireFreeGatewayPort(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    const finish = (occupied: boolean) => {
      socket.destroy();
      if (occupied)
        reject(new Error('The API E2E gateway port is already occupied; refusing to reuse another process.'));
      else resolve();
    };

    socket.once('connect', () => finish(true));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') finish(false);
      else {
        socket.destroy();
        reject(new Error('The API E2E gateway port could not be checked.'));
      }
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error('The API E2E gateway port check timed out.'));
    });
  });
}

export async function waitForGateway(child: ChildProcess, url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const exited = new AbortController();
  const onExit = () => exited.abort();
  const signal = AbortSignal.any([deadline, exited.signal]);

  child.once('exit', onExit);
  child.once('error', onExit);
  try {
    while (!signal.aborted) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });

        await response.body?.cancel();
        if (response.ok && !signal.aborted && child.exitCode === null && child.signalCode === null) return;
      } catch {
        // Startup may temporarily refuse connections. Never report child output or credentials.
      }
      await delay(100, undefined, { signal }).catch(() => undefined);
    }
    throw new Error(
      exited.signal.aborted || child.exitCode !== null || child.signalCode !== null
        ? 'The API E2E gateway exited before readiness.'
        : 'The API E2E gateway readiness deadline expired.',
    );
  } finally {
    child.removeListener('exit', onExit);
    child.removeListener('error', onExit);
  }
}

/** Stops only the detached group created by this fixture, with bounded escalation. */
export async function stopGateway(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const stop = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid!, signal);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };

  stop('SIGTERM');
  if (child.exitCode !== null || child.signalCode !== null) {
    stop('SIGKILL');

    return;
  }
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(() => stop('SIGKILL'), 5000);
    const deadline = setTimeout(() => {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      reject(new Error('The API E2E gateway did not exit after bounded cleanup.'));
    }, 6000);

    child.once('exit', finish);
  });
  // Also remove descendants if the parent exited before them.
  stop('SIGKILL');
}
