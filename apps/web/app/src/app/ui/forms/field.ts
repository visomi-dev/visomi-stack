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
  styles: `
    :host([data-show-error]) > [data-slot='error']:not([hidden]) {
      grid-template-rows: 1fr;
      visibility: visible;
      opacity: 1;
      margin-top: 0;
    }
  `,
  host: {
    'data-control': '',
    '[attr.data-invalid]': 'invalid() ? "" : null',
    '[attr.data-manual-invalid]': 'manualError()?.trim() ? "" : null',
    '[class]': 'classes()',
  },
})
export class Field {
  readonly compact = input(false, { transform: booleanAttribute });
  protected readonly classes = computed(() => styles.classes({ compact: this.compact() }));

  readonly controlId = input.required<string>({ alias: 'control-id' });
  readonly label = input.required<string>();
  readonly description = input('');
  readonly error = input('');
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly manualError = input<string | null>(null, { alias: 'manual-error' });

  readonly descriptionId = computed(() => `${this.controlId()}-help`);
  readonly errorId = computed(() => `${this.controlId()}-error`);
  readonly message = computed(() => this.manualError()?.trim() || this.error().trim());
  readonly describedBy = computed(() => {
    const ids = [this.description() ? this.descriptionId() : null, this.message() ? this.errorId() : null];

    return ids.filter(Boolean).join(' ') || null;
  });
}
