import { DOCUMENT } from '@angular/common';
import { Injectable, afterNextRender, inject, signal, DestroyRef } from '@angular/core';

type ThemePreference = 'system' | 'light' | 'dark';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly selection = signal<ThemePreference>('system');

  readonly preference = this.selection.asReadonly();

  private readonly storageKey = 'visomi.theme';

  private media?: MediaQueryList;

  constructor() {
    afterNextRender(() => {
      const view = this.document.defaultView;

      if (!view?.matchMedia) {
        return;
      }

      let stored: unknown;

      try {
        stored = view.localStorage.getItem(this.storageKey);
      } catch {
        // Theme changes still work when persistence is unavailable.
      }

      this.selection.set(isPreference(stored) ? stored : 'system');
      this.media = view.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => this.apply();

      this.apply();
      this.media.addEventListener('change', apply);
      this.destroyRef.onDestroy(() => this.media?.removeEventListener('change', apply));
    });
  }

  select(value: string): void {
    if (!isPreference(value)) {
      return;
    }

    this.selection.set(value);

    try {
      this.document.defaultView?.localStorage.setItem(this.storageKey, value);
    } catch {
      // The selected theme remains active for the current page.
    }
    this.apply();
  }

  private apply(): void {
    const preference = this.preference();
    const dark = preference === 'system' ? (this.media?.matches ?? false) : preference === 'dark';

    this.document.documentElement.classList.toggle('dark', dark);
  }
}
