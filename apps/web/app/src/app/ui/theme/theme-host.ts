import { Directive, inject } from '@angular/core';

import { Theme } from './theme';

@Directive({
  selector: '[appUIThemeHost]',
  host: {
    '[class.dark]': 'theme.isDark()',
  },
})
export class ThemeHost {
  protected readonly theme = inject(Theme);
}
