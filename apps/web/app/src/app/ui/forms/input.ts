import { Directive, computed, input } from '@angular/core';

import { input as styles, type ControlSize } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector:
    'input[appUI]:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=file]):not([type=hidden])',
  host: { 'data-slot': 'control', '[class]': 'classes()' },
})
export class Input {
  readonly uiSize = input<ControlSize>('md');

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize() }));
}
