import { Directive, inject } from '@angular/core';

import { Theme } from './theme';

@Directive({
  selector: '[appUIThemeHost]',
  host: {
    '[class.dark]': 'theme.isDark()',
    '[attr.data-theme-transition]': "theme.isTransitioning() ? '' : null",
  },
})
export class ThemeHost {
  protected readonly theme = inject(Theme);
}
