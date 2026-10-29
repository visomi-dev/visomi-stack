import { Directive, booleanAttribute, computed, input } from '@angular/core';

import { code as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'code[appUI]',
  host: { '[class]': 'classes()' },
})
export class Code {
  readonly block = input<boolean>(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => styles.classes({ block: this.block() }));
}
