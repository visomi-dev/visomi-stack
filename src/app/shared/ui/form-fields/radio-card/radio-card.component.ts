import { Component, Input, booleanAttribute } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../../icon/icon.component';

@Component({
  selector: 'app-radio-card',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule, IconComponent],
  template: `
    <label
      tabindex="0"
      [for]="id"
      class="relative flex flex-col rounded-md border bg-white p-2 transition-all focus:outline-none focus:ring-primary focus:ring-offset-4 focus:ring-offset-white dark:bg-transparent dark:focus:ring-offset-black md:focus:ring-2"
      [ngClass]="inputClasses"
      [formGroup]="form"
      (keyup)="onKeyUp($event)"
    >
      <input
        [id]="id"
        type="radio"
        [value]="value"
        class="absolute inset-0 h-full w-full opacity-0"
        [formControlName]="name"
        (click)="onSelect()"
      />

      <ng-content />

      <div
        class="absolute right-3 top-2 h-6 w-6 rounded-full border-2 p-0.5 transition-all"
        [ngClass]="inputClasses"
      >
        <app-icon
          icon="check"
          class="transition-all"
          [ngClass]="[checked ? 'text-primary' : 'opacity-0']"
        />
      </div>
    </label>
  `,
  styles: [],
})
export class RadioCardComponent {
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
  value!: string;

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

  get $required() {
    return this.required ? true : undefined;
  }

  get $readonly() {
    return this.readonly ? true : undefined;
  }

  get checked() {
    return this.form.get(this.name)?.value === this.value;
  }

  get inputClasses() {
    return this.checked ? 'border-primary' : 'border-black dark:border-white';
  }

  onKeyUp(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    this.onSelect();
  }

  onSelect(event?: MouseEvent) {
    if (event) {
      event.preventDefault();
    }

    const control = this.form.get(this.name);

    if (!control) {
      return;
    }

    const value = control.value;

    if (value === this.value) {
      control.setValue('');
    } else {
      control.setValue(this.value);
    }
  }
}
