import { CdkListbox, CdkOption, ListboxValueChangeEvent } from '@angular/cdk/listbox';
import { booleanAttribute, Component, effect, forwardRef, input, output, signal, viewChild } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { uiClass } from '../../classes';

export type ListboxOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

let listboxCounter = 0;

@Component({
  host: { class: /* tw */ 'block' },
  imports: [CdkListbox, CdkOption],
  providers: [{ multi: true, provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Listbox) }],
  selector: 'app-listbox',
  templateUrl: './listbox.html',
  styleUrl: './listbox.css',
})
export class Listbox implements ControlValueAccessor {
  private readonly cdkListbox = viewChild(CdkListbox);
  readonly generatedId = `app-listbox-${++listboxCounter}`;

  readonly ariaLabel = input('Options');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly options = input<readonly ListboxOption[]>([]);
  readonly valueChange = output<string>();

  private readonly lastWrittenValue = signal<string | null>(null);
  private readonly isSyncing = signal(false);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.lastWrittenValue.set(value ?? null);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    const listbox = this.cdkListbox();

    if (listbox) {
      listbox.disabled = isDisabled;
    }
  }

  handleValueChange(event: ListboxValueChangeEvent<string>): void {
    if (this.isSyncing()) {
      return;
    }

    const [next] = event.value;
    const nextValue = next ?? null;

    if (this.lastWrittenValue() === nextValue) {
      return;
    }

    this.onChange(nextValue ?? '');
    this.valueChange.emit(nextValue ?? '');
  }

  handleBlur(): void {
    this.onTouched();
  }

  readonly syncCdkStateEffect = effect(() => {
    const listbox = this.cdkListbox();
    const written = this.lastWrittenValue();

    if (!listbox) {
      return;
    }

    listbox.disabled = this.disabled();

    const current = listbox.value as readonly string[];

    if ((current[0] ?? null) === written) {
      return;
    }

    this.isSyncing.set(true);
    if (written === null) {
      for (const value of current) {
        listbox.deselectValue(value);
      }
    } else {
      listbox.selectValue(written);
    }
    queueMicrotask(() => {
      this.isSyncing.set(false);
    });
  });

  optionClasses(value: string, option: ListboxOption): string {
    const listbox = this.cdkListbox();
    const isSelected = listbox ? listbox.isValueSelected(value) : false;

    return uiClass(
      'cursor-default rounded-[var(--radius-control)] px-3 py-2 text-sm outline-none',
      isSelected && 'bg-accent text-accent-fg',
      !isSelected && 'text-slate-950 dark:text-slate-50',
      option.disabled && 'pointer-events-none opacity-50',
    );
  }
}
