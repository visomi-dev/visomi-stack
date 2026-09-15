import { booleanAttribute, Component, computed, input, output } from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { Icon } from '../../media/icon/icon';
import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'block',
    'data-control': '',
    '[attr.data-invalid]': 'invalid() ? "" : null',
  },
  imports: [Icon],
  selector: 'app-radio-card',
  templateUrl: './radio-card.html',
  styleUrl: './radio-card.css',
})
export class RadioCard {
  readonly formField = input.required<Field<string>>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly ariaDescribedBy = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly name = input('radio-card');
  readonly optionValue = input.required<string>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly valueChange = output<string>();

  readonly value = computed(() => this.formField()().value() ?? '');
  readonly checked = computed(() => this.value() === this.optionValue());
  readonly isDisabled = computed(() => this.disabled() || this.loading() || this.formField()().disabled());
  readonly isInvalid = computed(() => this.invalid() || (this.formField()().touched() && this.formField()().invalid()));

  readonly classes = computed(() =>
    uiClass(
      'relative flex min-h-24 cursor-pointer flex-col rounded-[var(--radius-panel)] border bg-slate-50 dark:bg-slate-900 p-4 pr-12 text-slate-950 dark:text-slate-50 transition has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-blue-600',
      this.checked()
        ? 'border-slate-600 dark:border-slate-500 ring-2 ring-slate-500/20'
        : 'border-slate-500/30 dark:border-slate-400/30 hover:bg-slate-100 dark:bg-slate-800',
      this.isDisabled() && 'cursor-not-allowed opacity-50',
    ),
  );
  readonly markerClasses = computed(() =>
    uiClass(
      'absolute right-3 top-3 flex size-6 items-center justify-center rounded-full border-2 transition',
      this.checked()
        ? 'border-slate-600 dark:border-slate-500 text-accent'
        : 'border-slate-500/30 dark:border-slate-400/30 text-transparent',
    ),
  );

  select(): void {
    if (this.isDisabled()) {
      return;
    }

    const nextValue = this.optionValue();

    this.formField()().value.set(nextValue);
    this.valueChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
