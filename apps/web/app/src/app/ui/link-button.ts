import { Directive, computed, input } from '@angular/core';

import { linkButton as styles, type ButtonSize, type ButtonVariant } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'a[appUI=button]',
  host: { '[class]': 'classes()' },
})
export class LinkButton {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');

  protected readonly classes = computed(() => styles.classes({ variant: this.variant(), size: this.size() }));
}
