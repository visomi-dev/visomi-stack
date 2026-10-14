import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';
import { DateTime } from 'luxon';

import type { RestrictedAccount } from '../../shared/auth/auth.models';
import { type PasswordSecondFactor, type PasswordSignInPending } from '../../shared/auth/password';
import { validatePasswordLength } from '../../shared/auth/password-validation';

type AccessState =
  | 'ready'
  | 'passkey-loading'
  | 'passkey-error'
  | 'password'
  | 'password-factor'
  | 'email'
  | 'otp'
  | 'accounts-loading'
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

export class SignInModel {
  readonly methodsOpen = signal(false);
  readonly passkeyVerifying = signal(false);
  readonly state = signal<AccessState>('ready');
  readonly errorMessage = signal('');
  readonly accounts = signal<RestrictedAccount[]>([]);
  readonly selectedAccount = signal<RestrictedAccount | null>(null);
  readonly flowId = signal('');
  readonly resendAvailableAt = signal('');
  readonly clock = signal(Date.now());
  readonly verificationNotice = signal('');
  readonly verificationRestartRequired = signal(false);
  readonly recoverySubmitting = signal(false);
  readonly recoveryFactorModel = signal<{ kind: 'totp' | 'recovery_code'; code: string }>({ kind: 'totp', code: '' });
  readonly verificationChallengeId = signal('');
  readonly identityFlowId = signal('');
  readonly googleClientId = signal<string | null>(null);
  readonly passwordFlow = signal<PasswordSignInPending | null>(null);
  readonly passwordFactor = signal<PasswordSecondFactor | 'recovery_code' | null>(null);
  readonly passwordSubmitting = signal(false);
  readonly passwordSetupSubmitting = signal(false);
  readonly emailModel = signal<EmailModel>({ email: '' });
  readonly otpModel = signal<OtpModel>({ pin: '' });
  readonly enrollmentModel = signal<EnrollmentModel>({ label: '' });
  readonly passwordModel = signal<PasswordModel>({ email: '', password: '' });
  readonly passwordSetupModel = signal<PasswordSetupModel>({ password: '', confirmation: '' });

  readonly recoveryFactorForm = form(this.recoveryFactorModel);
  readonly emailForm: FieldTree<EmailModel> = form(this.emailModel, (path) => {
    required(path.email, { message: $localize`:@@identityEmailRequired:Enter an email you can verify.` });
    email(path.email, { message: $localize`:@@identityEmailInvalid:Enter a valid email address.` });
  });
  readonly otpForm: FieldTree<OtpModel> = form(this.otpModel, (path) => {
    required(path.pin, { message: $localize`:@@identityOtpRequired:Enter the 6-digit code.` });

    const numeric = () => this.state() !== 'password-factor' || this.passwordFactor() !== 'recovery_code';

    minLength(path.pin, 6, { when: numeric, message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    maxLength(path.pin, 6, { when: numeric, message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    pattern(path.pin, /^\d{6}$/, {
      when: numeric,
      message: $localize`:@@identityOtpDigits:Use the 6 digits from your email.`,
    });
  });
  readonly enrollmentForm: FieldTree<EnrollmentModel> = form(this.enrollmentModel, (path) => {
    required(path.label, { message: $localize`:@@identityPasskeyLabelRequired:Name this passkey.` });
    maxLength(path.label, 64, { message: $localize`:@@identityPasskeyLabelLength:Use 64 characters or fewer.` });
  });
  readonly passwordForm: FieldTree<PasswordModel> = form(this.passwordModel, (path) => {
    required(path.email, { message: $localize`:@@identityPasswordEmailRequired:Enter your email address.` });
    email(path.email, { message: $localize`:@@identityPasswordEmailInvalid:Enter a valid email address.` });
    required(path.password, { message: $localize`:@@identityPasswordRequired:Enter your password.` });
    maxLength(path.password, 512, { message: $localize`:@@identityPasswordLength:Use 512 characters or fewer.` });
  });
  readonly passwordSetupForm: FieldTree<PasswordSetupModel> = form(this.passwordSetupModel, (path) => {
    required(path.password, { message: $localize`:@@identityPasswordSetupRequired:Enter a password.` });
    validatePasswordLength(path.password);
    required(path.confirmation, { message: $localize`:@@identityPasswordConfirmationRequired:Confirm your password.` });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: $localize`:@@identityPasswordMismatch:Passwords do not match.` },
    );
  });

  readonly resendSeconds = computed(() => {
    const deadline = DateTime.fromISO(this.resendAvailableAt()).toMillis();

    return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - this.clock()) / 1000)) : 0;
  });
  readonly emailError = computed(() => this.emailForm.email().errors()[0]?.message ?? '');
  readonly passwordEmailError = computed(() => this.passwordForm.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.passwordForm.password().errors()[0]?.message ?? '');
  readonly passwordSetupError = computed(() => this.passwordSetupForm.password().errors()[0]?.message ?? '');
  readonly passwordConfirmationError = computed(() => this.passwordSetupForm.confirmation().errors()[0]?.message ?? '');
  readonly otpError = computed(() => this.otpForm.pin().errors()[0]?.message ?? '');
  readonly labelError = computed(() => this.enrollmentForm.label().errors()[0]?.message ?? '');

  readonly verificationOptions = signal<Record<string, unknown> | null>(null);

  passwordAttempt = 0;
  recoveryAttempt = 0;
  destroyed = false;

  safeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 429) {
      return $localize`:@@accessRateLimited:Too many attempts. Wait a moment before trying again.`;
    }

    return fallback;
  }

  verificationError(
    error: unknown,
    fallback = $localize`:@@identityOtpFailed:That code is not valid. Check it and try again.`,
  ): string {
    if (error instanceof HttpErrorResponse) {
      const code: unknown = error.error?.code;

      if (code === 'recovery_unavailable') {
        return $localize`:@@identityRecoveryUnavailable:We could not verify recovery. Check your email code and, if you set up an authenticator, include an authenticator or recovery code.`;
      }

      if (code === 'challenge_expired' || code === 'challenge_attempt_limit' || code === 'password_factor_invalid') {
        this.verificationRestartRequired.set(true);

        return $localize`:@@accessVerificationRestart:This verification can no longer continue. Start again to get a new code.`;
      }
      if (error.status === 0) {
        return $localize`:@@accessVerificationOffline:We could not connect. Check your connection and try again.`;
      }
    }

    return this.safeError(error, fallback);
  }

  accountChoices(error: unknown): RestrictedAccount[] | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409 || error.error?.code !== 'multiple_accounts') {
      return null;
    }
    const accounts = error.error?.data?.accounts;

    return Array.isArray(accounts) ? accounts : null;
  }
}
