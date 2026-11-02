import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, disabled, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Link, Field, Input } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { CodeEntry } from '../shared/code-entry';
import { ResendCode } from '../shared/resend';
import { Journey } from '../shared/journey';
import { requiredMessage } from '../shared/form-errors';
import { Passkeys } from '../passkeys/passkeys';
import { Passwords } from '../password/passwords';
import { GoogleButton } from '../google/google-button';

import { Methods, type MethodsView } from './methods';
import { Session } from './session';
import type { Pending, SessionView } from './models';

@Component({
  selector: 'app-reauthenticate',
  imports: [
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
  providers: [AuthHttp, Methods, Passkeys, Passwords],
  templateUrl: './reauthenticate.html',
})
export class Reauthenticate {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly methodApi = inject(Methods);
  private readonly passkeys = inject(Passkeys);
  private readonly passwords = inject(Passwords);
  private readonly journey = inject(Journey);

  readonly methods = signal<MethodsView | null>(null);
  readonly pending = signal<(Pending & { factor: 'email' | 'totp' }) | null>(null);
  readonly backup = signal(false);
  readonly model = signal({ password: '' });

  readonly fields = form(this.model, (path) => {
    required(path.password, { message: requiredMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly action = new Action();
  readonly passwordLabel = $localize`:@@authPassword:Password`;

  constructor() {
    afterNextRender(
      () =>
        void this.action.run(async () => {
          const methods = await this.methodApi.list();

          this.methods.set(methods);

          await this.session.loadProviders();
        }),
    );
  }

  passkey(): void {
    void this.action.run(async () => {
      await this.passkeys.authenticate();

      await this.navigation.complete();
    });
  }

  password(event: Event): void {
    event.preventDefault();
    void submit(this.fields, async () =>
      this.action.run(async () => {
        try {
          const pending = await this.passwords.startReauth(this.model().password);

          this.pending.set(pending);
          this.journey.start('password', pending);
        } finally {
          this.model.set({ password: '' });
        }
      }),
    );
  }

  verify(code: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    void this.action.run(async () => {
      await this.passwords.completeReauth(pending.flowId, {
        kind: this.backup() ? 'recovery_code' : pending.factor,
        code,
      });

      this.journey.clear();

      await this.navigation.complete();
    });
  }

  google(result: SessionView | (Pending & { factor: 'email' })): void {
    if ('access' in result) {
      void this.navigation.complete();
    } else {
      this.action.error.set(
        $localize`:@@authGoogleReauthFailed:Use an already linked Google account, or choose another sign-in method.`,
      );
    }
  }
}
