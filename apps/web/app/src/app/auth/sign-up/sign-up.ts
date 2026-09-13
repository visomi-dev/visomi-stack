import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import { PasswordAuth } from '../../shared/auth/password';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

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
  readonly model = signal<SignUpModel>({ email: '', password: '', confirmation: '' });
  readonly form: FieldTree<SignUpModel> = form(this.model, (path) => {
    required(path.email, { message: 'Enter your email address.' });
    email(path.email, { message: 'Enter a valid email address.' });
    required(path.password, { message: 'Enter a password.' });
    minLength(path.password, 15, { message: 'Use at least 15 characters.' });
    maxLength(path.password, 128, { message: 'Use 128 characters or fewer.' });
    required(path.confirmation, { message: 'Confirm your password.' });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: 'Passwords do not match.' },
    );
  });
  readonly codeModel = signal<CodeModel>({ code: '' });
  readonly codeForm: FieldTree<CodeModel> = form(this.codeModel, (path) => {
    required(path.code, { message: 'Enter the 6-digit code.' });
    minLength(path.code, 6, { message: 'Enter all 6 digits.' });
    maxLength(path.code, 6, { message: 'Enter all 6 digits.' });
    pattern(path.code, /^\d{6}$/u, { message: 'Use the 6 digits from your email.' });
  });
  readonly flowId = signal('');
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly complete = signal(false);
  readonly emailError = computed(() => this.form.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.form.password().errors()[0]?.message ?? '');
  readonly confirmationError = computed(() => this.form.confirmation().errors()[0]?.message ?? '');
  readonly codeError = computed(() => this.codeForm.code().errors()[0]?.message ?? '');

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
      this.error.set(this.message(error, 'We could not create your account.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async verifySignUp(): Promise<void> {
    if (this.codeForm().invalid() || !this.flowId() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      await this.password.verifySignUp(this.flowId(), this.codeForm.code().value());
      this.complete.set(true);
    } catch (error) {
      this.error.set(this.message(error, 'That verification code is not valid.'));
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
