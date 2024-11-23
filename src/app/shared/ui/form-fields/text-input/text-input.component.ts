import {
  Component,
  Input,
  booleanAttribute,
  numberAttribute,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
    selector: 'app-text-input',
    imports: [ReactiveFormsModule, NgClass],
    template: `
    <div [formGroup]="form" class="control flex flex-col gap-1">
      @if (label) {
        <label [for]="id">
          {{ label }}
        </label>
      }

      <input
        [id]="id"
        [name]="name"
        [formControlName]="name"
        [type]="type"
        [placeholder]="placeholder"
        [step]="step"
        class="w-full appearance-none rounded-md border-2 border-slate-300 bg-transparent px-3 py-2 placeholder:text-slate-400 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        [ngClass]="$inputClass"
        [attr.pattern]="pattern"
        [attr.autocomplete]="autocomplete"
        [attr.maxlength]="maxLength"
        [attr.minlength]="minLength"
        [attr.max]="max"
        [attr.min]="min"
        [attr.required]="$required"
        [attr.readonly]="$readonly"
      />

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

      <ng-content />
    </div>
  `,
    styles: []
})
export class TextInputComponent {
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
  })
  type?: string | 'text' | 'email' = 'text';

  @Input({
    required: true,
  })
  placeholder!: string;

  @Input({
    required: false,
  })
  pattern?: string;

  @Input({
    required: false,
  })
  autocomplete?: string;

  @Input({
    required: false,
    transform: numberAttribute,
  })
  minLength?: string | number;

  @Input({
    required: false,
    transform: numberAttribute,
  })
  maxLength?: string | number;

  @Input({
    required: false,
  })
  min?: string | number;

  @Input({
    required: false,
  })
  max?: string | number;

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
  step?: string | number;

  @Input({
    required: false,
  })
  inputClass?: string;

  get $required() {
    return this.required ? true : undefined;
  }

  get $readonly() {
    return this.readonly ? true : undefined;
  }

  get $inputClass() {
    const classes = [];

    if (this.inputClass) {
      classes.push(this.inputClass);
    }

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
}
