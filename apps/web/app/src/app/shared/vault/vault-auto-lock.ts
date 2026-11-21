/** Only interaction extends the deadline. Background timers may resume late. */
export function watchVaultActivity(document: Document, lock: () => void): () => void {
  const view = document.defaultView;

  if (!view) {
    return () => undefined;
  }

  const idleMs = 5 * 60_000;
  let deadline = Date.now() + idleMs;
  let timer: number;
  const check = () => {
    view.clearTimeout(timer);
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      lock();
    } else {
      timer = view.setTimeout(check, remaining);
    }
  };
  const activity = () => {
    if (Date.now() >= deadline) {
      check();
    } else {
      deadline = Date.now() + idleMs;
    }
  };
  const events = new AbortController();

  for (const type of ['pointerdown', 'keydown', 'input', 'wheel']) {
    document.addEventListener(type, activity, { passive: true, signal: events.signal });
  }
  view.addEventListener('pagehide', lock, { signal: events.signal });
  document.addEventListener('visibilitychange', check, { signal: events.signal });
  check();

  return () => {
    events.abort();
    view.clearTimeout(timer);
  };
}
