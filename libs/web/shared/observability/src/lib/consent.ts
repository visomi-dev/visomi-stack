export const browserConsentKey = 'visomi:browser-consent:v1';

export function createBrowserConsent(browser: Window) {
  const listeners = new Set<() => void>();
  let rejected = false;
  const accepted = /^accept:(\d+-){3}\d+$/;

  function blocked(): boolean {
    const navigator = browser.navigator as Navigator & { globalPrivacyControl?: boolean };
    const dnt = navigator.doNotTrack ?? (browser as Window & { doNotTrack?: string }).doNotTrack;

    return navigator.globalPrivacyControl === true || dnt === '1' || dnt === 'yes';
  }

  function read(): string | null {
    try {
      return browser.localStorage.getItem(browserConsentKey);
    } catch {
      return null;
    }
  }

  function permit(): string | undefined {
    const value = read();

    return !rejected && !blocked() && accepted.test(value ?? '') ? value! : undefined;
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function storageChanged(event: StorageEvent): void {
    if (event.key === browserConsentKey || event.key === null) {
      notify();
    }
  }

  browser.addEventListener('storage', storageChanged);
  browser.addEventListener('pageshow', notify);
  browser.addEventListener('focus', notify);

  return {
    permit,
    blocked,
    decided(): boolean {
      const value = read();

      return rejected || value === 'reject' || accepted.test(value ?? '');
    },
    decide(accept: boolean): void {
      if (accept && blocked()) {
        return;
      }

      if (!accept) {
        rejected = true;
      }

      try {
        // A new grant cannot release an event captured under a previous grant.
        const current = permit();

        browser.localStorage.setItem(
          browserConsentKey,
          accept ? (current ?? 'accept:' + browser.crypto.getRandomValues(new Uint32Array(4)).join('-')) : 'reject',
        );
        rejected = false;
      } catch {
        // Unavailable storage fails closed.
      }

      notify();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    stop(): void {
      browser.removeEventListener('storage', storageChanged);
      browser.removeEventListener('pageshow', notify);
      browser.removeEventListener('focus', notify);
      listeners.clear();
    },
  };
}

export type BrowserConsent = ReturnType<typeof createBrowserConsent>;
