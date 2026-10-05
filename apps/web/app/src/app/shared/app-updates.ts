import { DOCUMENT } from '@angular/common';
import { inject, Service, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

@Service()
export class AppUpdates {
  private readonly document = inject(DOCUMENT);
  private readonly updates = inject(SwUpdate, { optional: true });

  private readonly readyState = signal(false);

  readonly ready = this.readyState.asReadonly();

  start(): () => void {
    const browser = this.document.defaultView;
    const updates = this.updates;

    if (!browser || !updates?.isEnabled) return () => undefined;
    let checking = false;
    let stopped = false;
    const check = async () => {
      if (stopped || checking || this.document.visibilityState !== 'visible') return;
      checking = true;

      try {
        await updates.checkForUpdate();
      } catch {
        // Optional offline checks retry when online or visible; never reset user storage.
      } finally {
        checking = false;
      }
    };
    const requestCheck = () => void check();
    const subscription = updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.readyState.set(true);
    });
    const timer = browser.setInterval(requestCheck, 60 * 60 * 1000);

    this.document.addEventListener('visibilitychange', requestCheck);
    browser.addEventListener('online', requestCheck);
    requestCheck();

    return () => {
      stopped = true;
      subscription.unsubscribe();
      browser.clearInterval(timer);
      this.document.removeEventListener('visibilitychange', requestCheck);
      browser.removeEventListener('online', requestCheck);
    };
  }

  reload(): void {
    // Reload the complete version; activating in place can mismatch lazy chunks.
    if (this.ready()) this.document.defaultView?.location.reload();
  }
}
