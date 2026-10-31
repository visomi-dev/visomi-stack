import { Directive, ElementRef, inject } from '@angular/core';

import { Theme } from './theme';

@Directive({
  selector: 'select[appUITheme]',
  host: {
    '[value]': 'theme.preference()',
    '(change)': 'select()',
    'data-theme-select': '',
  },
})
export class ThemeSelect {
  protected readonly theme = inject(Theme);
  private readonly element = inject(ElementRef<HTMLSelectElement>);

  protected select(): void {
    this.theme.setTheme(this.element.nativeElement.value);
  }
}
