import {
  Component,
  booleanAttribute,
  computed,
  effect,
  input,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';

import { SelectOption } from '../../ui';

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './select.component.html',
})
export class SelectComponent {
  readonly form = input.required<FormGroup>();
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  readonly label = input<string>();
  readonly placeholder = input<string>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly readonly = input<boolean, unknown>(undefined, {
    transform: booleanAttribute,
  });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly error = input<string>();
  readonly help = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly options = input.required<SelectOption[]>();

  readonly requiredAttr = computed(() => (this.required() ? true : undefined));
  readonly readonlyAttr = computed(() => (this.readonly() ? true : undefined));

  readonly disabledEffect = effect(() => {
    const control = this.form().get(this.name());

    if (!control) {
      return;
    }

    const disabled = this.disabled();

    if (disabled) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  });
}
