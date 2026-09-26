import { Injectable, signal } from '@angular/core';

import { Settings } from './settings';
import type { ProfilePreferences, Theme } from './settings';

@Injectable()
export class ServerSettings extends Settings {
  private readonly $theme = signal<Theme>('light');

  readonly isDark = signal(false).asReadonly();
  readonly theme = this.$theme.asReadonly();

  applyTheme(): void {
    // No-op on the server.
  }

  setTheme(_theme: Theme): void {
    // No-op on the server.
  }

  toggleTheme(): void {
    // No-op on the server.
  }

  applyProfilePreferences(
    _userId: string,
    _preferences: ProfilePreferences,
    _routePath: string,
    _source: 'login' | 'save',
  ): void {
    // Deterministic SSR: no browser storage, media queries, or locale redirects.
  }
}
