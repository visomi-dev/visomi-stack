import type { ChildProcess } from 'node:child_process';

type OwnedWorker = Pick<ChildProcess, 'exitCode' | 'signalCode'> & {
  kill: (signal: NodeJS.Signals) => unknown;
  once: (event: 'exit', exited: () => void) => unknown;
};
type Listener = { close: (closed: () => void) => unknown };

/** The gateway must reap its own worker even when disconnected work cannot drain. */
export function stopGatewayRuntime(context: {
  worker: OwnedWorker | undefined;
  server: Listener | undefined;
  realtime?: Listener;
  stopInProcessWorker?: () => Promise<void>;
  exitCode?: number;
  exit: (code: number) => void;
}): void {
  const { worker, server, realtime } = context;
  let serverClosed = !server && !realtime;
  let workerClosed = !worker || worker.exitCode !== null || worker.signalCode !== null;
  let inProcessWorkerClosed = !context.stopInProcessWorker;
  let failed = false;
  let deadlineReached = false;
  let exited = false;
  const finish = () => {
    if (!exited && workerClosed && ((serverClosed && inProcessWorkerClosed) || deadlineReached)) {
      exited = true;
      clearTimeout(timer);
      context.exit(deadlineReached || failed ? 1 : (context.exitCode ?? 0));
    }
  };
  const timer = setTimeout(() => {
    deadlineReached = true;
    if (!workerClosed) {
      // Never exit the parent before the owned child acknowledges termination.
      worker?.kill('SIGKILL');
    }

    finish();
  }, 10_000);

  timer.unref();
  if (!workerClosed) {
    worker?.once('exit', () => {
      workerClosed = true;
      finish();
    });
    worker?.kill('SIGTERM');
  }

  if (context.stopInProcessWorker) {
    void Promise.resolve()
      .then(context.stopInProcessWorker)
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        inProcessWorkerClosed = true;
        finish();
      });
  }

  // The attached realtime runtime owns upgraded sockets and closes its HTTP listener after them.
  (realtime ?? server)?.close(() => {
    serverClosed = true;
    finish();
  });
  finish();
}
