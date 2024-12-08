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
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { TextInputComponent } from '~/app/shared/ui/form-fields/text-input/text-input.component';
import { PasswordInputComponent } from '~/app/shared/ui/form-fields/password-input/password-input.component';
import { ButtonComponent } from '~/app/shared/ui/button/button.component';
import { LinkComponent } from '~/app/shared/ui/link/link.component';
import { PasswordRequirementsComponent } from '~/app/shared/auth/password-requirements/password-requirements.component';
import { LocalLinkComponent } from '~/app/shared/ui/local-link/link.component';
import { AUTH_PAGE_CLASSES } from '~/app/config/classes';
import { AuthService } from '~/app/shared/auth/auth.service';
import {
  PRIVACY_POLICY_PATH,
  SIGN_IN_PATH,
  SIGN_UP_CONFIRM_PATH,
  TERMS_AND_CONDITIONS_PATH,
} from '~/app/config/routes';

@Component({
  selector: 'app-sign-up',
  standalone: true,
  imports: [
    NgClass,
    ReactiveFormsModule,
    TextInputComponent,
    PasswordInputComponent,
    ButtonComponent,
    LinkComponent,
    PasswordRequirementsComponent,
    LocalLinkComponent,
  ],
  templateUrl: './sign-up.component.html',
})
export default class SignUpComponent {
  @HostBinding('class') readonly cls = AUTH_PAGE_CLASSES;

  private readonly router = inject(Router);

  private readonly authService = inject(AuthService);

  signIn = `/${SIGN_IN_PATH}`;
  termsAndConditions = `/${TERMS_AND_CONDITIONS_PATH}`;
  privacyPolicy = `/${PRIVACY_POLICY_PATH}`;

  form = new FormGroup({
    nickname: new FormControl(''),
    username: new FormControl(''),
    password: new FormControl(''),
    passwordConfirm: new FormControl(''),
  });

  readonly password = toSignal(this.form.controls.password.valueChanges, {
    initialValue: '',
  });

  readonly error = signal<string | null>('');

  readonly signingUp = this.authService.loading;
  readonly loading = this.authService.loading;

  readonly formValueChanges = toSignal(this.form.valueChanges);

  readonly passwordConfirmPattern = computed(() => {
    return this.password()?.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&') ?? '';
  });

  async onSubmit() {
    const { nickname, username, password } = this.form.value;

    try {
      await this.authService.signUp(
        nickname!.trim(),
        username!.trim(),
        password!.trim(),
      );

      await this.router.navigate([`/${SIGN_UP_CONFIRM_PATH}`], {
        replaceUrl: true,
        state: { username },
      });
    } catch (_error: unknown) {
      this.error.set(
        $localize`El correo electrónico es inválido o ya está en uso, intenta con otro o ponte en contacto con soporte técnico.`,
      );
    }
  }

  formValueChangesEffect = effect(() => {
    this.formValueChanges();

    if (untracked(() => this.error())) {
      this.error.set(null);
    }
  });
}
