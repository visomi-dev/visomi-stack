import { booleanAttribute, Component, computed, effect, ElementRef, input, output, viewChild } from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

@Component({
  host: { class: /* tw */ 'block' },
  selector: 'app-select',
  templateUrl: './select.html',
  styleUrl: './select.css',
})
export class Select {
  private readonly selectRef = viewChild<ElementRef<HTMLSelectElement>>('selectEl');

  readonly formField = input.required<Field<string>>();
  readonly ariaDescribedBy = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly id = input<string | null>(null);
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly name = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly valueChange = output<string>();

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring w-full rounded-[var(--radius-control)] border bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-950 dark:text-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
      'border-[color:var(--color-border)] focus-visible:border-slate-600 dark:border-slate-500',
    ),
  );

  private readonly syncEffect = effect(() => {
    const ref = this.selectRef();
    const value = this.formField()().value();

    if (ref) {
      ref.nativeElement.value = value ?? '';
    }
  });

  onChangeEvent(event: Event): void {
    const nextValue = (event.target as HTMLSelectElement).value;

    this.formField()().value.set(nextValue);
    this.valueChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
