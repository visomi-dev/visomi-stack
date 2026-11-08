import { DOCUMENT } from '@angular/common';
import { Service, afterNextRender, computed, inject, signal, DestroyRef } from '@angular/core';

type ThemePreference = 'system' | 'light' | 'dark';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

@Service()
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly selection = signal<ThemePreference>('system');
  private readonly systemDark = signal(false);
  private readonly changed = signal(false);

  readonly preference = this.selection.asReadonly();
  readonly colorScheme = computed(() => {
    const preference = this.preference();

    return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
  });
  readonly isDark = computed(() => this.colorScheme() === 'dark');

  readonly hasChanged = this.changed.asReadonly();

  private readonly storageKey = 'visomi.theme';

  setTheme(value: string): void {
    if (!isPreference(value)) {
      return;
    }

    const wasDark = this.isDark();

    this.selection.set(value);

    if (wasDark !== this.isDark()) {
      this.changed.set(true);
    }

    try {
      this.document.defaultView?.localStorage.setItem(this.storageKey, value);
    } catch {
      // The selected theme remains active for the current page.
    }
  }

  private readonly initialize = afterNextRender(() => {
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
    const updateSystem = () => {
      const wasDark = this.isDark();

      this.systemDark.set(media.matches);

      if (wasDark !== this.isDark()) {
        this.changed.set(true);
      }
    };

    this.systemDark.set(media.matches);
    media.addEventListener('change', updateSystem);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', updateSystem));
  });
}
