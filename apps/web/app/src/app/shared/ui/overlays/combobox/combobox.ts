import { OverlayModule } from '@angular/cdk/overlay';
import { Component, computed, forwardRef, input, output, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { uiClass } from '../../classes';
import type { ListboxOption } from '../listbox/listbox';

@Component({
  host: { class: /* tw */ 'block' },
  imports: [OverlayModule],
  providers: [{ multi: true, provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Combobox) }],
  selector: 'app-combobox',
  templateUrl: './combobox.html',
  styleUrl: './combobox.css',
})
export class Combobox implements ControlValueAccessor {
  readonly ariaLabel = input('Choose option');
  readonly id = input<string | null>(null);
  readonly options = input<readonly ListboxOption[]>([]);
  readonly placeholder = input('Search...');
  readonly valueChange = output<string>();

  readonly activeIndex = signal(0);
  readonly formDisabled = signal(false);
  readonly open = signal(false);
  readonly query = signal('');
  readonly value = signal('');

  readonly selectedLabel = computed(() => this.options().find((option) => option.value === this.value())?.label ?? '');
  readonly filteredOptions = computed(() => {
    const query = this.query().trim().toLowerCase();

    if (!query) {
      return this.options();
    }

    return this.options().filter((option) => option.label.toLowerCase().includes(query));
  });
  readonly activeId = computed(() => `combobox-option-${this.activeIndex()}`);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
    this.query.set(this.selectedLabel());
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.formDisabled.set(disabled);
  }

  optionClasses(index: number, option: ListboxOption): string {
    return uiClass(
      'cursor-default rounded-[var(--radius-control)] px-3 py-2 text-sm',
      this.value() === option.value && 'bg-accent text-accent-fg',
      this.value() !== option.value &&
        index === this.activeIndex() &&
        'bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-slate-50',
      this.value() !== option.value && index !== this.activeIndex() && 'text-slate-950 dark:text-slate-50',
      option.disabled && 'pointer-events-none opacity-50',
    );
  }

  updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.open.set(true);
    this.activeIndex.set(0);
  }

  choose(option: ListboxOption, index: number): void {
    if (option.disabled || this.formDisabled()) {
      return;
    }

    this.activeIndex.set(index);
    this.value.set(option.value);
    this.query.set(option.label);
    this.open.set(false);
    this.onChange(option.value);
    this.valueChange.emit(option.value);
  }

  chooseFromOptionKeydown(event: KeyboardEvent, option: ListboxOption, index: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.choose(option, index);
    }
  }

  handleKeydown(event: KeyboardEvent): void {
    const options = this.filteredOptions();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open.set(true);
      this.activeIndex.set(Math.min(options.length - 1, this.activeIndex() + 1));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(0, this.activeIndex() - 1));
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[this.activeIndex()];

      if (option) {
        this.choose(option, this.activeIndex());
      }
    }

    if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  markTouched(): void {
    this.onTouched();
  }
}
