import { Component } from '@angular/core';

import { ThemeSwitcher } from '../../ui';

@Component({
  selector: 'app-auth-appearance',
  imports: [ThemeSwitcher],
  template: `<button app-theme-switcher aria-label="Dark theme" i18n-aria-label="@@themeToggle"></button>`,
})
export class Appearance {}
