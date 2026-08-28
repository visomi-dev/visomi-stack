import type { Signal } from '@angular/core';

export type Theme = 'dark' | 'light';

export abstract class Settings {
  abstract readonly isDark: Signal<boolean>;
  abstract readonly theme: Signal<Theme>;

  abstract applyTheme(): void;

  abstract setTheme(theme: Theme): void;

  abstract toggleTheme(): void;
}
