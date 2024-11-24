import {
  Component,
  HostBinding,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { AuthService } from '../../shared/auth/auth.service';
import { TextInputComponent } from '../../shared/ui/form-fields/text-input/text-input.component';
import { PasswordInputComponent } from '../../shared/ui/form-fields/password-input/password-input.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { AUTH_PAGE_CLASSES } from '../../config/classes';
import { DASHBOARD_PATH } from '../../config/routes';

@Component({
  selector: 'app-sign-in',
  imports: [
    ReactiveFormsModule,
    NgClass,
    TextInputComponent,
    PasswordInputComponent,
    ButtonComponent,
  ],
  templateUrl: './sign-in.component.html',
  styles: [],
})
export default class SignInComponent {
  @HostBinding('class') readonly cls = AUTH_PAGE_CLASSES;

  private readonly router = inject(Router);

  private readonly authService = inject(AuthService);

  form = new FormGroup({
    username: new FormControl<string>(''),
    password: new FormControl<string>(''),
  });

  readonly error = signal<string | null>('');
  readonly signing = this.authService.signing;

  readonly loading = computed(
    () => this.signing() || this.authService.loading(),
  );

  readonly formValueChanges = toSignal(this.form.valueChanges);

  async onSubmit() {
    const { username, password } = this.form.value;

    if (!username || !password) {
      return;
    }

    try {
      await this.authService.signIn(username.trim(), password.trim());

      await this.router.navigate([`/${DASHBOARD_PATH}`], {
        replaceUrl: true,
      });
    } catch (error: unknown) {
      console.error(error);

      this.error.set(
        $localize`:@@signInError:Correo electrónico o contraseña incorrectos`,
      );
    }
  }

  readonly formValueChangesEffect = effect(() => {
    this.formValueChanges();

    if (untracked(() => this.error())) {
      this.error.set(null);
    }
  });
}
