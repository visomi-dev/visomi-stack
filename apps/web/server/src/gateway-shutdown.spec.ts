import { EventEmitter } from 'node:events';

import { stopGatewayRuntime } from './gateway-shutdown';

function fixture() {
  const events = new EventEmitter();
  const worker = { exitCode: null, signalCode: null, kill: jest.fn(), once: events.once.bind(events) };
  let closeServer: (() => void) | undefined;
  const server = {
    close: jest.fn((closed: () => void) => {
      closeServer = closed;
    }),
  };
  const exit = jest.fn();

  return { worker, server, exit, workerExited: () => events.emit('exit'), serverClosed: () => closeServer?.() };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('graceful shutdown waits for both the listener and its owned worker', () => {
  const owned = fixture();

  stopGatewayRuntime(owned);
  expect(owned.worker.kill).toHaveBeenCalledWith('SIGTERM');
  owned.serverClosed();
  expect(owned.exit).not.toHaveBeenCalled();
  owned.workerExited();
  expect(owned.exit).toHaveBeenCalledTimes(1);
  expect(owned.exit).toHaveBeenCalledWith(0);
  jest.advanceTimersByTime(10_000);
  expect(owned.worker.kill).toHaveBeenCalledTimes(1);
});

test('the existing deadline terminates only its owned worker and waits for the exit event', () => {
  const owned = fixture();

  stopGatewayRuntime(owned);
  owned.serverClosed();
  jest.advanceTimersByTime(10_000);
  expect(owned.worker.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(owned.exit).not.toHaveBeenCalled();
  owned.workerExited();
  expect(owned.exit).toHaveBeenCalledWith(1);
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('a drained worker does not bypass listener completion or receive another signal', () => {
  const owned = fixture();

  stopGatewayRuntime(owned);
  owned.workerExited();
  expect(owned.exit).not.toHaveBeenCalled();
  jest.advanceTimersByTime(10_000);
  expect(owned.worker.kill.mock.calls).toEqual([['SIGTERM']]);
  expect(owned.exit).toHaveBeenCalledWith(1);
  owned.serverClosed();
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('a stuck listener cannot make the gateway abandon a still-running worker', () => {
  const owned = fixture();

  stopGatewayRuntime(owned);
  jest.advanceTimersByTime(10_000);
  expect(owned.exit).not.toHaveBeenCalled();
  owned.workerExited();
  expect(owned.exit).toHaveBeenCalledWith(1);
  owned.serverClosed();
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('an already signal-terminated worker needs no additional signal', () => {
  const owned = fixture();
  const worker = { ...owned.worker, signalCode: 'SIGTERM' as const };

  stopGatewayRuntime({ ...owned, worker });
  owned.serverClosed();
  expect(owned.worker.kill).not.toHaveBeenCalled();
  expect(owned.exit).toHaveBeenCalledWith(0);
});

test('listener-only and failed-bootstrap shutdown clear their deadline', () => {
  const exit = jest.fn();

  stopGatewayRuntime({ worker: undefined, server: undefined, exit });
  expect(exit).toHaveBeenCalledWith(0);
  jest.advanceTimersByTime(10_000);
  expect(exit).toHaveBeenCalledTimes(1);
});

test('listener-only shutdown waits for the listener then exits successfully', () => {
  const owned = fixture();

  stopGatewayRuntime({ ...owned, worker: undefined });
  expect(owned.exit).not.toHaveBeenCalled();
  owned.serverClosed();
  expect(owned.exit).toHaveBeenCalledWith(0);
  jest.advanceTimersByTime(10_000);
  expect(owned.worker.kill).not.toHaveBeenCalled();
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('attached realtime closes upgraded sockets and its listener before parent exit', () => {
  const owned = fixture();
  const realtime = fixture();

  stopGatewayRuntime({ ...owned, realtime: realtime.server });
  expect(realtime.server.close).toHaveBeenCalledTimes(1);
  expect(owned.server.close).not.toHaveBeenCalled();
  owned.workerExited();
  expect(owned.exit).not.toHaveBeenCalled();
  realtime.serverClosed();
  expect(owned.exit).toHaveBeenCalledWith(0);
  jest.advanceTimersByTime(10_000);
  expect(owned.worker.kill.mock.calls).toEqual([['SIGTERM']]);
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('stuck realtime retains the deadline and cannot abandon the owned worker', () => {
  const owned = fixture();
  const realtime = fixture();

  stopGatewayRuntime({ ...owned, realtime: realtime.server });
  jest.advanceTimersByTime(10_000);
  expect(owned.worker.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(owned.exit).not.toHaveBeenCalled();
  owned.workerExited();
  expect(owned.exit).toHaveBeenCalledWith(1);
  realtime.serverClosed();
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('memory runtime waits for its active operation before exiting', async () => {
  const owned = fixture();
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stopInProcessWorker = jest.fn(() => pending);

  stopGatewayRuntime({ ...owned, worker: undefined, stopInProcessWorker });
  owned.serverClosed();
  await jest.advanceTimersByTimeAsync(0);
  expect(stopInProcessWorker).toHaveBeenCalledTimes(1);
  expect(owned.exit).not.toHaveBeenCalled();
  finish?.();
  await jest.advanceTimersByTimeAsync(0);
  expect(owned.exit).toHaveBeenCalledTimes(1);
  expect(owned.exit).toHaveBeenCalledWith(0);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['throw', 'reject'])('memory drain failure reports failure without an unhandled %s', async (mode) => {
  const owned = fixture();
  const stopInProcessWorker = () => {
    if (mode === 'throw') {
      throw new Error('synthetic_shutdown_failure');
    }

    return Promise.reject(new Error('synthetic_shutdown_failure'));
  };

  stopGatewayRuntime({ ...owned, worker: undefined, stopInProcessWorker });
  owned.serverClosed();
  await jest.advanceTimersByTimeAsync(0);
  expect(owned.exit).toHaveBeenCalledWith(1);
  expect(owned.exit).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('stalled memory work retains the deadline and exits unsuccessfully once', async () => {
  const owned = fixture();
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });

  stopGatewayRuntime({ ...owned, worker: undefined, stopInProcessWorker: () => pending });
  owned.serverClosed();
  await jest.advanceTimersByTimeAsync(10_000);
  expect(owned.exit).toHaveBeenCalledWith(1);
  finish?.();
  await jest.advanceTimersByTimeAsync(0);
  expect(owned.exit).toHaveBeenCalledTimes(1);
});

test('failed bootstrap retains its failure status after graceful cleanup', () => {
  const owned = fixture();

  stopGatewayRuntime({ ...owned, exitCode: 1 });
  owned.serverClosed();
  expect(owned.exit).not.toHaveBeenCalled();
  owned.workerExited();
  expect(owned.exit).toHaveBeenCalledWith(1);
});
