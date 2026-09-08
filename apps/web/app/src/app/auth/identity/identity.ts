import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { email, form, maxLength, minLength, pattern, required, type FieldTree } from '@angular/forms/signals';

import { Auth } from '../../shared/auth/auth';
import type { RestrictedAccount } from '../../shared/auth/auth.models';
import { Passkey } from '../../shared/auth/passkey';
import { APP_URL } from '../../shared/constants/routes';
import { Alert } from '../../shared/ui/overlays/alert/alert';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { Button } from '../../shared/ui/actions/button/button';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';

type AccessState =
  | 'ready'
  | 'passkey-loading'
  | 'passkey-error'
  | 'email'
  | 'otp'
  | 'account-choice'
  | 'enrollment'
  | 'enrollment-loading'
  | 'verification'
  | 'verification-loading'
  | 'success';

type EmailModel = { email: string };
type OtpModel = { pin: string };
type EnrollmentModel = { label: string };

@Component({
  host: { class: /* tw */ 'block min-h-full w-full' },
  imports: [Alert, AppForm, AuthCard, AuthLayout, Button, ErrorMessage, Field, Input, Label],
  selector: 'app-identity',
  templateUrl: './identity.html',
  styleUrl: './identity.css',
})
export class Identity {
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  private readonly router = inject(Router);

  readonly state = signal<AccessState>('ready');
  readonly errorMessage = signal('');
  readonly accounts = signal<RestrictedAccount[]>([]);
  readonly selectedAccount = signal<RestrictedAccount | null>(null);
  readonly flowId = signal('');
  readonly resendAvailableAt = signal('');
  readonly verificationChallengeId = signal('');
  readonly verificationOptions = signal<Record<string, unknown> | null>(null);

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

  protected showEmailRecovery(): void {
    this.errorMessage.set('');

    if (!this.emailModel().email) {
      this.state.set('email');

      return;
    }

    void this.sendEmailOtp();
  }

  protected showReady(): void {
    this.errorMessage.set('');
    this.state.set('ready');
  }

  protected async requestCode(event: Event): Promise<void> {
    event.preventDefault();

    if (this.emailForm().invalid()) return;

    await this.sendEmailOtp();
  }

  private async sendEmailOtp(): Promise<void> {
    this.errorMessage.set('');

    try {
      const result = await this.auth.requestEmailOtp({
        email: this.emailForm.email().value(),
      });

      this.flowId.set(result.flowId);
      this.resendAvailableAt.set(result.resendAvailableAt);
      this.otpModel.set({ pin: '' });
      this.state.set('otp');
    } catch (error) {
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityEmailFailed:We could not send a code yet. Try again.`),
      );
    }
  }

  protected async verifyCode(event: Event): Promise<void> {
    event.preventDefault();

    if (this.otpForm().invalid() || !this.flowId()) return;

    this.errorMessage.set('');

    try {
      await this.auth.verifyEmailOtp({
        flowId: this.flowId(),
        pin: this.otpForm.pin().value(),
      });

      const accounts = await this.auth.getRestrictedAccounts();

      this.accounts.set(accounts);
      const selected = accounts.find((account) => account.selected) ?? null;

      this.selectedAccount.set(selected);
      this.state.set(selected ? 'enrollment' : 'account-choice');
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
      this.state.set('enrollment');
    } catch (error) {
      this.errorMessage.set(this.safeError(error, 'We could not select that account.'));
    }
  }

  protected async createPasskey(event: Event): Promise<void> {
    event.preventDefault();

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

  private async createEnrollmentState(): Promise<void> {
    this.selectedAccount.set(
      this.accounts().find((account) => account.accountId === this.auth.user()?.accountId) ?? null,
    );
    this.state.set('enrollment');
  }
}
