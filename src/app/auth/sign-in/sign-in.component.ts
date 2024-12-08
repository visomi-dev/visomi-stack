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

import { AuthService } from '~/app/shared/auth/auth.service';
import { TextInputComponent } from '~/app/shared/ui/form-fields/text-input/text-input.component';
import { PasswordInputComponent } from '~/app/shared/ui/form-fields/password-input/password-input.component';
import { ButtonComponent } from '~/app/shared/ui/button/button.component';
import { AUTH_PAGE_CLASSES } from '~/app/config/classes';
import { DASHBOARD_PATH, SIGN_UP_PATH } from '~/app/config/routes';
import { LocalLinkComponent } from '~/app/shared/ui/local-link/link.component';

@Component({
  selector: 'app-sign-in',
  imports: [
    ReactiveFormsModule,
    NgClass,
    TextInputComponent,
    PasswordInputComponent,
    ButtonComponent,
    LocalLinkComponent,
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
  signUpPath = `/${SIGN_UP_PATH}`;

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
