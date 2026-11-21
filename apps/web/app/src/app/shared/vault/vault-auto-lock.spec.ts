import { watchVaultActivity } from './vault-auto-lock';

it('locks after five idle minutes and checks the deadline when a suspended tab returns', () => {
  vi.useFakeTimers();
  const lock = vi.fn();
  const stop = watchVaultActivity(document, lock);

  try {
    vi.advanceTimersByTime(240_000);
    document.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(299_999);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lock).toHaveBeenCalledOnce();
    stop();
    const again = watchVaultActivity(document, lock);

    try {
      vi.setSystemTime(Date.now() + 301_000);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(lock).toHaveBeenCalledTimes(2);
    } finally {
      again();
    }
  } finally {
    stop();
    vi.useRealTimers();
  }
});
