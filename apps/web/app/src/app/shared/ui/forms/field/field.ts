import { booleanAttribute, Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'block',
    'data-control': '',
    '[attr.data-invalid]': 'invalid() ? "" : null',
    '[attr.data-manual-invalid]': 'manualError() ? "" : null',
  },
  selector: 'app-field',
  templateUrl: './field.html',
  styleUrl: './field.css',
})
export class Field {
  readonly compact = input(false);
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly manualError = input<string | null>(null);

  readonly classes = computed(() => uiClass('grid', this.compact() ? 'gap-1.5' : 'gap-2'));
}
