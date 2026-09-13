import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';

import { Passkey } from '../../shared/auth/passkey';
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
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput],
  selector: 'app-password-management',
  templateUrl: './password-management.html',
  styleUrl: './password-management.css',
})
export class PasswordManagement {
  private readonly password = inject(PasswordAuth);
  private readonly passkey = inject(Passkey);
  private readonly security = inject(SecurityAuth);

  readonly enrollmentId = signal('');
  readonly secret = signal('');
  readonly submitting = signal(false);
  readonly enabled = signal(false);
  readonly recoveryCodes = signal<string[]>([]);
  readonly error = signal('');
  readonly codeModel = signal<CodeModel>({ code: '' });
  readonly codeForm: FieldTree<CodeModel> = form(this.codeModel, (path) => {
    required(path.code, { message: 'Enter the 6-digit authenticator code.' });
    minLength(path.code, 6, { message: 'Enter all 6 digits.' });
    maxLength(path.code, 6, { message: 'Enter all 6 digits.' });
    pattern(path.code, /^\d{6}$/u, { message: 'Use digits from your authenticator app.' });
  });
  readonly codeError = computed(() => this.codeForm.code().errors()[0]?.message ?? '');
  readonly passwordModel = signal<PasswordModel>({ currentPassword: '', password: '', confirmation: '' });
  readonly passwordForm: FieldTree<PasswordModel> = form(this.passwordModel, (path) => {
    required(path.currentPassword, { message: 'Enter your current password.' });
    required(path.password, { message: 'Enter a new password.' });
    minLength(path.password, 15, { message: 'Use at least 15 characters.' });
    maxLength(path.password, 512, { message: 'Use 512 characters or fewer.' });
    required(path.confirmation, { message: 'Confirm your new password.' });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: 'Passwords do not match.' },
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
      await this.reauthenticate('totp_change');
      const setup = await this.password.startTotpSetup();

      this.enrollmentId.set(setup.enrollmentId);
      this.secret.set(setup.secret);
    } catch (error) {
      this.error.set(this.message(error, 'Authenticator setup is not available right now.'));
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
      this.recoveryCodes.set(confirmed.recoveryCodes);
      this.codeModel.set({ code: '' });
    } catch (error) {
      this.error.set(this.message(error, 'That authenticator code is not valid.'));
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
    if (this.passwordForm.currentPassword().invalid() || this.submitting()) return;
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
      await this.reauthenticate(purpose);
      await mutation();
      this.passwordModel.set({ currentPassword: '', password: '', confirmation: '' });
    } catch (error) {
      this.error.set(this.message(error, 'Password settings could not be updated.'));
    } finally {
      this.submitting.set(false);
    }
  }

  private async reauthenticate(purpose: 'password_change' | 'password_remove' | 'totp_change'): Promise<void> {
    const grant = await this.security.startReauthentication(purpose);
    const authentication = await this.passkey.beginAuthentication();

    if (!authentication.challengeId || !authentication.options) throw new Error('Passkey options were not returned.');
    const credential = await this.passkey.getCredential(authentication.options);

    await this.passkey.completeAuthentication(authentication.challengeId, credential);
    await this.security.completeReauthentication({ grantId: grant.grantId, method: 'passkey' });
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message
      : fallback;
  }
}
