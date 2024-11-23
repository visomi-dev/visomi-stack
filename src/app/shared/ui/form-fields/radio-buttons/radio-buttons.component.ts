import { Component, Input, booleanAttribute } from '@angular/core';
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
  template: `
    <div class="control flex flex-col gap-1" [formGroup]="form">
      @if (label) {
        <p>
          {{ label }}
        </p>
      }

      <fieldset>
        <div class="grid" [ngClass]="gridClass">
          @for (option of options; track option.value; let index = $index) {
            <label
              [for]="getId(option.value)"
              class="relative flex w-full items-center justify-center gap-2 border focus:outline-none focus:ring-offset-4 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-black md:focus:ring-2"
              [ngClass]="[
                value === option.value
                  ? solidColors[color]
                  : outlineColors[color],
                sizes[size],
                index === 0 ? 'rounded-l-lg' : '',
                index === options.length - 1 ? 'rounded-r-lg' : '',
              ]"
            >
              <input
                type="radio"
                [id]="getId(option.value)"
                [name]="name"
                [value]="option.value"
                [formControlName]="name"
                class="sr-only"
              />

              <span> {{ option.label }} </span>
            </label>
          }
        </div>
      </fieldset>

      @if (error) {
        <p class="error overflow-hidden text-red-400 transition-all">
          {{ error }}
        </p>
      }

      @if (help) {
        <p class="text-xs text-slate-500">
          {{ help }}
        </p>
      }
    </div>
  `,
  styles: ``,
})
export class RadioButtonsComponent {
  @Input({
    required: true,
  })
  form!: FormGroup;

  @Input({
    required: true,
  })
  id!: string;

  @Input({
    required: true,
  })
  name!: string;

  @Input({
    required: true,
  })
  options!: readonly RadioOption[];

  @Input({
    required: false,
  })
  label?: string;

  @Input({
    required: false,
    transform: booleanAttribute,
  })
  required = false;

  @Input({
    required: false,
    transform: booleanAttribute,
  })
  readonly?: boolean;

  @Input({
    required: false,
    transform: booleanAttribute,
  })
  loading = false;

  @Input({
    required: false,
  })
  error?: string;

  @Input({
    required: false,
  })
  help?: string;

  @Input({
    required: false,
  })
  color: Color = 'default';

  @Input({
    required: false,
  })
  size: Size = 'md';

  sizes = sizes;
  solidColors = solidColors;
  outlineColors = outlineColors;

  gridSizes = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  };

  get $required() {
    return this.required ? true : undefined;
  }

  get $readonly() {
    return this.readonly ? true : undefined;
  }

  get $inputClass() {
    const classes = [];

    if (this.loading) {
      classes.push(
        /* tw */ 'pointer-events-none relative flex items-center justify-center bg-opacity-90 !text-transparent after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent',
      );
    }

    return classes.join(' ');
  }

  @Input() set disabled(value: boolean) {
    const control = this.form.get(this.name);

    if (!control) {
      return;
    }

    if (value) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  }

  get gridClass() {
    return this.gridSizes[this.options.length as keyof typeof this.gridSizes];
  }

  get value() {
    return this.form.get(this.name)?.value;
  }

  getId(value: string): string {
    return `${this.id}-${value}`;
  }
}
