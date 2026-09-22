import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';

import { SecurityAction } from '../../shared/auth/security-action';
import { Auth } from '../../shared/auth/auth';
import { SECURITY_URL, SIGN_IN_URL } from '../../shared/constants/routes';
import { SecurityConfirmation } from '../../shared/auth/security-confirmation/security-confirmation';
import { PasswordAuth } from '../../shared/auth/password';
import { SecurityAuth } from '../../shared/auth/security-auth';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

type CodeModel = { code: string };
type PasswordModel = { currentPassword: string; password: string; confirmation: string };

@Component({
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput, SecurityConfirmation],
  providers: [SecurityAction],
  selector: 'app-password-management',
  templateUrl: './password-management.html',
  styleUrl: './password-management.css',
})
export class PasswordManagement {
  private readonly password = inject(PasswordAuth);
  private readonly action = inject(SecurityAction);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly security = inject(SecurityAuth);

  readonly enrollmentId = signal('');
  readonly secret = signal('');
  readonly submitting = signal(false);
  readonly enabled = signal(false);
  readonly recoveryCodes = signal<string[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly codeModel = signal<CodeModel>({ code: '' });
  readonly codeForm: FieldTree<CodeModel> = form(this.codeModel, (path) => {
    required(path.code, {
      message: $localize`:@@passwordAuthenticatorCodeRequired:Enter the 6-digit authenticator code.`,
    });
    minLength(path.code, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    maxLength(path.code, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    pattern(path.code, /^\d{6}$/u, {
      message: $localize`:@@passwordAuthenticatorDigits:Use digits from your authenticator app.`,
    });
  });
  readonly codeError = computed(() => this.codeForm.code().errors()[0]?.message ?? '');
  readonly passwordModel = signal<PasswordModel>({ currentPassword: '', password: '', confirmation: '' });
  readonly passwordForm: FieldTree<PasswordModel> = form(this.passwordModel, (path) => {
    required(path.currentPassword, { message: $localize`:@@passwordCurrentRequired:Enter your current password.` });
    required(path.password, { message: $localize`:@@passwordNewRequired:Enter a new password.` });
    minLength(path.password, 12, { message: $localize`:@@identityPasswordSetupLength:Use at least 12 characters.` });
    maxLength(path.password, 512, {
      message: $localize`:@@identityPasswordSetupMaxLength:Use 512 characters or fewer.`,
    });
    required(path.confirmation, { message: $localize`:@@passwordNewConfirmationRequired:Confirm your new password.` });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: $localize`:@@identityPasswordMismatch:Passwords do not match.` },
    );
  });
  readonly currentPasswordError = computed(() => this.passwordForm.currentPassword().errors()[0]?.message ?? '');
  readonly newPasswordError = computed(() => this.passwordForm.password().errors()[0]?.message ?? '');
  readonly confirmationError = computed(() => this.passwordForm.confirmation().errors()[0]?.message ?? '');

  protected async beginTotpSetup(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');

    try {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'totp_change',
          targetId: 'authenticator',
          summary: $localize`:@@securitySetupAuthenticator:Confirm your identity to set up your authenticator app.`,
        },
        async () => {
          const setup = await this.password.startTotpSetup();

          this.enrollmentId.set(setup.enrollmentId);
          this.secret.set(setup.secret);
        },
      );
    } catch (error) {
      this.error.set(
        this.message(error, $localize`:@@passwordTotpUnavailable:Authenticator setup is not available right now.`),
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected async confirmTotp(): Promise<void> {
    if (this.codeForm().invalid() || !this.enrollmentId() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');

    try {
      const confirmed = await this.password.confirmTotp(this.enrollmentId(), this.codeForm.code().value());

      this.enabled.set(true);
      this.secret.set('');
      this.recoveryCodes.set(confirmed.recoveryCodes);
      this.codeModel.set({ code: '' });
    } catch (error) {
      this.error.set(this.message(error, $localize`:@@passwordTotpInvalid:That authenticator code is not valid.`));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordForm().invalid() || this.submitting()) return;
    await this.runPasswordMutation('password_change', () =>
      this.security.changePassword(this.passwordForm.currentPassword().value(), this.passwordForm.password().value()),
    );
  }

  protected async removePassword(): Promise<void> {
    if (this.submitting()) return;
    if (this.passwordForm.currentPassword().invalid()) {
      this.passwordForm.currentPassword().markAsTouched();
      this.error.set(
        $localize`:@@passwordRemovalCurrentRequired:Enter your current password before removing password access.`,
      );

      return;
    }
    await this.runPasswordMutation('password_remove', () =>
      this.security.removePassword(this.passwordForm.currentPassword().value()),
    );
  }

  private async runPasswordMutation(
    purpose: 'password_change' | 'password_remove',
    mutation: () => Promise<void>,
  ): Promise<void> {
    this.submitting.set(true);
    this.error.set('');
    try {
      await this.action.run(
        {
          authority: 'operation',
          purpose,
          targetId: 'password',
          summary:
            purpose === 'password_change'
              ? $localize`:@@securityChangePassword:Confirm your identity to change your password.`
              : $localize`:@@securityRemovePassword:Confirm your identity to remove password access.`,
        },
        async () => {
          await mutation();
          this.notice.set($localize`:@@passwordSettingsUpdated:Password settings updated.`);
          await this.auth.ensureSessionLoaded(true);
          if (!this.auth.isAuthenticated())
            await this.router.navigate([SIGN_IN_URL], { queryParams: { returnTo: SECURITY_URL } });
        },
      );
    } catch (error) {
      this.error.set(
        this.message(
          error,
          $localize`:@@passwordSettingsFailed:Password settings could not be updated. Check the current state before trying again.`,
        ),
      );
    } finally {
      this.passwordModel.set({ currentPassword: '', password: '', confirmation: '' });
      this.submitting.set(false);
    }
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error?.code === 'last_access_method')
      return $localize`:@@securityKeepAccessMethod:Set up and verify another sign-in method before removing this one.`;

    return error instanceof HttpErrorResponse && error.status === 429
      ? $localize`:@@accessRateLimited:Too many attempts. Wait a moment before trying again.`
      : fallback;
  }
}
