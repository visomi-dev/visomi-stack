import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { form, FormField, minLength, required, type FieldTree } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import { Card } from '../shared/ui/layout/card/card';
import { Heading } from '../shared/ui/typography/heading/heading';
import { PasswordInput } from '../shared/ui/forms/password-input/password-input';
import { Button } from '../shared/ui/actions/button/button';
import { Auth } from '../shared/auth/auth';
import { Passkey, type PasskeyCredential } from '../shared/auth/passkey';

type PasswordModel = { password: string; confirmPassword: string };
type StatusResponse = { data: { configured: boolean; setupAvailable: boolean } };
type View = 'list' | 'add' | 'name' | 'revoke';

@Component({
  imports: [Button, Card, DatePipe, FormField, Heading, PasswordInput],
  selector: 'app-security',
  templateUrl: './security.html',
  styleUrl: './security.css',
})
export class Security {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly configured = signal(false);
  readonly setup = signal(false);
  readonly reauthenticated = signal(false);
  readonly credentials = signal<PasskeyCredential[]>([]);
  readonly view = signal<View>('list');
  readonly selected = signal<PasskeyCredential | null>(null);
  readonly passkeyName = signal('');
  readonly passkeyLoading = signal(true);
  readonly passkeySubmitting = signal(false);
  readonly passkeyError = signal('');
  readonly model = signal<PasswordModel>({ password: '', confirmPassword: '' });
  readonly passwordForm: FieldTree<PasswordModel> = form(this.model, (p) => {
    required(p.password, { message: 'Choose a password.' });
    minLength(p.password, 12, { message: 'Use at least 12 characters.' });
    required(p.confirmPassword, { message: 'Confirm your password.' });
  });

  constructor() {
    void this.loadStatus();
    void this.loadCredentials();
  }

  private async loadStatus() {
    try {
      const result = await firstValueFrom(this.http.get<StatusResponse>('/api/auth/security/password'));

      this.configured.set(result.data.configured);
      this.setup.set(result.data.setupAvailable);
    } catch {
      this.error.set('Security status could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCredentials() {
    try {
      this.credentials.set(await this.passkey.listCredentials());
    } catch {
      this.passkeyError.set('Passkeys could not be loaded.');
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  showAdd() {
    this.passkeyError.set('');
    this.passkeyName.set('');
    this.view.set('add');
  }

  showRename(credential: PasskeyCredential) {
    this.passkeyError.set('');
    this.selected.set(credential);
    this.passkeyName.set(credential.label);
    this.view.set('name');
  }

  showRevoke(credential: PasskeyCredential) {
    this.passkeyError.set('');
    this.selected.set(credential);
    this.view.set('revoke');
  }

  cancelPasskeyAction() {
    this.selected.set(null);
    this.view.set('list');
  }

  setPasskeyName(event: Event) {
    const input = event.target;

    if (input instanceof HTMLInputElement) this.passkeyName.set(input.value);
  }

  async addPasskey() {
    const name = this.passkeyName().trim();

    if (!name || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(async () => {
      const user = this.auth.user();

      if (!user) throw new Error('Sign in again before adding a passkey.');
      const authentication = await this.passkey.beginAuthentication(user.email, true);
      const existing = await this.passkey.getCredential(authentication.options!);

      await this.passkey.completeAuthentication(authentication.challengeId!, existing);
      const registration = await this.passkey.beginRegistration(user.email, name, true);
      const credential = await this.passkey.createCredential(registration.options!);

      await this.passkey.completeRegistration(registration.challengeId!, credential);
      await this.loadCredentials();
      this.cancelPasskeyAction();
    });
  }

  async renamePasskey() {
    const selected = this.selected();
    const name = this.passkeyName().trim();

    if (!selected || !name || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(async () => {
      await this.reauthenticateWithPasskey();
      const updated = await this.passkey.renameCredential(selected.id, name);

      this.credentials.update((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      this.cancelPasskeyAction();
    });
  }

  async revokePasskey() {
    const selected = this.selected();

    if (!selected || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(async () => {
      await this.reauthenticateWithPasskey();
      await this.passkey.revokeCredential(selected.id);
      this.credentials.update((items) => items.filter((item) => item.id !== selected.id));
      this.cancelPasskeyAction();
    });
  }

  private async reauthenticateWithPasskey() {
    const user = this.auth.user();

    if (!user) throw new Error('Sign in again before changing passkeys.');
    const authentication = await this.passkey.beginAuthentication(user.email, true);
    const credential = await this.passkey.getCredential(authentication.options!);

    await this.passkey.completeAuthentication(authentication.challengeId!, credential);
  }

  private async runPasskeyMutation(mutation: () => Promise<void>) {
    this.passkeySubmitting.set(true);
    this.passkeyError.set('');
    try {
      await mutation();
    } catch (error) {
      this.passkeyError.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Passkey action failed.')
          : 'Passkey action failed.',
      );
    } finally {
      this.passkeySubmitting.set(false);
    }
  }

  async beginSetup() {
    this.error.set('');
    try {
      await firstValueFrom(this.http.post('/api/auth/security/password/reauthenticate', {}));
      this.reauthenticated.set(true);
      this.setup.set(true);
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Recent sign-in required.')
          : 'Recent sign-in required.',
      );
    }
  }

  async savePassword() {
    if (this.submitting() || this.passwordForm().invalid()) return;
    const value = this.passwordForm().value();

    if (value.password !== value.confirmPassword) {
      this.error.set("Passwords don't match.");

      return;
    }
    this.submitting.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.http.post('/api/auth/security/password', value));
      this.configured.set(true);
      this.setup.set(false);
      this.reauthenticated.set(false);
      this.model.set({ password: '', confirmPassword: '' });
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Could not configure the password.')
          : 'Could not configure the password.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
