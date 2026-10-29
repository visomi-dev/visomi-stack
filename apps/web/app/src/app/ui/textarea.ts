import { Directive, computed, input } from '@angular/core';

import { textarea as styles, type ControlSize } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'textarea[appUI]',
  host: { '[class]': 'classes()' },
})
export class Textarea {
  readonly uiSize = input<ControlSize>('md');

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize() }));
}
