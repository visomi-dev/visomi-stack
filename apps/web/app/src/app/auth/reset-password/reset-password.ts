import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, minLength, required, validate, type FieldTree } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { SIGN_IN_URL } from '../../shared/constants/routes';
import { Alert } from '../../shared/ui/overlays/alert/alert';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { Button } from '../../shared/ui/actions/button/button';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Label } from '../../shared/ui/forms/label/label';
import { Link } from '../../shared/ui/typography/link/link';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';
import { PasswordStrength } from '../../shared/ui/forms/password-strength/password-strength';
import { VerificationCodeForm } from '../verification-code-form/verification-code-form';

type ResetStep = 'otp' | 'password' | 'success';

type PasswordModel = {
  password: string;
  confirmPassword: string;
};

@Component({
  host: {
    class: /* tw */ 'block min-h-full w-full',
  },
  imports: [
    Alert,
    AppForm,
    AuthCard,
    AuthLayout,
    Button,
    ErrorMessage,
    Field,
    FormField,
    Label,
    Link,
    PasswordInput,
    PasswordStrength,
    RouterLink,
    VerificationCodeForm,
  ],
  selector: 'app-reset-password',
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly step = signal<ResetStep>('otp');
  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  readonly pinManualError = signal<string | null>(null);

  readonly challenge = this.auth.pendingChallenge;
  readonly pendingEmail = computed(() => this.challenge()?.email ?? null);
  readonly verificationSubmitting = this.auth.verificationSubmitting;

  readonly passwordModel = signal<PasswordModel>({
    password: '',
    confirmPassword: '',
  });

  readonly passwordForm: FieldTree<PasswordModel> = form(
    this.passwordModel,
    (p) => {
      required(p.password, { message: $localize`:@@resetPasswordPasswordErrorRequired:Choose a new password.` });
      minLength(p.password, 8, {
        message: $localize`:@@resetPasswordPasswordErrorMinlength:Use at least 8 characters.`,
      });
      required(p.confirmPassword, {
        message: $localize`:@@resetPasswordConfirmErrorRequired:Re-enter your new password.`,
      });
      validate(p.confirmPassword, ({ value, valueOf }) => {
        const password = valueOf(p.password);
        const current = value();

        return current && password && current !== password
          ? {
              kind: 'passwordMismatch',
              message: $localize`:@@resetPasswordConfirmErrorMismatch:Passwords don't match.`,
            }
          : null;
      });
    },
    {
      submission: {
        action: async (field) => {
          await this.onPasswordSubmit(field);
        },
      },
    },
  );

  readonly passwordValue = computed(() => this.passwordForm.password().value());

  async onOtpSubmit(pin: string): Promise<void> {
    if (this.submitting()) {
      return;
    }

    const challenge = this.challenge();

    this.pinManualError.set(null);

    if (!challenge) {
      this.errorMessage.set(
        $localize`:@@resetPasswordMissingChallenge:The recovery session has expired. Please request a new code.`,
      );

      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.verifyPasswordReset(challenge.challengeId, pin);
      this.step.set('password');
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? $localize`:@@resetPasswordVerifyFailed:That code didn't work. Try again.`)
          : $localize`:@@resetPasswordVerifyFailed:That code didn't work. Try again.`,
      );
      this.pinManualError.set($localize`:@@resetPasswordPinErrorMismatch:That code didn't work. Try again.`);
    } finally {
      this.submitting.set(false);
    }
  }

  private async onPasswordSubmit(field: FieldTree<PasswordModel>): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.submitPasswordReset(field().value().password);
      this.auth.clearPendingChallenge();
      this.step.set('success');
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? $localize`:@@resetPasswordUpdateFailed:Could not update the password.`)
          : $localize`:@@resetPasswordUpdateFailed:Could not update the password.`,
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected readonly signInUrl = SIGN_IN_URL;
}
