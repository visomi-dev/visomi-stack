import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';

import { Auth } from '../../shared/auth/auth';
import type { RestrictedAccount } from '../../shared/auth/auth.models';
import { Passkey } from '../../shared/auth/passkey';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { PasswordAuth, type PasswordSecondFactor, type PasswordSignInPending } from '../../shared/auth/password';
import { APP_URL, EMAIL_VERIFICATION_URL } from '../../shared/constants/routes';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';

type AccessState =
  | 'ready'
  | 'passkey-loading'
  | 'passkey-error'
  | 'password'
  | 'password-factor'
  | 'email'
  | 'otp'
  | 'account-choice'
  | 'password-setup'
  | 'password-setup-loading'
  | 'password-setup-success'
  | 'enrollment'
  | 'enrollment-loading'
  | 'verification'
  | 'verification-loading'
  | 'success';

type EmailModel = { email: string };
type PasswordModel = { email: string; password: string };
type PasswordSetupModel = { password: string; confirmation: string };
type OtpModel = { pin: string };
type EnrollmentModel = { label: string };

@Component({
  host: { class: /* tw */ 'block min-h-full w-full' },
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput, RouterLink],
  selector: 'app-identity',
  templateUrl: './identity.html',
  styleUrl: './identity.css',
})
export class Identity {
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  private readonly router = inject(Router);
  private readonly google = inject(GoogleIdentity);
  private readonly password = inject(PasswordAuth);
  private readonly googleButton = viewChild<ElementRef<HTMLElement>>('googleButton');

  readonly state = signal<AccessState>('ready');
  readonly errorMessage = signal('');
  readonly accounts = signal<RestrictedAccount[]>([]);
  readonly selectedAccount = signal<RestrictedAccount | null>(null);
  readonly flowId = signal('');
  readonly resendAvailableAt = signal('');
  readonly verificationChallengeId = signal('');
  readonly verificationOptions = signal<Record<string, unknown> | null>(null);
  readonly identityFlowId = signal('');
  readonly googleClientId = signal<string | null>(null);
  readonly passwordFlow = signal<PasswordSignInPending | null>(null);
  readonly passwordFactor = signal<PasswordSecondFactor | null>(null);
  readonly passwordSubmitting = signal(false);
  readonly passwordSetupSubmitting = signal(false);

  readonly emailModel = signal<EmailModel>({ email: '' });
  readonly emailForm: FieldTree<EmailModel> = form(this.emailModel, (path) => {
    required(path.email, { message: $localize`:@@identityEmailRequired:Enter an email you can verify.` });
    email(path.email, { message: $localize`:@@identityEmailInvalid:Enter a valid email address.` });
  });

