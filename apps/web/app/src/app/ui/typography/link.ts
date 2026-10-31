import { Directive, computed, input } from '@angular/core';

import { link as styles, type LinkVariant, type LinkUnderline } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'a[appUI]:not([appUI=button]):not([appUI=nav-item])',
  host: { '[class]': 'classes()' },
})
export class Link {
  readonly variant = input<LinkVariant>('default');
  readonly underline = input<LinkUnderline>('always');

  protected readonly classes = computed(() => styles.classes({ variant: this.variant(), underline: this.underline() }));
}
