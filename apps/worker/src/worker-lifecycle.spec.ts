import { stopWorkerRuntime } from './worker-lifecycle';

test('signals stop each owned task once and wait for all active work before exit', async () => {
  let finish: (() => void) | undefined;
  const drain = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stopQueue = jest.fn(async () => {
    await drain;
  });
  const stopNotifications = jest.fn(async () => undefined);
  const exit = jest.fn();
  const failed = jest.fn();
  const stop = stopWorkerRuntime([stopQueue, stopNotifications], { exit, failed });

  stop();
  stop();
  await Promise.resolve();
  expect(stopQueue).toHaveBeenCalledTimes(1);
  expect(stopNotifications).toHaveBeenCalledTimes(1);
  expect(exit).not.toHaveBeenCalled();
  finish?.();
  await drain;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(exit).toHaveBeenCalledWith(0);
  expect(failed).not.toHaveBeenCalled();
});

test('shutdown failure is reported and exits unsuccessfully without restarting work', async () => {
  const exit = jest.fn();
  const failed = jest.fn();
  const stop = stopWorkerRuntime(
    [
      async () => {
        throw new Error('synthetic_shutdown_failure');
      },
    ],
    { exit, failed },
  );

  stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(exit).toHaveBeenCalledWith(1);
  expect(failed).toHaveBeenCalledTimes(1);
  stop();
  expect(exit).toHaveBeenCalledTimes(1);
});

test('one failed stop does not abandon another task still draining', async () => {
  let finish: (() => void) | undefined;
  const drain = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const exit = jest.fn();
  const failed = jest.fn();
  const stop = stopWorkerRuntime(
    [
      async () => {
        throw new Error('synthetic_stop_failure');
      },
      async () => {
        await drain;
      },
    ],
    { exit, failed },
  );

  stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(exit).not.toHaveBeenCalled();
  finish?.();
  await drain;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(exit).toHaveBeenCalledWith(1);
});
