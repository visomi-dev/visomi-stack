import { Component, afterNextRender, inject, signal } from '@angular/core';

import { Theme } from './theme';

import { themeSwitcher } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'button[app-theme-switcher]',
  templateUrl: './theme-switcher.html',
  host: {
    type: 'button',
    'data-theme-switcher': '',
    '[class]': 'visual.classes()',
    '[attr.aria-pressed]': 'theme.isDark()',
    '[attr.data-theme-animated]': "theme.hasChanged() ? '' : null",
    '[disabled]': '!ready()',
    '(click)': 'toggle()',
  },
})
export class ThemeSwitcher {
  protected readonly theme = inject(Theme);

  protected readonly ready = signal(false);

  protected readonly visual = themeSwitcher;

  protected toggle(): void {
    this.theme.setTheme(this.theme.isDark() ? 'light' : 'dark');
  }

  private readonly initialize = afterNextRender(() => this.ready.set(true));
}