  readonly otpModel = signal<OtpModel>({ pin: '' });
  readonly otpForm: FieldTree<OtpModel> = form(this.otpModel, (path) => {
    required(path.pin, { message: $localize`:@@identityOtpRequired:Enter the 6-digit code.` });
    minLength(path.pin, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    maxLength(path.pin, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    pattern(path.pin, /^\d{6}$/, { message: $localize`:@@identityOtpDigits:Use the 6 digits from your email.` });
  });

  readonly enrollmentModel = signal<EnrollmentModel>({ label: '' });
  readonly enrollmentForm: FieldTree<EnrollmentModel> = form(this.enrollmentModel, (path) => {
    required(path.label, { message: $localize`:@@identityPasskeyLabelRequired:Name this passkey.` });
    maxLength(path.label, 64, { message: $localize`:@@identityPasskeyLabelLength:Use 64 characters or fewer.` });
  });

  readonly emailError = computed(() => this.emailForm.email().errors()[0]?.message ?? '');
  readonly passwordModel = signal<PasswordModel>({ email: '', password: '' });
  readonly passwordForm: FieldTree<PasswordModel> = form(this.passwordModel, (path) => {
    required(path.email, { message: $localize`:@@identityPasswordEmailRequired:Enter your email address.` });
    email(path.email, { message: $localize`:@@identityPasswordEmailInvalid:Enter a valid email address.` });
    required(path.password, { message: $localize`:@@identityPasswordRequired:Enter your password.` });
    maxLength(path.password, 512, { message: $localize`:@@identityPasswordLength:Use 512 characters or fewer.` });
  });
  readonly passwordEmailError = computed(() => this.passwordForm.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.passwordForm.password().errors()[0]?.message ?? '');
  readonly passwordSetupModel = signal<PasswordSetupModel>({ password: '', confirmation: '' });
  readonly passwordSetupForm: FieldTree<PasswordSetupModel> = form(this.passwordSetupModel, (path) => {
    required(path.password, { message: $localize`:@@identityPasswordSetupRequired:Enter a password.` });
    minLength(path.password, 15, {
      message: $localize`:@@identityPasswordSetupLength:Use at least 15 characters.`,
    });
    maxLength(path.password, 512, {
      message: $localize`:@@identityPasswordSetupMaxLength:Use 512 characters or fewer.`,
    });
    required(path.confirmation, { message: $localize`:@@identityPasswordConfirmationRequired:Confirm your password.` });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: $localize`:@@identityPasswordMismatch:Passwords do not match.` },
    );
  });
  readonly passwordSetupError = computed(() => this.passwordSetupForm.password().errors()[0]?.message ?? '');
  readonly passwordConfirmationError = computed(() => this.passwordSetupForm.confirmation().errors()[0]?.message ?? '');
  readonly otpError = computed(() => this.otpForm.pin().errors()[0]?.message ?? '');
  readonly labelError = computed(() => this.enrollmentForm.label().errors()[0]?.message ?? '');

  protected async authenticateWithPasskey(): Promise<void> {
    if (this.state() === 'passkey-loading') return;

    if (!this.passkey.isSupported()) {
      this.failPasskey($localize`:@@identityPasskeyUnsupported:This browser cannot use a passkey here.`);

      return;
    }

    const retryRequested = this.state() === 'passkey-error';

    this.state.set('passkey-loading');
    this.errorMessage.set('');

    try {
      if (!this.identityFlowId()) this.identityFlowId.set((await this.auth.startIdentityFlow()).flowId);
      const begin = await this.passkey.beginAuthentication(retryRequested);

      if (!begin.options || !begin.challengeId) {
        throw new Error('Passkey options were not returned.');
      }

      const credential = await this.passkey.getCredential(begin.options);

      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      this.state.set('success');
      await this.router.navigateByUrl(APP_URL);
    } catch (error) {
      this.failPasskey(
        error instanceof DOMException && error.name === 'AbortError'
          ? $localize`:@@identityPasskeyCancelled:Passkey sign-in was cancelled. No changes were made.`
          : $localize`:@@identityPasskeyFailed:We could not verify that passkey.`,
      );
    }
  }

