import {
  Component,
  booleanAttribute,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { RadioOption } from '../../ui';
import {
  sizes,
  solidColors,
  Color,
  outlineColors,
  Size,
} from '../../../../config/classes';

@Component({
  selector: 'app-radio-buttons',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './radio-buttons.component.html',
})
export class RadioButtonsComponent {
  readonly sizes = sizes;
  readonly solidColors = solidColors;
  readonly outlineColors = outlineColors;
  readonly gridSizes = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  };

  readonly $disabled = signal(false);

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
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly requiredAttr = computed(() => (this.required() ? true : undefined));
  readonly readonlyAttr = computed(() => (this.readonly() ? true : undefined));
  readonly value = computed(() => this.form().get(this.name())?.value ?? '');

  readonly options = input.required<RadioOption[]>();
  readonly color = input<Color>('default');
  readonly size = input<Size>('md');

  readonly $inputClass = computed(() => {
    const classes = [];

    if (this.loading()) {
      classes.push(
        /* tw */ 'pointer-events-none relative flex items-center justify-center bg-opacity-90 text-transparent! after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent',
      );
    }

    return classes.join(' ');
  });

  readonly gridClass = computed(
    () => this.gridSizes[this.options.length as keyof typeof this.gridSizes],
  );

  getId(value: string): string {
    return `${this.id}-${value}`;
  }

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
}
