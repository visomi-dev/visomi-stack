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
  private readonly transitioning = signal(false);

  readonly preference = this.selection.asReadonly();
  readonly colorScheme = computed(() => {
    const preference = this.preference();

    return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
  });
  readonly isDark = computed(() => this.colorScheme() === 'dark');

  readonly hasChanged = this.changed.asReadonly();
  readonly isTransitioning = this.transitioning.asReadonly();

  private readonly storageKey = 'visomi.theme';

  private transitionTimer: number | undefined;
  private transitionFrame: number | undefined;

  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.document.defaultView?.clearTimeout(this.transitionTimer);
    this.document.defaultView?.cancelAnimationFrame?.(this.transitionFrame ?? 0);
  });

  setTheme(value: string): void {
    if (!isPreference(value)) {
      return;
    }

    const wasDark = this.isDark();

    this.selection.set(value);

    if (wasDark !== this.isDark()) {
      this.changed.set(true);
      this.transition();
    }

    try {
      this.document.defaultView?.localStorage.setItem(this.storageKey, value);
    } catch {
      // The selected theme remains active for the current page.
    }
  }

  private transition(): void {
    const view = this.document.defaultView;

    if (!view?.requestAnimationFrame) {
      return;
    }

    const duration = Number(
      view.getComputedStyle(this.document.documentElement).getPropertyValue('--ui-theme-duration-ms'),
    );

    view.clearTimeout(this.transitionTimer);
    view.cancelAnimationFrame(this.transitionFrame ?? 0);
    this.transitioning.set(true);
    this.transitionFrame = view.requestAnimationFrame(() => {
      this.transitionTimer = view.setTimeout(() => this.transitioning.set(false), duration);
    });
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
        this.transition();
      }
    };

    this.systemDark.set(media.matches);
    media.addEventListener('change', updateSystem);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', updateSystem));
  });
}
