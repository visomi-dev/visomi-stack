import { Directive, ElementRef, afterRenderEffect, computed, inject, input, untracked } from '@angular/core';

import { Navigation } from './navigation';

@Directive({
  selector: 'h1[appNavigationHeading]',
  host: {
    '[attr.tabindex]': 'focusable() ? -1 : null',
    '[attr.data-navigation-focus]': "focusable() ? '' : null",
  },
})
export class NavigationHeading {
  private readonly navigation = inject(Navigation);
  private readonly element = inject(ElementRef<HTMLHeadingElement>);

  readonly appHeadingFocus = input(false);

  protected readonly focusable = computed(() => this.appHeadingFocus() || this.navigation.headingFocus() !== null);

  private readonly focusAfterNavigation = afterRenderEffect({
    write: () => {
      if (this.navigation.headingFocus() || this.appHeadingFocus()) {
        untracked(() => this.element.nativeElement.focus());
      }
    },
  });
}
