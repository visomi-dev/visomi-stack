import {
  booleanAttribute,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  numberAttribute,
  output,
  viewChild,
} from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-input',
  templateUrl: './input.html',
  styleUrl: './input.css',
})
export class Input {
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  readonly formField = input.required<Field<string>>();
  readonly ariaDescribedBy = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly controlId = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly max = input<string | number | null>(null);
  readonly maxLength = input<string | number | null>(null, { transform: numberAttribute });
  readonly min = input<string | number | null>(null);
  readonly minLength = input<string | number | null>(null, { transform: numberAttribute });
  readonly name = input<string | null>(null);
  readonly pattern = input<string | null>(null);
  readonly placeholder = input('');
  readonly required = input(false, { transform: booleanAttribute });
  readonly type = input('text');
  readonly valueChange = output<string>();

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring w-full rounded-[var(--radius-control)] border bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-950 dark:text-slate-50 placeholder:text-slate-500 dark:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
      'border-[color:var(--color-border)] focus-visible:border-slate-600 dark:border-slate-500',
    ),
  );

  private readonly syncEffect = effect(() => {
    const ref = this.inputRef();
    const value = this.formField()().value();

    if (ref) {
      ref.nativeElement.value = value ?? '';
    }
  });

  onInput(event: Event): void {
    const nextValue = (event.target as HTMLInputElement).value;

    this.formField()().value.set(nextValue);
    this.valueChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
