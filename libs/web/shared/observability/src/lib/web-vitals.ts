import type { BrowserPerformanceMetric } from './contract';

type LayoutShift = PerformanceEntry & { hadRecentInput: boolean; value: number };
type EntryConsumer = (entries: PerformanceEntry[]) => void;

export function observeWebVitals(
  report: (name: BrowserPerformanceMetric, value: number) => void,
  allowed: () => boolean,
): () => void {
  const lifetime = new AbortController();
  const observers: { observer: PerformanceObserver; consume: EntryConsumer }[] = [];
  const reported = new Map<BrowserPerformanceMetric, number>();
  let hiddenAt = document.visibilityState === 'hidden' ? 0 : Infinity;
  let lcp: number | undefined;
  let cls = 0;
  let shift = { start: 0, latest: -Infinity, value: 0 };
  const interactions: { id: number; duration: number }[] = [];
  let firstInteraction = Infinity;
  let lastInteraction = 0;

  function observe(type: string, consume: EntryConsumer): boolean {
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) {
      return false;
    }

    const observer = new PerformanceObserver((list) => {
      if (allowed() && !lifetime.signal.aborted) {
        consume(list.getEntries());
      }
    });
    const options = { type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) };

    try {
      observer.observe(options);
      observers.push({ observer, consume });

      return true;
    } catch {
      observer.disconnect();

      return false;
    }
  }

  function sample(name: BrowserPerformanceMetric, value: number | undefined): void {
    if (value !== undefined && reported.get(name) !== value) {
      reported.set(name, value);
      report(name, value);
    }
  }

  function recordInteractions(entries: PerformanceEntry[]): void {
    for (const { interactionId: id, duration } of entries as PerformanceEventTiming[]) {
      if (!(id > 0)) {
        continue;
      }

      firstInteraction = Math.min(firstInteraction, id);
      lastInteraction = Math.max(lastInteraction, id);
      const existing = interactions.find((interaction) => interaction.id === id);

      if (existing) {
        existing.duration = Math.max(existing.duration, duration);
      } else {
        interactions.push({ id, duration });
      }

      interactions.sort((a, b) => b.duration - a.duration);

      if (interactions.length > 10) {
        interactions.pop();
      }
    }
  }

  observe('paint', (entries) => {
    const first = entries.find(({ name, startTime }) => name === 'first-contentful-paint' && startTime < hiddenAt);

    sample('fcp', first?.startTime);
  });
  observe('largest-contentful-paint', (entries) => {
    for (const { startTime } of entries) {
      if (startTime < hiddenAt) {
        lcp = startTime;
      }
    }
  });
  const hasLayoutShift = observe('layout-shift', (entries) => {
    for (const { startTime, hadRecentInput, value } of entries as LayoutShift[]) {
      if (hadRecentInput) {
        continue;
      }

      // CLS takes the largest session with gaps under one second and a five-second cap.
      shift =
        startTime - shift.latest < 1000 && startTime - shift.start < 5000
          ? { ...shift, latest: startTime, value: shift.value + value }
          : { start: startTime, latest: startTime, value };
      cls = Math.max(cls, shift.value);
    }
  });

  if (observe('event', recordInteractions)) {
    observe('first-input', recordInteractions);
  }

  function reportHidden(): void {
    if (!allowed() || lifetime.signal.aborted) {
      return;
    }

    hiddenAt = Math.min(hiddenAt, performance.now());

    for (const { observer, consume } of observers) {
      consume(observer.takeRecords());
    }

    sample('lcp', lcp);
    sample('cls', hasLayoutShift ? cls : undefined);

    if (interactions.length > 0) {
      // Chromium interaction IDs advance by seven when interactionCount is unavailable.
      const total =
        (performance as Performance & { interactionCount?: number }).interactionCount ??
        (lastInteraction - firstInteraction) / 7 + 1;
      const percentile = Math.min(interactions.length - 1, Math.floor(total / 50));

      sample('inp', interactions[percentile].duration);
    }
  }

  if (observers.length > 0) {
    const { signal } = lifetime;

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          reportHidden();
        }
      },
      { signal },
    );
    window.addEventListener('pagehide', reportHidden, { signal });
  }

  return () => {
    lifetime.abort();
    observers.forEach(({ observer }) => observer.disconnect());
    observers.length = 0;
    interactions.length = 0;
    reported.clear();
  };
}
