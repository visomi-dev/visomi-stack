import { Component, computed, inject, input } from '@angular/core';

import { Icon } from '../../ui/media/icon/icon';
import { Settings } from '../../settings';

type ThemeSwitcherVariant = 'toggle' | 'dropdown';

@Component({
  host: {
    class: /* tw */ 'contents',
  },
  imports: [Icon],
  selector: 'app-theme-switcher',
  templateUrl: './theme-switcher.html',
  styleUrl: './theme-switcher.css',
})
export class ThemeSwitcher {
  readonly settings = inject(Settings);
  readonly variant = input<ThemeSwitcherVariant>('dropdown');

  readonly iconName = computed(() => (this.settings.isDark() ? 'sun' : 'moon'));
  readonly isToggle = computed(() => this.variant() === 'toggle');
}
