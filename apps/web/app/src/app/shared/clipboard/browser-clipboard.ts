import { DOCUMENT } from '@angular/common';
import { WritableSignal, afterNextRender, inject, Injectable, signal } from '@angular/core';

import { Clipboard } from './clipboard';

@Injectable({ providedIn: 'root' })
export class BrowserClipboard extends Clipboard {
  private readonly document = inject(DOCUMENT);

  private readonly $available: WritableSignal<boolean> = signal(false);

  readonly available = this.$available.asReadonly();

  readonly resolveAvailability = afterNextRender(() => {
    const clipboard = this.document.defaultView?.navigator?.clipboard;

    this.$available.set(typeof clipboard?.writeText === 'function');
  });

  async writeText(value: string): Promise<boolean> {
    const clipboard = this.document.defaultView?.navigator?.clipboard;

    if (typeof clipboard?.writeText !== 'function') {
      return false;
    }

    try {
      await clipboard.writeText(value);

      return true;
    } catch {
      return false;
    }
  }
}
