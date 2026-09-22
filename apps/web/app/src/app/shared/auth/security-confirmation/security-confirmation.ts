import {
  afterRenderEffect,
  Component,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { form, required } from '@angular/forms/signals';

import { Dialog } from '../../ui/overlays/dialog/dialog';
import { Form } from '../../ui/forms/form/form';
import { Field } from '../../ui/forms/field/field';
import { Label } from '../../ui/forms/label/label';
import { Input } from '../../ui/forms/input/input';
import { PasswordInput } from '../../ui/forms/password-input/password-input';
import { SecurityAction } from '../security-action';
import type { ConfirmationMethod } from '../security-action';
import { GoogleIdentity } from '../google-identity';

@Component({
  selector: 'app-security-confirmation',
  imports: [Dialog, Form, Field, Label, Input, PasswordInput],
  templateUrl: './security-confirmation.html',
  styleUrl: './security-confirmation.css',
})
export class SecurityConfirmation {
  protected readonly action = inject(SecurityAction);
  private readonly injector = inject(Injector);
  private readonly googleButton = viewChild<ElementRef<HTMLElement>>('googleButton');
  protected readonly googleError = signal('');
  private readonly renderGoogleButton = afterRenderEffect({
    write: () => {
      const challenge = this.action.google();
      const element = this.googleButton()?.nativeElement;

      this.googleError.set('');
      if (!challenge || !element) return;
      const isActive = () =>
        this.action.google() === challenge && this.googleButton()?.nativeElement === element && !this.action.busy();

      element.replaceChildren();
      void this.injector
        .get(GoogleIdentity)
        .renderReauthenticationButton(
          element,
          challenge.clientId,
          challenge.nonce,
          (idToken) => this.action.confirmGoogle(idToken, challenge),
          isActive,
        )
        .catch(() => {
          if (isActive())
            this.googleError.set(
              $localize`:@@securityConfirmGoogleUnavailable:Google confirmation could not be loaded. Try again.`,
            );
        });
    },
  });
  protected readonly method = signal<ConfirmationMethod>('passkey');
  protected readonly model = linkedSignal(() => {
    this.action.pending();

    return { password: '', code: '' };
  });
  protected readonly confirmation = form(this.model, (path) => {
    required(path.password, { when: () => this.method() === 'password' });
    required(path.code, {
      when: () =>
        this.method() === 'totp' ||
        this.method() === 'recovery_code' ||
        (this.method() === 'password' && this.action.passwordRequiresTotp()),
    });
  });

  protected label(method: ConfirmationMethod): string {
    switch (method) {
      case 'passkey':
        return $localize`:@@securityConfirmPasskey:Continue with a passkey`;
      case 'google':
        return $localize`:@@securityConfirmGoogle:Continue with Google`;
      case 'password':
        return $localize`:@@securityConfirmPassword:Use password`;
      case 'totp':
        return $localize`:@@securityConfirmTotp:Use authenticator code`;
      case 'recovery_code':
        return $localize`:@@securityConfirmRecovery:Use recovery code`;
    }
  }

  protected choose(method: ConfirmationMethod): void {
    if (this.action.busy()) return;
    this.method.set(method);
    this.model.set({ password: '', code: '' });
    if (method === 'passkey') void this.action.confirm(method);
  }

  protected async confirm(): Promise<void> {
    if (this.confirmation().invalid()) return;
    const { password, code } = this.model();

    this.model.set({ password: '', code: '' });
    await this.action.confirm(this.method(), password, code);
  }
}
