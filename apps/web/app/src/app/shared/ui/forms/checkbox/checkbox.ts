import { booleanAttribute, Component, computed, input, output } from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'inline-flex',
    'data-control': '',
    '[attr.data-invalid]': 'invalid() ? "" : null',
  },
  imports: [],
  selector: 'app-checkbox',
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.css',
})
export class Checkbox {
  readonly ariaDescribedBy = input<string | null>(null);
  readonly controlId = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly name = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly checkedChange = output<boolean>();

  readonly formField = input.required<Field<boolean>>();

  readonly checked = computed(() => this.formField()().value() === true);
  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring ui-touch-target min-h-5 min-w-5 appearance-auto accent-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:accent-slate-500',
    ),
  );

  onChangeEvent(event: Event): void {
    const nextValue = (event.target as HTMLInputElement).checked;

    this.formField()().value.set(nextValue);
    this.checkedChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
