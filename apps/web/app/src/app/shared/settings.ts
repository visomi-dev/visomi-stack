import type { Signal } from '@angular/core';

export type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'system';
export type ProfilePreferences = { locale: 'en' | 'es'; theme: ThemePreference };

export abstract class Settings {
  abstract readonly isDark: Signal<boolean>;
  abstract readonly theme: Signal<Theme>;

  abstract applyTheme(): void;

  abstract setTheme(theme: Theme): void;

  abstract applyProfilePreferences(
    userId: string,
    preferences: ProfilePreferences,
    routePath: string,
    source: 'login' | 'save',
  ): void;

  abstract toggleTheme(): void;
}
