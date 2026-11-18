import type { BrowserErrorReport } from './contract';

const limit = 5;
const lifetime = 300000;

export function createPendingReports() {
  const pending: { report: BrowserErrorReport; expires: number }[] = [];
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh(): void {
    clearTimeout(timer);
    const now = Date.now();

    while (pending[0]?.expires <= now) {
      pending.shift();
    }

    if (pending[0]) {
      timer = setTimeout(refresh, pending[0].expires - now);
    }

    listeners.forEach((listener) => listener());
  }

  return {
    add(report: BrowserErrorReport, capturedAt = Date.now()): void {
      const now = Date.now();
      const expires = capturedAt + lifetime;

      if (
        expires <= now ||
        pending.some(
          (item) =>
            item.expires > now &&
            item.report.code === report.code &&
            item.report.kind === report.kind &&
            item.report.screen === report.screen,
        )
      ) {
        return;
      }

      if (pending.length === limit) {
        pending.shift();
      }

      pending.push({ report: Object.freeze(report), expires });
      refresh();
    },
    discard(report: BrowserErrorReport): void {
      const index = pending.findIndex((item) => item.report === report);

      if (index !== -1) {
        pending.splice(index, 1);
        refresh();
      }
    },
    items: () => pending.filter(({ expires }) => expires > Date.now()).map(({ report }) => report),
    has: (report: BrowserErrorReport) => pending.some((item) => item.report === report && item.expires > Date.now()),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    refresh,
    clear(): void {
      pending.length = 0;
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
