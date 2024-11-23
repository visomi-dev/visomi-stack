import { NgClass } from '@angular/common';
import {
  Component,
  booleanAttribute,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { ColorName } from '../../ui';

type Option = {
  name: ColorName;
  classes: string;
  selected: string;
};

@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './color-picker.component.html',
})
export class ColorPickerComponent {
  readonly options: Option[] = [
    {
      name: 'BLUE',
      classes: /* tw */ 'bg-blue-500 md:focus:ring-blue-200',
      selected:
        /* tw */ 'ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-black ring-2',
    },
    {
      name: 'PINK',
      classes: /* tw */ 'bg-pink-500 md:focus:ring-pink-200',
      selected:
        /* tw */ 'ring-pink-500 ring-offset-2 ring-offset-white dark:ring-offset-black ring-2',
    },
    {
      name: 'PURPLE',
      classes: /* tw */ 'bg-purple-500 md:focus:ring-purple-200',
      selected:
        /* tw */ 'ring-purple-500 ring-offset-2 ring-offset-white dark:ring-offset-black ring-2',
    },
    {
      name: 'GREEN',
      classes: /* tw */ 'bg-green-500 md:focus:ring-green-200',
      selected:
        /* tw */ 'ring-green-500 ring-offset-2 ring-offset-white dark:ring-offset-black ring-2',
    },
    {
      name: 'YELLOW',
      classes: /* tw */ 'bg-yellow-500 md:focus:ring-yellow-200',
      selected:
        /* tw */ 'ring-yellow-500 ring-offset-2 ring-offset-white dark:ring-offset-black ring-2',
    },
  ];

  readonly form = input.required<FormGroup>();
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  readonly label = input<string>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly readonly = input<boolean, unknown>(undefined, {
    transform: booleanAttribute,
  });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly error = input<string>();
  readonly help = input<string>();
  readonly step = input<string | number>();
  readonly inputClass = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly $disabled = signal(false);

  readonly requiredAttr = computed(() => (this.required() ? true : undefined));
  readonly readonlyAttr = computed(() => (this.readonly() ? true : undefined));
  readonly value = computed(() => this.form().get(this.name())?.value ?? '');

  readonly disabledEffect = effect(() => {
    const control = this.form().get(this.name());

    if (!control) {
      return;
    }

    const disabled = this.disabled();

    this.$disabled.set(disabled);

    if (disabled) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  });

  getId(name: string): string {
    return `color-picker-${this.id}-${name}`;
  }
}
