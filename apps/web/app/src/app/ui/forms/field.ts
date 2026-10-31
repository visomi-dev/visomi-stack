import { booleanAttribute, Component, computed, input } from '@angular/core';

import { Description } from './description';
import { ErrorMessage } from './error-message';
import { Label } from './label';

import { field as styles } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-field',
  exportAs: 'appField',
  imports: [Label, Description, ErrorMessage],
  template: `
    <label appUI [for]="controlId()">{{ label() }}</label>
    <ng-content />
    @if (description()) {
      <p appUI="description" [id]="descriptionId()">{{ description() }}</p>
    }
    <p app-error [id]="errorId()" [hidden]="!message()">{{ message() }}</p>
  `,
  host: {
    'data-control': '',
    '[attr.data-invalid]': 'invalid() ? "" : null',
    '[attr.data-manual-invalid]': 'manualError()?.trim() ? "" : null',
    '[class]': 'classes()',
  },
})
export class Field {
  readonly controlId = input.required<string>({ alias: 'control-id' });
  readonly label = input.required<string>();
  readonly description = input('');
  readonly error = input('');
  readonly compact = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly manualError = input<string | null>(null, { alias: 'manual-error' });

  readonly descriptionId = computed(() => `${this.controlId()}-help`);
  readonly errorId = computed(() => `${this.controlId()}-error`);
  readonly message = computed(() => this.manualError()?.trim() || this.error().trim());
  readonly describedBy = computed(() => {
    const ids = [this.description() ? this.descriptionId() : null, this.message() ? this.errorId() : null];

    return ids.filter(Boolean).join(' ') || null;
  });
  protected readonly classes = computed(() => styles.classes({ compact: this.compact() }));
}
