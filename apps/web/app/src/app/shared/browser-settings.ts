import { DOCUMENT } from '@angular/common';
import { Signal, WritableSignal, computed, inject, Injectable, signal } from '@angular/core';

import { THEME_KEY } from './constants/storage';
import { Settings, type Theme } from './settings';

@Injectable({ providedIn: 'root' })
export class BrowserSettings extends Settings {
  private readonly document = inject(DOCUMENT);

  private readonly $theme: WritableSignal<Theme> = signal<Theme>(this.getInitialTheme());

  readonly isDark: Signal<boolean> = computed(() => this.$theme() === 'dark');
  readonly theme: Signal<Theme> = this.$theme.asReadonly();

  applyTheme(): void {
    this.document.documentElement.classList.toggle('dark', this.isDark());
  }

  setTheme(theme: Theme): void {
    this.$theme.set(theme);
    this.persist(theme);
  }

  toggleTheme(): void {
    this.setTheme(this.$theme() === 'dark' ? 'light' : 'dark');
  }

  private getInitialTheme(): Theme {
    const storage = this.document.defaultView?.localStorage;

    if (storage) {
      const savedTheme = storage.getItem(THEME_KEY);

      if (savedTheme === 'dark' || savedTheme === 'light') {
        return savedTheme;
      }
    }

    const matchMedia = this.document.defaultView?.matchMedia;

    if (typeof matchMedia !== 'function') {
      return 'light';
    }

    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private persist(theme: Theme): void {
    this.document.defaultView?.localStorage.setItem(THEME_KEY, theme);
  }
}
