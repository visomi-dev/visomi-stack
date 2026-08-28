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
  selector: 'app-switch',
  templateUrl: './switch.html',
  styleUrl: './switch.css',
})
export class Switch {
  readonly formField = input.required<Field<boolean>>();
  readonly ariaDescribedBy = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly id = input<string | null>(null);
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  readonly checkedChange = output<boolean>();

  readonly checked = computed(() => this.formField()().value() === true);

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring relative inline-flex h-7 w-12 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50',
      this.checked() ? 'bg-accent' : 'bg-slate-950/10 dark:bg-white/10',
    ),
  );
  readonly thumbClasses = computed(() =>
    uiClass('size-5 rounded-full bg-white shadow transition', this.checked() ? 'translate-x-6' : 'translate-x-1'),
  );

  toggle(): void {
    if (this.disabled()) {
      return;
    }

    const nextValue = !this.checked();

    this.formField()().value.set(nextValue);
    this.checkedChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
