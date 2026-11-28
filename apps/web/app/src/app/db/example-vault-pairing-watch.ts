/** The socket only invalidates. Bounded HTTP checks recover missed messages and suspended tabs. */
export function watchVaultPairing(view: Window, refresh: () => Promise<void>, connected: () => boolean) {
  let timer: number | undefined;
  let stopped = false;
  let checking = false;

  const check = async () => {
    if (stopped || checking || view.document.visibilityState === 'hidden') {
      return;
    }

    checking = true;

    try {
      await refresh();
    } finally {
      checking = false;

      if (!stopped) {
        timer = view.setTimeout(() => void check(), connected() ? 30_000 : 10_000);
      }
    }
  };
  const wake = () => {
    view.clearTimeout(timer);
    void check();
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
