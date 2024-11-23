import { NgClass } from '@angular/common';
import { Component, Input, booleanAttribute, signal } from '@angular/core';
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
  template: `
    <fieldset [formGroup]="form" class="control flex flex-col gap-1">
      @if (label) {
        <legend>
          {{ label }}
        </legend>
      }

      <div
        class="ml-1 mt-1 flex items-center gap-2 md:mb-1 md:mt-2"
        [ngClass]="{
          'opacity-50': disabled$(),
        }"
      >
        @for (option of options; track option.name) {
          <div
            class="relative -m-0.5 flex cursor-pointer items-center justify-center rounded-full p-1 focus:outline-none focus:ring-0"
          >
            <label [for]="getId(option.name)" class="sr-only">
              {{ option.name }}
            </label>

            <div
              class="relative h-6 w-6 rounded-full border-2 border-black border-opacity-10"
              [ngClass]="[
                option.classes,
                value === option.name ? option.selected : '',
              ]"
            >
              <input
                [id]="getId(option.name)"
                [name]="name"
                [formControlName]="name"
                [value]="option.name"
                type="radio"
                class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                [attr.required]="$required"
              />
            </div>
          </div>
        }
      </div>

      @if (error) {
        <p class="mt-1 text-red-400">
          {{ error }}
        </p>
      }
      @if (help) {
        <p class="mt-1 text-xs text-slate-500">
          {{ help }}
        </p>
      }

      <ng-content />
    </fieldset>
  `,
  styles: [],
})
export class ColorPickerComponent {
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

  options: Option[] = [
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

  readonly disabled$ = signal(false);

  get value() {
    return this.form.get(this.name)?.value;
  }

  get $required() {
    return this.required ? true : undefined;
  }

  get $readonly() {
    return this.readonly ? true : undefined;
  }

  @Input() set disabled(value: boolean) {
    const control = this.form.get(this.name);

    this.disabled$.set(value);

    if (!control) {
      return;
    }

    if (value) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  }

  getId(name: string): string {
    return `color-picker-${this.id}-${name}`;
  }
}
