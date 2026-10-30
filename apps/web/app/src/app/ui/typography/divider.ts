import { Directive, booleanAttribute, computed, input } from '@angular/core';

import { divider as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'hr[appUI]',
  host: { '[class]': 'classes()' },
})
export class Divider {
  readonly soft = input<boolean>(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => styles.classes({ soft: this.soft() }));
}
