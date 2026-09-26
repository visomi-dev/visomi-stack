import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

import { THEME_KEY } from './constants/storage';
import { Settings } from './settings';
import type { ProfilePreferences, Theme, ThemePreference } from './settings';

const LOCALE_IDENTITY_KEY = 'themis.preferences.locale-identity';

@Injectable({ providedIn: 'root' })
export class BrowserSettings extends Settings {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);
  private toolbarOverride = this.localOverride();
  private readonly preference = signal<ThemePreference>(this.toolbarOverride ?? 'system');

  readonly theme = computed<Theme>(() =>
    this.preference() === 'system'
      ? this.systemDark()
        ? 'dark'
        : 'light'
      : this.preference() === 'dark'
        ? 'dark'
        : 'light',
  );
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    super();
    const updateSystem = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);

    this.media?.addEventListener('change', updateSystem);
    this.destroyRef.onDestroy(() => this.media?.removeEventListener('change', updateSystem));
  }

  applyTheme(): void {
    this.document.documentElement.classList.toggle('dark', this.isDark());
    this.document.documentElement.style.colorScheme = this.theme();
  }

  setTheme(theme: Theme): void {
    this.toolbarOverride = theme;
    this.preference.set(theme);
    // Toolbar choice is a browser-local override, never a silent profile mutation.
    try {
      this.document.defaultView?.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Storage may be unavailable. */
    }
  }

  toggleTheme(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }

  applyProfilePreferences(
    userId: string,
    preferences: ProfilePreferences,
    routePath: string,
    source: 'login' | 'save',
  ): void {
    if (source === 'save') {
      this.toolbarOverride = null;
      // An explicit profile save takes precedence over the previous toolbar choice.
      try {
        this.document.defaultView?.localStorage.removeItem(THEME_KEY);
      } catch {
        /* Keep applying in memory. */
      }
      this.preference.set(preferences.theme);
    } else {
      this.preference.set(this.toolbarOverride ?? preferences.theme);
    }
    this.applyTheme();

    const view = this.document.defaultView;

    if (!view) return;
    try {
      // A locale toolbar link reloads Angular. Apply the saved locale only once per
      // identity/tab so that reload cannot undo a deliberate toolbar navigation.
      if (source === 'login' && view.sessionStorage.getItem(LOCALE_IDENTITY_KEY) === userId) return;
      view.sessionStorage.setItem(LOCALE_IDENTITY_KEY, userId);
    } catch {
      // Without a per-tab marker, automatic login redirects could defeat toolbar links.
      if (source === 'login') return;
    }
    const locale = this.document.documentElement.lang.startsWith('es') ? 'es' : 'en';

    if (locale === preferences.locale || !routePath.startsWith('/') || routePath.startsWith('//')) return;
    // Match LanguageSwitcher: reload the localized build, preserving route/query/hash.
    view.location.assign(`/app/${preferences.locale}${routePath === '/' ? '' : routePath}`);
  }

  private localOverride(): ThemePreference | null {
    try {
      const value = this.document.defaultView?.localStorage.getItem(THEME_KEY);

      return value === 'light' || value === 'dark' || value === 'system' ? value : null;
    } catch {
      return null;
    }
  }
}
