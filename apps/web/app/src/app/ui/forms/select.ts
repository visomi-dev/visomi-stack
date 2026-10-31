import { Directive, booleanAttribute, computed, input } from '@angular/core';

import { select as styles, type ControlSize } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'select[appUI]',
  host: { 'data-slot': 'control', '[class]': 'classes()' },
})
export class Select {
  readonly uiSize = input<ControlSize>('md');
  readonly inline = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize(), inline: this.inline() }));
}
