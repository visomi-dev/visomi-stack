import { booleanAttribute, Component, computed, input, output } from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';

export type ColorPickerOption = {
  class: string;
  label: string;
  selectedClass?: string;
  value: string;
};

const defaultOptions: readonly ColorPickerOption[] = Object.freeze([
  { class: /* tw */ 'bg-slate-500', label: 'Blue', selectedClass: /* tw */ 'ring-slate-500', value: 'BLUE' },
  { class: /* tw */ 'bg-pink-500', label: 'Pink', selectedClass: /* tw */ 'ring-pink-500', value: 'PINK' },
  { class: /* tw */ 'bg-purple-500', label: 'Purple', selectedClass: /* tw */ 'ring-purple-500', value: 'PURPLE' },
  { class: /* tw */ 'bg-green-500', label: 'Green', selectedClass: /* tw */ 'ring-green-500', value: 'GREEN' },
  { class: /* tw */ 'bg-yellow-500', label: 'Yellow', selectedClass: /* tw */ 'ring-yellow-500', value: 'YELLOW' },
]);

@Component({
  host: {
    class: /* tw */ 'block',
    'data-control': '',
  },
  imports: [],
  selector: 'app-color-picker',
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.css',
})
export class ColorPicker {
  readonly formField = input.required<Field<string>>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly label = input('');
  readonly name = input('color');
  readonly options = input<readonly ColorPickerOption[]>(defaultOptions);
  readonly required = input(false, { transform: booleanAttribute });
  readonly valueChange = output<string>();

  readonly value = computed(() => this.formField()().value() ?? '');

  readonly groupClasses = computed(() => uiClass('flex items-center gap-2', this.disabled() && 'opacity-50'));

  optionClasses(option: ColorPickerOption): string {
    return uiClass(
      'size-6 rounded-full border-2 border-black/10 transition',
      option.class,
      this.value() === option.value && 'ring-2 ring-offset-2 ring-offset-bg',
      this.value() === option.value && option.selectedClass,
    );
  }

  choose(optionValue: string): void {
    if (this.disabled()) {
      return;
    }

    this.formField()().value.set(optionValue);
    this.valueChange.emit(optionValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
