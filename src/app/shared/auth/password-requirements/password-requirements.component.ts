import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';

import { IconComponent } from '~/app/shared/ui/icon/icon.component';

@Component({
  selector: 'app-password-requirements',
  standalone: true,
  imports: [NgClass, IconComponent],
  templateUrl: './password-requirements.component.html',
})
export class PasswordRequirementsComponent {
  readonly password = input<string | null>(null);

  readonly hasUpperCase = computed(() => {
    const password = this.password();

    if (password == null) {
      return false;
    }

    return /[A-Z]/.test(password);
  });

  readonly hasLowerCase = computed(() => {
    const password = this.password();

    if (password == null) {
      return false;
    }

    return /[a-z]/.test(password);
  });

  readonly hasNumber = computed(() => {
    const password = this.password();

    if (password == null) {
      return false;
    }

    return /\d/.test(password);
  });

  readonly hasSpecialCharacter = computed(() => {
    const password = this.password();

    if (password == null) {
      return false;
    }

    return /[$-/:-?{-~!"^_`[\]]/.test(password);
  });

  readonly hasMoreThan8Characters = computed(() => {
    const password = this.password();

    if (password == null) {
      return false;
    }

    return password.length > 7;
  });
}
