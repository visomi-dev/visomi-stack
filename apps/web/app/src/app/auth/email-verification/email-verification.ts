import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { email, form, maxLength, minLength, pattern, required, type FieldTree } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { APP_URL, IDENTITY_URL } from '../../shared/constants/routes';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

type EmailModel = { email: string };
type CodeModel = { pin: string };

@Component({
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label],
  selector: 'app-email-verification',
  templateUrl: './email-verification.html',
  styleUrl: './email-verification.css',
})
export class EmailVerification {
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly emailModel = signal<EmailModel>({ email: this.route.snapshot.queryParamMap.get('email') ?? '' });
  readonly emailForm: FieldTree<EmailModel> = form(this.emailModel, (path) => {
    required(path.email, { message: 'Enter your email address.' });
    email(path.email, { message: 'Enter a valid email address.' });
  });
  readonly codeModel = signal<CodeModel>({ pin: '' });
  readonly codeForm: FieldTree<CodeModel> = form(this.codeModel, (path) => {
    required(path.pin, { message: 'Enter the 6-digit code.' });
    minLength(path.pin, 6, { message: 'Enter all 6 digits.' });
    maxLength(path.pin, 6, { message: 'Enter all 6 digits.' });
    pattern(path.pin, /^\d{6}$/u, { message: 'Use the 6 digits from your email.' });
  });
  readonly flowId = signal('');
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly complete = signal(false);
  readonly emailError = computed(() => this.emailForm.email().errors()[0]?.message ?? '');
  readonly codeError = computed(() => this.codeForm.pin().errors()[0]?.message ?? '');

  protected async requestVerification(): Promise<void> {
    if (this.emailForm().invalid() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');

    try {
      const response = await this.auth.requestEmailOtp({ email: this.emailForm.email().value() });

      this.flowId.set(response.flowId);
      this.codeModel.set({ pin: '' });
    } catch (error) {
      this.error.set(this.message(error, 'We could not send a verification code.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async verifyEmail(): Promise<void> {
    if (this.codeForm().invalid() || !this.flowId() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');

    try {
      const session = await this.auth.verifyEmailOtp({ flowId: this.flowId(), pin: this.codeForm.pin().value() });

      this.complete.set(true);
      if (session.kind === 'full') await this.router.navigateByUrl(APP_URL);
    } catch (error) {
      this.error.set(this.message(error, 'That verification code is not valid.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected readonly signInUrl = IDENTITY_URL;

  private message(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message
      : fallback;
  }
}
