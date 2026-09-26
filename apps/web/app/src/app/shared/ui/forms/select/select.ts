import { NgTemplateOutlet } from '@angular/common';
import {
  afterEveryRender,
  booleanAttribute,
  Component,
  computed,
  contentChild,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

import { SelectOptions } from './select-options';

@Component({
  host: { class: /* tw */ 'block' },
  imports: [NgTemplateOutlet],
  selector: 'app-select',
  templateUrl: './select.html',
  styleUrl: './select.css',
})
export class Select<T extends string = string> {
  protected readonly options = contentChild(SelectOptions);
  readonly ariaDescribedBy = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly controlId = input<string | null>(null);
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

  readonly formField = input.required<Field<T>>();

  private readonly selectRef = viewChild<ElementRef<HTMLSelectElement>>('selectEl');

  onChangeEvent(event: Event): void {
    const nextValue = (event.target as HTMLSelectElement).value;

    this.formField()().value.set(nextValue as T);
    this.valueChange.emit(nextValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }

  // Options can arrive from a parent view without changing the field value.
  private readonly syncEffect = afterEveryRender({
    write: () => {
      const ref = this.selectRef();
      const value = this.formField()().value();

      if (ref && ref.nativeElement.value !== value) {
        ref.nativeElement.value = value ?? '';
      }
    },
  });
}
