import {
  Component,
  Input,
  booleanAttribute,
  computed,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../../icon/icon.component';

@Component({
    selector: 'app-password-input',
    imports: [ReactiveFormsModule, NgClass, IconComponent],
    template: `
    <div [formGroup]="form" class="control flex flex-col gap-1">
      @if (label) {
        <label [for]="id">
          {{ label }}
        </label>
      }

      <div class="relative flex flex-col gap-1">
        <input
          [id]="id"
          [name]="name"
          [formControlName]="name"
          [type]="type()"
          [placeholder]="placeholder"
          class="w-full appearance-none rounded-md border-2 border-slate-300 bg-transparent px-3 py-2 placeholder:text-slate-400 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          [ngClass]="{
            'pointer-events-none relative flex items-center justify-center bg-opacity-90 !text-transparent after:absolute after:block after:h-[1em] after:w-[1em] after:animate-spin after:rounded-full after:border-2 after:border-r-transparent after:border-t-transparent':
              loading,
          }"
          [attr.pattern]="pattern"
          [attr.autocomplete]="autocomplete"
          [attr.minlength]="8"
          [attr.maxlength]="64"
          [attr.required]="true"
        />

        <app-icon
          [tabindex]="value.length === 0 ? -1 : 0"
          [icon]="icon()"
          class="absolute right-3 top-2.5 h-6 w-6 cursor-pointer rounded-md transition-all focus:outline focus:outline-1 focus:outline-offset-2 focus:outline-primary disabled:opacity-50"
          [ngClass]="{
            'pointer-events-none opacity-0': value.length === 0,
          }"
          (keyup)="toggleType($event)"
          (click)="toggleType()"
        />

        @if (error) {
          <p class="error overflow-hidden text-red-400 transition-all">
            {{ error }}
          </p>
        }
        @if (help) {
          <p class="text-xs text-opacity-75">
            {{ help }}
          </p>
        }
      </div>

      <ng-content />
    </div>
  `,
    styles: []
})
export class PasswordInputComponent {
  @Input({
    required: true,
  })
  form!: FormGroup;

  @Input({
    required: true,
  })
  id!: string;

  @Input({
    required: false,
  })
  label?: string;

  @Input({
    required: true,
  })
  name!: string;

  @Input({
    required: true,
  })
  placeholder!: string;

  @Input({
    required: false,
  })
  pattern =
    `^(?=.*[A-Za-z])(?=.*[0-9])(?=.*[._\\-'@$!%*#?&])[A-Za-z0-9._\\-'@$!%*#?&]{8,}$`;

  @Input({
    required: false,
  })
  autocomplete?: string;

  @Input({ required: false, transform: booleanAttribute }) loading = false;

  @Input({
    required: false,
  })
  error?: string;

  @Input({
    required: false,
  })
  help?: string;

  type = signal<'password' | 'text'>('password');

  readonly icon = computed(() =>
    this.type() === 'password' ? 'eye' : 'eye-off',
  );

  get value(): string {
    return this.form.get(this.name)?.value ?? '';
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

  toggleType(event?: KeyboardEvent) {
    if (!event || event.code === 'Space') {
      this.type.set(this.type() === 'password' ? 'text' : 'password');
    }
  }
}
