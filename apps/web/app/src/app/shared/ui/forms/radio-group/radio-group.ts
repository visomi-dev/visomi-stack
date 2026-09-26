import { NgTemplateOutlet } from '@angular/common';
import { booleanAttribute, Component, computed, contentChild, input, output } from '@angular/core';
import type { Field } from '@angular/forms/signals';

import { uiClass } from '../../classes';
import type { IconName } from '../../media/icon/icon-paths';

import { RadioOptionTemplate, type RadioOptionTemplateContext } from './radio-option-template';

export type RadioOption = {
  description?: string;
  disabled?: boolean;
  icon?: IconName;
  label: string;
  value: string;
};

@Component({
  host: {
    class: /* tw */ 'block',
    'data-control': '',
  },
  imports: [NgTemplateOutlet],
  selector: 'app-radio-group',
  templateUrl: './radio-group.html',
  styleUrl: './radio-group.css',
})
export class RadioGroup {
  protected readonly optionTemplate = contentChild.required(RadioOptionTemplate);
  readonly formField = input.required<Field<string>>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly ariaDescribedBy = input<string | null>(null);
  readonly layout = input<'vertical' | 'responsive'>('vertical');
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly legend = input('');
  readonly name = input(`radio-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`);
  readonly options = input<readonly RadioOption[]>([]);
  readonly required = input(false, { transform: booleanAttribute });
  readonly valueChange = output<string>();

  readonly value = computed(() => this.formField()().value() ?? '');
  readonly isDisabled = computed(() => this.disabled() || this.loading() || this.formField()().disabled());
  readonly isInvalid = computed(() => this.invalid() || (this.formField()().touched() && this.formField()().invalid()));

  readonly optionClasses = computed(() =>
    uiClass(
      'relative flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-950/10 bg-slate-50 p-3 text-sm text-slate-950 transition-colors dark:border-white/10 dark:bg-slate-900 dark:text-slate-50',
      'has-checked:border-blue-600 has-checked:bg-blue-50 dark:has-checked:border-blue-400 dark:has-checked:bg-blue-950/30 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-blue-600',
      'has-disabled:cursor-not-allowed has-disabled:opacity-50',
    ),
  );

  protected optionContext(option: RadioOption, index: number): RadioOptionTemplateContext {
    return {
      $implicit: option,
      descriptionId: `${this.name()}-${index}-description`,
      index,
      labelId: `${this.name()}-${index}-label`,
      selected: this.value() === option.value,
    };
  }

  selectValue(optionValue: string): void {
    if (this.isDisabled() || !this.options().some((option) => option.value === optionValue && !option.disabled)) return;
    this.formField()().value.set(optionValue);
    this.valueChange.emit(optionValue);
  }

  onBlur(): void {
    this.formField()().markAsTouched();
  }
}
