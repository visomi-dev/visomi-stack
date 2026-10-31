import { DOCUMENT } from '@angular/common';
import { Injectable, afterNextRender, afterRenderEffect, computed, inject, signal, DestroyRef } from '@angular/core';

type ThemePreference = 'system' | 'light' | 'dark';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly selection = signal<ThemePreference>('system');
  private readonly systemDark = signal(false);

  readonly preference = this.selection.asReadonly();
  readonly colorScheme = computed(() => {
    const preference = this.preference();

    return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
  });
  readonly isDark = computed(() => this.colorScheme() === 'dark');

  private readonly storageKey = 'visomi.theme';

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
      const media = view.matchMedia('(prefers-color-scheme: dark)');
      const updateSystem = () => this.systemDark.set(media.matches);

      updateSystem();
      media.addEventListener('change', updateSystem);
      this.destroyRef.onDestroy(() => media.removeEventListener('change', updateSystem));
    });

    afterRenderEffect({
      write: () => {
        const root = this.document.documentElement;

        root.classList.toggle('dark', this.isDark());
        root.style.colorScheme = this.colorScheme();
      },
    });
  }

  setTheme(value: string): void {
    if (!isPreference(value)) {
      return;
    }

    this.selection.set(value);

    try {
      this.document.defaultView?.localStorage.setItem(this.storageKey, value);
    } catch {
      // The selected theme remains active for the current page.
    }
  }
}
