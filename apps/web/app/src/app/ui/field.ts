import { booleanAttribute, computed, Directive, input } from '@angular/core';

import { field as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'div[appUI=field]',
  host: {
    'data-control': '',
    '[attr.data-invalid]': 'invalid() ? "" : null',
    '[attr.data-manual-invalid]': 'manualError() ? "" : null',
    '[class]': 'classes()',
  },
})
export class Field {
  readonly compact = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly manualError = input<string | null>(null);

  protected readonly classes = computed(() => styles.classes({ compact: this.compact() }));
}
