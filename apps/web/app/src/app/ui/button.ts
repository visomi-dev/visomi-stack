import { computed, Directive, input } from '@angular/core';

import { button, type ButtonSize, type ButtonVariant } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'button[ui]',
  host: {
    type: 'button',
    '[class]': 'classes()',
  },
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');

  protected readonly classes = computed(() => button.classes({ variant: this.variant(), size: this.size() }));
}
