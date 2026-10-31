import { DOCUMENT } from '@angular/common';
import { Injectable, afterNextRender, inject, signal, DestroyRef } from '@angular/core';

import { theme, type ThemePreference } from '@visomi-stack/web-frontend-ui';

@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly selection = signal<ThemePreference>('system');

  readonly preference = this.selection.asReadonly();

  private media?: MediaQueryList;

  constructor() {
    afterNextRender(() => {
      const view = this.document.defaultView;

      if (!view?.matchMedia) {
        return;
      }

      let stored: unknown;

      try {
        stored = view.localStorage.getItem(theme.storageKey);
      } catch {
        // Theme changes still work when persistence is unavailable.
      }

      this.selection.set(theme.preference(stored));
      this.media = view.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => this.apply();

      this.apply();
      this.media.addEventListener('change', apply);
      this.destroyRef.onDestroy(() => this.media?.removeEventListener('change', apply));
    });
  }

  select(value: string): void {
    if (!theme.isPreference(value)) {
      return;
    }

    this.selection.set(value);

    try {
      this.document.defaultView?.localStorage.setItem(theme.storageKey, value);
    } catch {
      // The selected theme remains active for the current page.
    }
    this.apply();
  }

  private apply(): void {
    this.document.documentElement.classList.toggle(
      'dark',
      theme.resolve(this.preference(), this.media?.matches ?? false) === 'dark',
    );
  }
}