  protected async showGoogle(): Promise<void> {
    try {
      const flow = await this.auth.startIdentityFlow();

      this.identityFlowId.set(flow.flowId);
      if (!flow.google?.enabled || !flow.google.clientId || !flow.nonce || !this.googleButton())
        throw new Error('Google sign-in is not configured.');
      this.googleClientId.set(flow.google.clientId);
      await this.google.renderButton(
        this.googleButton()!.nativeElement,
        flow.google.clientId,
        flow.flowId,
        flow.nonce,
        (user) => {
          void this.auth.ensureSessionLoaded(true).then(() => this.router.navigateByUrl(APP_URL));
          this.state.set('success');
          this.selectedAccount.set(null);
          this.errorMessage.set('');
          void user;
        },
      );
    } catch (error) {
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityGoogleFailed:Google sign-in is not available right now.`),
      );
    }
  }

  protected showEmailRecovery(): void {
    this.errorMessage.set('');

    if (!this.emailModel().email) {
      this.state.set('email');

      return;
    }

    void this.sendEmailOtp();
  }

  protected showPassword(): void {
    this.errorMessage.set('');
    this.passwordModel.update((model) => ({ ...model, email: this.emailModel().email }));
    this.state.set('password');
  }

  protected async signInWithPassword(): Promise<void> {
    if (this.passwordForm().invalid() || this.passwordSubmitting()) return;

    this.errorMessage.set('');
    this.passwordSubmitting.set(true);
    this.state.set('password');

    try {
      const password = this.passwordForm.password().value();

      this.passwordModel.update((model) => ({ ...model, password: '' }));
      const pending = await this.password.signIn({
        email: this.passwordForm.email().value(),
        password,
      });

      this.passwordFlow.set(pending);
      this.passwordFactor.set(pending.requiredFactor);
      this.flowId.set(pending.flowId);
      this.resendAvailableAt.set(pending.resendAvailableAt ?? '');
      this.otpModel.set({ pin: '' });
      this.passwordModel.update((model) => ({ ...model, password: '' }));
      this.state.set('password-factor');
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.error?.code === 'email_unverified') {
        await this.router.navigate([EMAIL_VERIFICATION_URL], {
          queryParams: { email: this.passwordForm.email().value() },
        });

        return;
      }
      this.state.set('password');
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityPasswordFailed:We could not sign in with that password.`),
      );
    } finally {
      this.passwordSubmitting.set(false);
    }
  }

  protected async verifyPassword(): Promise<void> {
    const flowId = this.flowId();
    const factor = this.passwordFactor();

    if (!flowId || !factor || this.otpForm().invalid() || this.passwordSubmitting()) return;

    this.errorMessage.set('');
    this.passwordSubmitting.set(true);
    this.state.set('password-factor');

    try {
      await this.password.verify(flowId, this.otpForm.pin().value(), factor);
      await this.auth.ensureSessionLoaded(true);
      this.state.set('success');
      await this.router.navigateByUrl(APP_URL);
    } catch (error) {
      this.state.set('password-factor');
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityPasswordCodeFailed:That verification code is not valid. Try again.`),
      );
    } finally {
      this.passwordSubmitting.set(false);
    }
  }

  protected async resendPasswordCode(): Promise<void> {
    const flowId = this.flowId();

    if (!flowId || this.passwordFactor() !== 'email' || this.passwordSubmitting()) return;

    this.errorMessage.set('');
    this.passwordSubmitting.set(true);

    try {
      const response = await this.password.resend(flowId);

      this.resendAvailableAt.set(response.resendAvailableAt ?? '');
    } catch (error) {
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityPasswordResendFailed:We could not resend the verification code.`),
      );
    } finally {
      this.passwordSubmitting.set(false);
    }
  }

  protected showReady(): void {
    this.errorMessage.set('');
    this.passwordModel.update((model) => ({ ...model, password: '' }));
    this.state.set('ready');
  }

  protected async requestCode(): Promise<void> {
    if (this.emailForm().invalid()) return;

    await this.sendEmailOtp();
  }

  private async sendEmailOtp(): Promise<void> {
    this.errorMessage.set('');

    try {
      const email = this.emailForm.email().value();
      const started = this.identityFlowId() ? null : await this.auth.startIdentityFlow();
      const flowId = started?.flowId ?? this.identityFlowId();

      await this.auth.identifyIdentity(flowId, email);
      await this.auth.requestIdentityRecovery(flowId, email);

      this.identityFlowId.set(flowId);
      this.flowId.set(flowId);
      this.resendAvailableAt.set('');
      this.otpModel.set({ pin: '' });
      this.state.set('otp');
    } catch (error) {
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityEmailFailed:We could not send a code yet. Try again.`),
      );
    }
  }

  protected async verifyCode(): Promise<void> {
    if (this.otpForm().invalid() || !this.flowId()) return;

    this.errorMessage.set('');

    try {
      await this.auth.verifyIdentityRecovery(this.flowId(), this.otpForm.pin().value());

      const accounts = await this.auth.getRestrictedAccounts();

      this.accounts.set(accounts);
      const selected = accounts.find((account) => account.selected) ?? null;

      this.selectedAccount.set(selected);
      this.state.set(selected ? 'password-setup' : 'account-choice');
    } catch (error) {
      const accounts = this.accountChoices(error);

      if (accounts) {
        this.accounts.set(accounts);
        this.state.set('account-choice');

        return;
      }
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityOtpFailed:That code is not valid. Check it and try again.`),
      );
    }
  }

  protected async chooseAccount(account: RestrictedAccount): Promise<void> {
    try {
      const selected = await this.auth.selectRestrictedAccount(account.accountId);

      this.selectedAccount.set(selected);
      this.state.set('password-setup');
    } catch (error) {
      this.errorMessage.set(this.safeError(error, 'We could not select that account.'));
    }
  }

  protected skipPasswordSetup(): void {
    this.errorMessage.set('');
    this.state.set('enrollment');
  }

  protected async setPassword(): Promise<void> {
    if (this.passwordSetupForm().invalid() || this.passwordSetupSubmitting()) return;

    this.errorMessage.set('');
    this.passwordSetupSubmitting.set(true);
    this.state.set('password-setup-loading');

    try {
      await this.password.setPassword({ password: this.passwordSetupForm.password().value() });
      this.passwordSetupModel.set({ password: '', confirmation: '' });
      this.state.set('password-setup-success');
    } catch (error) {
      this.state.set('password-setup');
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityPasswordSetupFailed:We could not set your password. Try again.`),
      );
    } finally {
      this.passwordSetupSubmitting.set(false);
    }
  }

  protected continueToPasskeyEnrollment(): void {
    this.errorMessage.set('');
    this.state.set('enrollment');
  }

  protected async createPasskey(): Promise<void> {
    if (this.enrollmentForm().invalid()) return;

    this.errorMessage.set('');
    this.state.set('enrollment-loading');

    try {
      const begin = await this.passkey.beginRegistration(this.enrollmentForm.label().value());

      if (!begin.options || !begin.challengeId) {
        throw new Error('Passkey options were not returned.');
      }

      const credential = await this.passkey.createCredential(begin.options);

      const completed = await this.passkey.completeRegistration(begin.challengeId, credential);
      const verification = completed.restrictedSession;

      if (!verification?.verificationChallengeId || !verification.verificationOptions) {
        throw new Error('Passkey verification options were not returned.');
      }

      this.verificationChallengeId.set(verification.verificationChallengeId);
      this.verificationOptions.set(verification.verificationOptions);
      this.state.set('verification');
    } catch (error) {
      this.state.set('enrollment');
      this.errorMessage.set(
        error instanceof DOMException && error.name === 'AbortError'
          ? $localize`:@@identityEnrollmentCancelled:Passkey setup was cancelled. You can try again.`
          : this.safeError(error, $localize`:@@identityEnrollmentFailed:We could not create and verify that passkey.`),
      );
    }
  }

  protected async verifyNewPasskey(): Promise<void> {
    const challengeId = this.verificationChallengeId();
    const options = this.verificationOptions();

    if (!challengeId || !options) return;

    this.state.set('verification-loading');

    try {
      const assertion = await this.passkey.getCredential(options);

      await this.passkey.verifyRegistration(challengeId, assertion);
      await this.auth.ensureSessionLoaded(true);
      this.state.set('success');
      await this.router.navigateByUrl(APP_URL);
    } catch (error) {
      this.state.set('verification');
      this.errorMessage.set(this.safeError(error, 'We could not verify the new passkey. Try again.'));
    }
  }

  private failPasskey(message: string): void {
    this.errorMessage.set(message);
    this.state.set('passkey-error');
  }

  private safeError(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message
      : fallback;
  }

  private accountChoices(error: unknown): RestrictedAccount[] | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409 || error.error?.code !== 'multiple_accounts')
      return null;
    const accounts = error.error?.data?.accounts;

    return Array.isArray(accounts) ? accounts : null;
  }
}
