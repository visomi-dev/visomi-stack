import { spawn } from 'node:child_process';

export function runCommand(command: string, args: string[], input: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'], detached: grouped });
    let timedOut = false;
    let interruption: 'SIGINT' | 'SIGTERM' | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (grouped) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error);
      }
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      console.error(`Check exceeded ${timeoutMs} ms; stopping its process group.`);
      stop('SIGTERM');
      escalation = setTimeout(() => stop('SIGKILL'), 5000);
    }, timeoutMs);
    const interrupt = (signal: 'SIGINT' | 'SIGTERM') => {
      if (interruption) {
        stop('SIGKILL');

        return;
      }
      interruption = signal;
      clearTimeout(deadline);
      clearTimeout(escalation);
      stop(signal);
      escalation = setTimeout(() => stop('SIGKILL'), 5000);
    };
    const interruptWithSigint = () => interrupt('SIGINT');
    const interruptWithSigterm = () => interrupt('SIGTERM');
    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      process.off('SIGINT', interruptWithSigint);
      process.off('SIGTERM', interruptWithSigterm);
    };
    const exitIfInterrupted = () => {
      if (interruption) process.exit(interruption === 'SIGINT' ? 130 : 143);
    };

    process.on('SIGINT', interruptWithSigint);
    process.on('SIGTERM', interruptWithSigterm);
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') console.error(error);
    });
    child.stdin.end(input);
    child.once('error', (error) => {
      cleanup();
      exitIfInterrupted();
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (timedOut || interruption) stop('SIGKILL');
      cleanup();
      exitIfInterrupted();
      if (timedOut || code !== 0) {
        reject(new Error(timedOut ? 'Nx check timed out' : `Nx check exited with ${signal ?? code}`));

        return;
      }
      resolve();
    });
  });
}
