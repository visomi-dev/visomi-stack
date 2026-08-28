import { Signal, WritableSignal, Injectable, signal } from '@angular/core';

import { Settings, type Theme } from './settings';

@Injectable()
export class ServerSettings extends Settings {
  private readonly $theme: WritableSignal<Theme> = signal<Theme>('light');

  readonly isDark: Signal<boolean> = signal(false).asReadonly();
  readonly theme: Signal<Theme> = this.$theme.asReadonly();

  applyTheme(): void {
    // No-op on the server.
  }

  setTheme(_theme: Theme): void {
    // No-op on the server.
  }

  toggleTheme(): void {
    // No-op on the server.
  }
}
