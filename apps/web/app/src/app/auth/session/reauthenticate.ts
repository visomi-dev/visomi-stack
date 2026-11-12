import { Component, afterNextRender, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, disabled, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Field, Input } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { CodeEntry } from '../shared/code-entry';
import { ResendCode } from '../shared/resend';
import { Journey } from '../shared/journey';
import { requiredMessage, focusInvalid } from '../shared/form-errors';
import { Passkeys } from '../passkeys/passkeys';
import { Passwords } from '../password/passwords';
import { GoogleButton } from '../google/google-button';
import { Google } from '../google/google';

import { Methods, type MethodsView } from './methods';
import { Session } from './session';
import type { FactorPending, Pending, SessionView } from './models';

type Reauthentication = (FactorPending & { method: 'password' }) | (Pending & { method: 'google'; factor: 'email' });

@Component({
  selector: 'app-reauthenticate',
  imports: [
    NavigationHeading,
    Button,
    Heading,
    Text,
    Link,
    Field,
    Input,
    FormField,
    RouterLink,
    AuthFeedback,
    CodeEntry,
    ResendCode,
    GoogleButton,
  ],
  providers: [Action, AuthHttp, Methods, Passkeys, Passwords, Google],
  templateUrl: './reauthenticate.html',
})
export class Reauthenticate {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly methodApi = inject(Methods);
  private readonly passkeys = inject(Passkeys);
  private readonly passwords = inject(Passwords);
  private readonly googleApi = inject(Google);
  private readonly journey = inject(Journey);
  readonly action = inject(Action);

  readonly embedded = input(false);
  readonly heading = input($localize`:@@authReauthTitle:Confirm it is you`);
  readonly description = input(
    $localize`:@@authReauthDescription:Use an existing sign-in method before changing your account's security. You will review the change again afterwards.`,
  );
  readonly completed = output<void>();
  readonly cancelled = output<void>();

  readonly methods = signal<MethodsView | null>(null);
  readonly pending = signal<Reauthentication | null>(null);
  readonly backup = signal(false);
  readonly visible = signal(false);
  readonly model = signal({ password: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.password, { message: requiredMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly showLabel = $localize`:@@authShowPassword:Show`;
  readonly hideLabel = $localize`:@@authHidePassword:Hide`;
  readonly passwordLabel = $localize`:@@authPassword:Password`;

  cancel(): void {
    this.journey.clear();
    this.cancelled.emit();
  }

  passkey(): void {
    void this.action.run(
      async () => {
        await this.passkeys.authenticate();

        await this.complete();
      },
      { name: 'passkey' },
    );
  }

  password(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
        this.action.run(
          async () => {
            try {
              const pending = await this.passwords.startReauth(this.model().password);

              this.pending.set({ ...pending, method: 'password' });
              this.backup.set(false);
              this.journey.start('password', pending);
            } finally {
              this.fields().reset({ password: '' });
              this.attempted.set(false);
            }
          },
          { name: 'password' },
        ),
      onInvalid: focusInvalid,
    });
  }

  verify(code: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    void this.action.run(
      async () => {
        if (pending.method === 'google') {
          await this.googleApi.verify(pending.flowId, code);
        } else {
          await this.passwords.completeReauth(pending.flowId, {
            kind: pending.factor === 'totp' && this.backup() ? 'recovery_code' : pending.factor,
            code,
          });
        }

        this.journey.clear();

        await this.complete();
      },
      { name: 'verify' },
    );
  }

  google(result: SessionView | (Pending & { factor: 'email' })): void {
    if ('access' in result) {
      void this.action.run(() => this.complete(), { name: 'provider' });
    } else {
      this.pending.set({ ...result, method: 'google' });
      this.backup.set(false);
      this.journey.start('google', result);
    }
  }

  private async complete(): Promise<void> {
    this.journey.clear();

    if (this.embedded()) {
      this.completed.emit();
    } else {
      await this.navigation.complete();
    }
  }

  private readonly initialize = afterNextRender(
    () =>
      void this.action.run(async () => {
        const methods = await this.methodApi.list();

        this.methods.set(methods);

        await this.session.loadProviders();
      }),
  );
}
