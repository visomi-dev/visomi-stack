import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

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
import { Button } from '../../shared/ui/actions/button/button';
import { APP_URL, SIGN_IN_URL } from '../../shared/constants/routes';

type SignUpModel = { email: string; password: string; confirmation: string };
type CodeModel = { code: string };

@Component({
  imports: [AppForm, AuthCard, AuthLayout, Button, ErrorMessage, Field, Input, Label, PasswordInput, RouterLink],
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
  private readonly destroyRef = inject(DestroyRef);

  readonly passkeyEmailModel = signal({ email: '' });
  readonly passkeyEmailPending = signal(false);
  readonly model = signal<SignUpModel>({ email: '', password: '', confirmation: '' });
  readonly codeModel = signal<CodeModel>({ code: '' });
  readonly flowId = signal('');
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly complete = signal(false);
  readonly needsSignIn = signal(false);

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
  readonly codeForm: FieldTree<CodeModel> = form(this.codeModel, (path) => {
    required(path.code, { message: $localize`:@@identityOtpRequired:Enter the 6-digit code.` });
    minLength(path.code, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    maxLength(path.code, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    pattern(path.code, /^\d{6}$/u, { message: $localize`:@@identityOtpDigits:Use the 6 digits from your email.` });
  });
  readonly passkeyEmailForm = form(this.passkeyEmailModel, (path) => {
    required(path.email, { message: $localize`:@@signupEmailRequired:Enter your email address.` });
    email(path.email, { message: $localize`:@@signupEmailInvalid:Enter a valid email address.` });
  });

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly passwordMode = computed(() => this.params().get('method') === 'password');
  readonly emailError = computed(() => this.form.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.form.password().errors()[0]?.message ?? '');
  readonly confirmationError = computed(() => this.form.confirmation().errors()[0]?.message ?? '');
  readonly codeError = computed(() => this.codeForm.code().errors()[0]?.message ?? '');

  private registrationEpoch = 0;
  private registrationController?: AbortController;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelSignUp());
    let passwordMode = this.passwordMode();

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const nextPasswordMode = params.get('method') === 'password';

      if (nextPasswordMode !== passwordMode) {
        passwordMode = nextPasswordMode;
        this.cancelSignUp();
      }
    });
  }

  protected cancelSignUp(): void {
    this.registrationEpoch += 1;
    this.registrationController?.abort();
    this.registrationController = undefined;
    this.submitting.set(false);
    this.flowId.set('');
    this.passkeyEmailPending.set(false);
    this.complete.set(false);
    this.needsSignIn.set(false);
    this.codeModel.set({ code: '' });
    this.model.update((model) => ({ ...model, password: '', confirmation: '' }));
    this.error.set('');
  }

  protected async continueSignUp(): Promise<void> {
    if (this.destroyRef.destroyed || this.submitting() || (!this.complete() && !this.needsSignIn())) {
      return;
    }

    const destination = this.complete() && this.auth.isAuthenticated() ? APP_URL : SIGN_IN_URL;

    await this.router.navigate([destination], { queryParamsHandling: 'preserve' });
  }

  protected async createPasskey(): Promise<void> {
    if (this.passwordMode() || this.passkeyEmailForm().invalid() || !this.canRegister()) {
      return;
    }

    this.error.set('');
    if (!this.passkey.isSupported()) {
      this.error.set(
        $localize`:@@signupPasskeyUnsupported:This browser cannot create passkeys. Use another browser or create an account with a password.`,
      );

      return;
    }

    this.submitting.set(true);
    const epoch = ++this.registrationEpoch;

    try {
      const begin = await this.passkey.beginSignUp(this.passkeyEmailModel().email);

      if (!this.isCurrent(epoch)) {
        return;
      }

      if (!begin.challengeId || !begin.options) {
        throw new Error('Missing passkey options.');
      }

      this.registrationController = new AbortController();
      const credential = await this.passkey.createCredential(begin.options, {
        signal: this.registrationController.signal,
      });

      if (!this.isCurrent(epoch)) {
        return;
      }

      await this.passkey.completeSignUp(begin.challengeId, credential);
      if (this.isCurrent(epoch)) {
        this.passkeyEmailPending.set(true);
      }
    } catch (error) {
      if (this.isCurrent(epoch)) {
        this.error.set(
          this.message(
            error,
            $localize`:@@signupPasskeyFailed:Passkey creation was cancelled or could not be completed. Try again.`,
          ),
        );
      }
    } finally {
      if (this.isCurrent(epoch)) {
        this.registrationController = undefined;
        this.submitting.set(false);
      }
    }
  }

  protected async signUp(): Promise<void> {
    if (!this.passwordMode() || this.form().invalid() || !this.canRegister()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    const epoch = ++this.registrationEpoch;

    try {
      const response = await this.password.signUp({
        email: this.form.email().value(),
        password: this.form.password().value(),
      });

      if (!this.isCurrent(epoch)) {
        return;
      }

      this.flowId.set(response.flowId);
      this.codeModel.set({ code: '' });
      this.model.update((model) => ({ ...model, password: '', confirmation: '' }));
    } catch (error) {
      if (this.isCurrent(epoch)) {
        this.error.set(this.message(error, $localize`:@@signupFailed:We could not create your account.`));
      }
    } finally {
      if (this.isCurrent(epoch)) {
        this.submitting.set(false);
      }
    }
  }

  protected async verifySignUp(): Promise<void> {
    if (
      this.destroyRef.destroyed ||
      this.complete() ||
      this.needsSignIn() ||
      this.codeForm().invalid() ||
      (!this.flowId() && !this.passkeyEmailPending()) ||
      this.submitting()
    ) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    const epoch = ++this.registrationEpoch;
    let emailVerified = false;

    try {
      if (this.passkeyEmailPending()) {
        await this.passkey.verifySignUp(this.codeForm.code().value());
      } else {
        await this.password.verifySignUp(this.flowId(), this.codeForm.code().value());
      }

      if (!this.isCurrent(epoch)) {
        return;
      }

      emailVerified = true;
      this.codeModel.set({ code: '' });
      await this.auth.ensureSessionLoaded(true);

      if (!this.isCurrent(epoch)) {
        return;
      }

      this.flowId.set('');
      this.passkeyEmailPending.set(false);
      if (this.auth.isAuthenticated()) {
        this.complete.set(true);
        await this.router.navigate([APP_URL], { queryParamsHandling: 'preserve' });
      } else {
        this.needsSignIn.set(true);
      }
    } catch (error) {
      if (this.isCurrent(epoch)) {
        if (emailVerified && !this.complete()) {
          this.flowId.set('');
          this.passkeyEmailPending.set(false);
          this.needsSignIn.set(true);
          this.error.set(
            $localize`:@@signupSessionCheckFailed:Your email is verified, but we could not confirm that you are signed in. Sign in to continue.`,
          );
        } else if (!emailVerified) {
          this.error.set(this.message(error, $localize`:@@signupCodeFailed:That verification code is not valid.`));
        }
      }
    } finally {
      if (this.isCurrent(epoch)) {
        this.submitting.set(false);
      }
    }
  }

  private canRegister(): boolean {
    return (
      !this.destroyRef.destroyed &&
      !this.submitting() &&
      !this.flowId() &&
      !this.passkeyEmailPending() &&
      !this.complete() &&
      !this.needsSignIn()
    );
  }

  private isCurrent(epoch: number): boolean {
    return !this.destroyRef.destroyed && epoch === this.registrationEpoch;
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message
      : fallback;
  }
}
