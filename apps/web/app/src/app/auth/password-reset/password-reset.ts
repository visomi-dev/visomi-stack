import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import { PasswordAuth, type PasswordResetRequestResponse } from '../../shared/auth/password';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

type EmailModel = { email: string };
type ResetModel = {
  emailCode: string;
  factorCode: string;
  factorKind: 'totp' | 'recovery_code';
  password: string;
  confirmation: string;
};

@Component({
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput, RouterLink],
  selector: 'app-password-reset',
  templateUrl: './password-reset.html',
  styleUrl: './password-reset.css',
})
export class PasswordReset {
  private readonly password = inject(PasswordAuth);
  readonly emailModel = signal<EmailModel>({ email: '' });
  readonly emailForm: FieldTree<EmailModel> = form(this.emailModel, (path) => {
    required(path.email, { message: 'Enter your email address.' });
    email(path.email, { message: 'Enter a valid email address.' });
  });
  readonly resetModel = signal<ResetModel>({
    emailCode: '',
    factorCode: '',
    factorKind: 'totp',
    password: '',
    confirmation: '',
  });
  readonly resetForm: FieldTree<ResetModel> = form(this.resetModel, (path) => {
    required(path.emailCode, { message: 'Enter the 6-digit email code.' });
    minLength(path.emailCode, 6, { message: 'Enter all 6 digits.' });
    maxLength(path.emailCode, 6, { message: 'Enter all 6 digits.' });
    pattern(path.emailCode, /^\d{6}$/u, { message: 'Use the code from your email.' });
    required(path.password, { message: 'Enter a new password.' });
    minLength(path.password, 15, { message: 'Use at least 15 characters.' });
    maxLength(path.password, 128, { message: 'Use 128 characters or fewer.' });
    required(path.confirmation, { message: 'Confirm your new password.' });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: 'Passwords do not match.' },
    );
  });
  readonly flow = signal<PasswordResetRequestResponse | null>(null);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly complete = signal(false);
  readonly emailError = computed(() => this.emailForm.email().errors()[0]?.message ?? '');
  readonly emailCodeError = computed(() => this.resetForm.emailCode().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.resetForm.password().errors()[0]?.message ?? '');
  readonly confirmationError = computed(() => this.resetForm.confirmation().errors()[0]?.message ?? '');
  readonly factorRequired = computed(() => this.flow()?.requiredFactor === 'totp_or_recovery');

  protected async requestReset(): Promise<void> {
    if (this.emailForm().invalid() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      this.flow.set(await this.password.requestReset(this.emailForm.email().value()));
      this.resetModel.set({ emailCode: '', factorCode: '', factorKind: 'totp', password: '', confirmation: '' });
    } catch (error) {
      this.error.set(this.message(error, 'We could not start password reset.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async completeReset(): Promise<void> {
    if (this.resetForm().invalid() || !this.flow() || this.submitting()) return;
    if (this.factorRequired() && !this.resetModel().factorCode) {
      this.error.set('Enter your authenticator or recovery code.');

      return;
    }
    this.submitting.set(true);
    this.error.set('');
    try {
      const model = this.resetModel();

      await this.password.completeReset({
        flowId: this.flow()!.flowId,
        emailCode: model.emailCode,
        password: model.password,
        ...(model.factorCode ? { factor: { kind: model.factorKind, code: model.factorCode } } : {}),
      });
      this.complete.set(true);
    } catch (error) {
      this.error.set(this.message(error, 'We could not reset your password.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected changeFactorKind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;

    if (value === 'totp' || value === 'recovery_code')
      this.resetModel.update((model) => ({ ...model, factorKind: value }));
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message
      : fallback;
  }
}
