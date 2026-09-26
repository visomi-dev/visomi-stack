import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { PasswordAuth } from '../../shared/auth/password';
import { Auth } from '../../shared/auth/auth';
import { validatePasswordLength } from '../../shared/auth/password-validation';
import { Passkey } from '../../shared/auth/passkey';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { APP_URL } from '../../shared/constants/routes';

type SignUpModel = { email: string; password: string; confirmation: string };
type CodeModel = { code: string };

@Component({
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput, RouterLink],
  selector: 'app-sign-up',
  templateUrl: './sign-up.html',
  styleUrl: './sign-up.css',
})
export class SignUp {
  private readonly password = inject(PasswordAuth);
  private readonly passkey = inject(Passkey);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly passwordMode = computed(() => this.params().get('method') === 'password');
  readonly passkeyEmailModel = signal({ email: '' });
  readonly passkeyEmailForm = form(this.passkeyEmailModel, (path) => {
    required(path.email, { message: $localize`:@@signupEmailRequired:Enter your email address.` });
    email(path.email, { message: $localize`:@@signupEmailInvalid:Enter a valid email address.` });
  });
  readonly passkeyEmailPending = signal(false);
  readonly model = signal<SignUpModel>({ email: '', password: '', confirmation: '' });
  readonly form: FieldTree<SignUpModel> = form(this.model, (path) => {
    required(path.email, { message: $localize`:@@signupEmailRequired:Enter your email address.` });
    email(path.email, { message: $localize`:@@signupEmailInvalid:Enter a valid email address.` });
    required(path.password, { message: $localize`:@@identityPasswordSetupRequired:Enter a password.` });
    validatePasswordLength(path.password);
    required(path.confirmation, { message: $localize`:@@identityPasswordConfirmationRequired:Confirm your password.` });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: $localize`:@@identityPasswordMismatch:Passwords do not match.` },
    );
  });
  readonly codeModel = signal<CodeModel>({ code: '' });
  readonly codeForm: FieldTree<CodeModel> = form(this.codeModel, (path) => {
    required(path.code, { message: $localize`:@@identityOtpRequired:Enter the 6-digit code.` });
    minLength(path.code, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    maxLength(path.code, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    pattern(path.code, /^\d{6}$/u, { message: $localize`:@@identityOtpDigits:Use the 6 digits from your email.` });
  });
  readonly flowId = signal('');
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly complete = signal(false);
  readonly emailError = computed(() => this.form.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.form.password().errors()[0]?.message ?? '');
  readonly confirmationError = computed(() => this.form.confirmation().errors()[0]?.message ?? '');
  readonly codeError = computed(() => this.codeForm.code().errors()[0]?.message ?? '');

  protected async createPasskey(): Promise<void> {
    if (this.passkeyEmailForm().invalid() || this.submitting()) return;
    this.error.set('');
    if (!this.passkey.isSupported()) {
      this.error.set(
        $localize`:@@signupPasskeyUnsupported:This browser cannot create passkeys. Use another browser or create an account with a password.`,
      );

      return;
    }
    this.submitting.set(true);
    try {
      const begin = await this.passkey.beginSignUp(this.passkeyEmailModel().email);

      if (!begin.challengeId || !begin.options) throw new Error('Missing passkey options.');
      const credential = await this.passkey.createCredential(begin.options);

      await this.passkey.completeSignUp(begin.challengeId, credential);
      this.passkeyEmailPending.set(true);
    } catch (error) {
      this.error.set(
        this.message(
          error,
          $localize`:@@signupPasskeyFailed:Passkey creation was cancelled or could not be completed. Try again.`,
        ),
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected async signUp(): Promise<void> {
    if (this.form().invalid() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.password.signUp({
        email: this.form.email().value(),
        password: this.form.password().value(),
      });

      this.flowId.set(response.flowId);
      this.codeModel.set({ code: '' });
      this.model.update((model) => ({ ...model, password: '', confirmation: '' }));
    } catch (error) {
      this.error.set(this.message(error, $localize`:@@signupFailed:We could not create your account.`));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async verifySignUp(): Promise<void> {
    if (this.codeForm().invalid() || (!this.flowId() && !this.passkeyEmailPending()) || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      if (this.passkeyEmailPending()) {
        await this.passkey.verifySignUp(this.codeForm.code().value());
      } else {
        await this.password.verifySignUp(this.flowId(), this.codeForm.code().value());
      }
      await this.auth.ensureSessionLoaded(true);

      if (this.auth.isAuthenticated()) {
        await this.router.navigateByUrl(APP_URL);
      } else {
        this.complete.set(true);
      }
    } catch (error) {
      this.error.set(this.message(error, $localize`:@@signupCodeFailed:That verification code is not valid.`));
    } finally {
      this.submitting.set(false);
    }
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message
      : fallback;
  }
}
