const wakeSpacing = 5_000;

/** The socket only invalidates. Bounded HTTP checks recover missed messages and suspended tabs. */
export function watchVaultPairing(
  view: Window,
  refresh: () => Promise<void>,
  connected: () => boolean,
  { delayFirstCheck = false } = {},
) {
  let timer: number | undefined;
  let stopped = false;
  let checking = false;
  let queued = false;
  let nextWake = performance.now() + (delayFirstCheck ? wakeSpacing : 0);

  const wakeDelay = () => Math.max(0, nextWake - performance.now());
  const schedule = (delay: number) => {
    view.clearTimeout(timer);
    timer = view.setTimeout(() => void check(), delay);
  };

  const check = async () => {
    queued = false;

    if (stopped || view.document.visibilityState === 'hidden') {
      return;
    }

    checking = true;
    nextWake = performance.now() + wakeSpacing;

    try {
      await refresh();
    } finally {
      checking = false;

      if (!stopped) {
        schedule(queued ? wakeDelay() : connected() ? 30_000 : 10_000);
      }
    }
  };
  const wake = () => {
    if (stopped || queued || view.document.visibilityState === 'hidden') {
      return;
    }

    queued = true;

    if (!checking) {
      schedule(wakeDelay());
    }
  };

  view.document.addEventListener('visibilitychange', wake);
  view.addEventListener('pageshow', wake);
  wake();

  const stop = () => {
    stopped = true;
    view.clearTimeout(timer);
    view.document.removeEventListener('visibilitychange', wake);
    view.removeEventListener('pageshow', wake);
  };

  return { wake, stop };
}
