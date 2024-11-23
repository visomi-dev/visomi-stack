import { Component, Input, booleanAttribute } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';

import { SelectOption } from '../../ui';

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  template: `
    <div [formGroup]="form" class="control flex flex-col gap-1">
      @if (label) {
        <label [for]="id">
          {{ label }}
        </label>
      }

      <select
        [id]="id"
        [name]="name"
        [formControlName]="name"
        class="w-full appearance-none rounded-md border-2 border-slate-300 bg-transparent px-3 py-2 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        [ngClass]="{
          'pointer-events-none relative flex items-center justify-center bg-opacity-90 !text-transparent after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent':
            loading,
        }"
        [attr.required]="$required"
        [attr.readonly]="$readonly"
      >
        <option value="" hidden disabled selected>
          {{ placeholder }}
        </option>

        @for (option of options; track option.value) {
          <option [value]="option.value">
            {{ option.label }}
          </option>
        }
      </select>

      @if (error) {
        <p class="text-red-400">
          {{ error }}
        </p>
      }
      @if (help) {
        <p class="text-xs text-slate-500">
          {{ help }}
        </p>
      }

      <ng-content />
    </div>
  `,
  styles: [],
})
export class SelectComponent {
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
    required: true,
  })
  placeholder!: string;

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
    required: true,
  })
  options!: readonly SelectOption[];

  get $required() {
    return this.required ? true : undefined;
  }

  get $readonly() {
    return this.readonly ? true : undefined;
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
}
