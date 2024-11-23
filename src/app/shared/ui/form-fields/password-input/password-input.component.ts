import {
  Component,
  booleanAttribute,
  computed,
  signal,
  input,
  effect,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../../icon/icon.component';

@Component({
  selector: 'app-password-input',
  imports: [ReactiveFormsModule, NgClass, IconComponent],
  templateUrl: './password-input.component.html',
})
export class PasswordInputComponent {
  readonly form = input.required<FormGroup>();
  readonly id = input.required<string>();
  readonly label = input<string>();
  readonly name = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly pattern = input(
    `^(?=.*[A-Za-z])(?=.*[0-9])(?=.*[._\\-'@$!%*#?&])[A-Za-z0-9._\\-'@$!%*#?&]{8,}$`,
  );
  readonly autocomplete = input<string>();
  readonly loading = input(false, { transform: booleanAttribute });
  readonly error = input<string>();
  readonly help = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly type = signal<'password' | 'text'>('password');

  readonly icon = computed(() =>
    this.type() === 'password' ? 'eye' : 'eye-off',
  );
  readonly value = computed(() => this.form().get(this.name())?.value ?? '');

  toggleType(event?: KeyboardEvent) {
    if (!event || event.code === 'Space') {
      this.type.set(this.type() === 'password' ? 'text' : 'password');
    }
  }

  readonly disabledEffect = effect(() => {
    const control = this.form().get(this.name());

    if (!control) {
      return;
    }

    if (this.disabled()) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  });
}
