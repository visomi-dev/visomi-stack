import {
  booleanAttribute,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  numberAttribute,
  output,
  untracked,
  viewChildren,
} from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

const gridSizes = Object.freeze({
  1: /* tw */ 'grid-cols-1',
  2: /* tw */ 'grid-cols-2',
  3: /* tw */ 'grid-cols-3',
  4: /* tw */ 'grid-cols-4',
  5: /* tw */ 'grid-cols-5',
  6: /* tw */ 'grid-cols-6',
  7: /* tw */ 'grid-cols-7',
  8: /* tw */ 'grid-cols-8',
  9: /* tw */ 'grid-cols-9',
  10: /* tw */ 'grid-cols-10',
  11: /* tw */ 'grid-cols-11',
  12: /* tw */ 'grid-cols-12',
});

type GridSize = keyof typeof gridSizes;

type PinValue = {
  code: string;
};

const navigationKeys = Object.freeze(['Backspace', 'ArrowLeft', 'ArrowRight', 'Delete']);

@Component({
  host: {
    class: /* tw */ 'block',
    'data-control': '',
  },
  selector: 'app-pin-input',
  templateUrl: './pin-input.html',
  styleUrl: './pin-input.css',
})
export class PinInput {
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('inputs');

  readonly formField = input.required<Field<string>>();
  readonly ariaDescribedBy = input<string | null>(null);
  readonly ariaLabel = input('Verification code');
  readonly digits = input(6, { transform: numberAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly idPrefix = input('pin');
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly label = input('');
  readonly loading = input(false, { transform: booleanAttribute });
  readonly digitPattern = input('[0-9a-zA-Z]{1}');

  readonly completed = output<PinValue>();
  readonly valueChanges = output<PinValue>();

  readonly indexes = computed(() => Array.from({ length: this.digits() }, (_value, index) => index));
  readonly labelFor = computed(() => this.id(0));
  readonly gridClass = computed(() => gridSizes[this.gridSize()] ?? 'grid-cols-6');
  readonly inputClasses = computed(() =>
    uiClass(
      'ui-focus-ring h-14 w-full appearance-none rounded-[var(--radius-control)] border-2 bg-transparent px-3 py-2 text-center font-mono text-lg font-semibold text-slate-950 dark:text-slate-50 placeholder:text-slate-500 dark:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 md:h-16',
      'border-[color:var(--color-border)] focus-visible:border-slate-600 dark:border-slate-500',
      this.loading() &&
        'pointer-events-none relative flex items-center justify-center bg-slate-50 dark:bg-slate-900/90 !text-transparent after:absolute after:block after:size-[1em] after:animate-spin after:rounded-full after:border-2 after:border-current after:border-r-transparent after:border-t-transparent',
    ),
  );

  private readonly syncEffect = effect(() => {
    const value = this.formField()().value();
    const normalized = this.normalizeValue(value);

    untracked(() => {
      const inputs = this.inputs();

      for (let index = 0; index < inputs.length; index++) {
        const cell = inputs[index];

        if (!cell) {
          continue;
        }

        cell.nativeElement.value = normalized[index] ?? '';
      }

      this.valueChanges.emit({ code: value });
    });
  });

  id(index: number): string {
    return `${this.idPrefix()}-${index + 1}`;
  }

  name(index: number): string {
    return `${this.idPrefix()}-${index + 1}`;
  }

  valueAt(index: number): string {
    return this.normalizeValue(this.formField()().value())[index] ?? '';
  }

  onFocus(event: FocusEvent, index: number): void {
    const value = this.formField()().value();

    if (!value) {
      event.preventDefault();
      this.focusInput(0);

      return;
    }

    if (index > value.length) {
      event.preventDefault();
      this.focusInput(value.length);

      return;
    }

    if (value.length === this.digits()) {
      event.preventDefault();
      this.focusInput(this.digits() - 1);
    }
  }

  onPaste(event: ClipboardEvent, index: number): void {
    event.preventDefault();

    const pastedValue = event.clipboardData?.getData('text') ?? '';
    const pastedValues = this.normalizeValue(pastedValue).slice(0, this.digits() - index);

    if (!pastedValues.length) {
      return;
    }

    const nextValues = [...this.normalizeValue(this.formField()().value())];

    for (const [offset, value] of pastedValues.entries()) {
      nextValues[index + offset] = value;
    }

    this.commitValues(nextValues);
    this.focusInput(Math.min(index + pastedValues.length, this.digits() - 1));
  }

  onInput(event: Event, index: number): void {
    const target = event.target as HTMLInputElement;
    const current = target.value;

    if (!current) {
      this.setValueAt(index, '');

      return;
    }

    const characters = [...current].filter((character) => this.acceptsKey(character));

    if (characters.length === 0) {
      this.setValueAt(index, '');

      return;
    }

    this.setValueAt(index, characters[characters.length - 1] ?? '');
  }

  onKeyUp(event: KeyboardEvent, index: number): void {
    event.preventDefault();

    const value = this.formField()().value();

    if (!this.acceptsKey(event.key) && !navigationKeys.includes(event.key)) {
      return;
    }

    if (navigationKeys.includes(event.key) && value.length === 0) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      this.focusInput(Math.max(index - 1, 0));

      return;
    }

    if (event.key === 'ArrowRight') {
      this.focusInput(Math.min(index + 1, value.length));

      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.clearPreviousValue(index);

      return;
    }

    if (this.acceptsKey(event.key) && value.length <= this.digits()) {
      this.setValueAt(index, event.key);

      if (value.length < this.digits()) {
        this.focusInput(Math.min(index + 1, this.digits() - 1));
      }
    }
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }

  private clearPreviousValue(index: number): void {
    const currentValue = this.valueAt(index);
    const targetIndex = currentValue ? index : Math.max(index - 1, 0);

    this.setValueAt(targetIndex, '');
    this.focusInput(targetIndex);
  }

  private setValueAt(index: number, value: string): void {
    const nextValues = [...this.normalizeValue(this.formField()().value())];

    nextValues[index] = value.slice(0, 1);
    this.commitValues(nextValues);
  }

  private commitValues(nextValues: readonly string[]): void {
    const limited = nextValues.slice(0, this.digits());
    const joined = limited.join('');

    this.formField()().value.set(joined);

    if (joined.length === this.digits()) {
      this.completed.emit({ code: joined });
    }
  }

  private normalizeValue(value: string): string[] {
    return [...value].filter((character) => this.acceptsKey(character)).slice(0, this.digits());
  }

  private acceptsKey(key: string): boolean {
    return key.length === 1 && new RegExp(`^${this.digitPattern()}$`).test(key);
  }

  private focusInput(index: number): void {
    const inputElement = this.inputs()[index]?.nativeElement;

    inputElement?.focus();
    inputElement?.select();
  }

  private gridSize(): GridSize {
    const digits = this.digits();

    if (digits >= 1 && digits <= 12) {
      return digits as GridSize;
    }

    return 6;
  }
}
