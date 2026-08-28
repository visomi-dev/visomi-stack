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
  readonly inputId = input<string | null>(null);
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly name = input('radio-card');
  readonly optionValue = input.required<string>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly toggleable = input(true, { transform: booleanAttribute });
  readonly valueChange = output<string>();

  readonly value = computed(() => this.formField()().value() ?? '');
  readonly checked = computed(() => this.value() === this.optionValue());

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring relative flex min-h-24 cursor-pointer flex-col rounded-[var(--radius-panel)] border bg-slate-50 dark:bg-slate-900 p-4 text-slate-950 dark:text-slate-50 transition',
      this.checked()
        ? 'border-slate-600 dark:border-slate-500 ring-2 ring-slate-500/20'
        : 'border-slate-500/30 dark:border-slate-400/30 hover:bg-slate-100 dark:bg-slate-800',
      this.disabled() && 'pointer-events-none opacity-50',
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
    if (this.disabled()) {
      return;
    }

    const nextValue = this.checked() && this.toggleable() ? '' : this.optionValue();

    this.formField()().value.set(nextValue);
    this.valueChange.emit(nextValue);
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select();
    }
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
