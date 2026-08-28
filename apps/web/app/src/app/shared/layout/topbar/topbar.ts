import { Component, inject, output } from '@angular/core';

import { Icon } from '../../ui/media/icon/icon';
import { Settings } from '../../settings';
import { LanguageSwitcher } from '../language-switcher/language-switcher';

@Component({
  imports: [Icon, LanguageSwitcher],
  selector: 'app-topbar',
  templateUrl: './topbar.html',
  styleUrl: './topbar.css',
})
export class Topbar {
  private readonly settings = inject(Settings);

  readonly openMobileMenu = output<void>();
  readonly isDark = this.settings.isDark;

  toggleTheme() {
    this.settings.toggleTheme();
  }
}
