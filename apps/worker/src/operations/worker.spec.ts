import { processNextOperation } from './processor';
import { processNextPush } from './push-processor';
import { startOperationWorker } from './worker';

jest.mock('./processor', () => ({ processNextOperation: jest.fn() }));
jest.mock('./push-processor', () => ({ processNextPush: jest.fn() }));
jest.mock('shared', () => ({ logger: { warn: jest.fn() } }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(processNextOperation).mockReset().mockResolvedValue(false);
  jest.mocked(processNextPush).mockReset().mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('bounded combined worker polling', () => {
  it('does not starve push delivery after an unrelated operation storage failure', async () => {
    jest.mocked(processNextOperation).mockRejectedValue(new Error('Operation unavailable'));
    const stop = startOperationWorker();

    await jest.advanceTimersByTimeAsync(1);
    expect(processNextPush).toHaveBeenCalledTimes(1);
    await stop();
    await jest.advanceTimersByTimeAsync(2000);
    expect(processNextPush).toHaveBeenCalledTimes(1);
  });

  it('awaits the owned in-flight delivery when stopped and never schedules another poll', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    jest.mocked(processNextPush).mockImplementation(async () => {
      await pending;

      return true;
    });
    const stop = startOperationWorker();

    await jest.advanceTimersByTimeAsync(1);
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    await jest.advanceTimersByTimeAsync(2000);
    expect(processNextPush).toHaveBeenCalledTimes(1);
  });
});
