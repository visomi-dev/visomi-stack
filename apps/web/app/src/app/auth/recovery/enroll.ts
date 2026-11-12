import { Component, DestroyRef, inject, signal } from '@angular/core';
import { form, FormField, required, disabled, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Field, Input, Disclosure } from '../../ui';
import { Session } from '../session/session';
import { Logout } from '../session/logout';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { CodeEntry } from '../shared/code-entry';
import { Passkeys } from '../passkeys/passkeys';
import { passwordPolicy } from '../password/validation';
import { requiredMessage, focusInvalid } from '../shared/form-errors';
import type { FactorPending } from '../session/models';

import { Recovery } from './recovery';

@Component({
  selector: 'app-recovery-enroll',
  imports: [NavigationHeading, Button, Heading, Text, Field, Input, FormField, AuthFeedback, CodeEntry, Disclosure],
  providers: [Action, AuthHttp, Passkeys, Recovery, Logout],
  templateUrl: './enroll.html',
})
export class Enroll {
  private readonly api = inject(Recovery);
  private readonly keys = inject(Passkeys);
  private readonly navigation = inject(AuthNavigation);
  private readonly session = inject(Session);
  private readonly signOut = inject(Logout);
  private readonly destroyRef = inject(DestroyRef);
  readonly action = inject(Action);

  readonly model = signal({ password: '' });
  readonly pending = signal<FactorPending | null>(null);
  readonly backup = signal(false);
  readonly registered = signal(this.session.snapshot().method === 'passkey');
  readonly visible = signal(false);
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.password, { message: requiredMessage });
    passwordPolicy(path.password);
    disabled(path, { when: () => this.action.busy() });
  });

  readonly showLabel = $localize`:@@authShowPassword:Show`;
  readonly hideLabel = $localize`:@@authHidePassword:Hide`;
  readonly passwordLabel = $localize`:@@authNewPassword:New password`;
  readonly policy = $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`;

  private replacement = '';

  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.replacement = '';
    this.model.set({ password: '' });
  });

  passkey(): void {
    void this.action.run(
      async () => {
        await this.keys.register();

        this.registered.set(true);
      },
      { name: 'passkey' },
    );
  }

  provePasskey(): void {
    void this.action.run(
      async () => {
        await this.keys.authenticate();

        await this.navigation.complete();
      },
      { name: 'provePasskey' },
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
              this.replacement = this.model().password;

              const pending = await this.api.password(this.replacement);

              this.pending.set(pending);
            } catch (error) {
              this.replacement = '';

              throw error;
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

  completePassword(code: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    void this.action.run(
      async () => {
        const result = await this.api.completePassword(pending.flowId, this.replacement, {
          kind: this.backup() ? 'recovery_code' : pending.factor,
          code,
        });

        this.replacement = '';
        this.pending.set(null);

        await this.navigation.complete(result);
      },
      { name: 'completePassword' },
    );
  }

  restart(): void {
    this.pending.set(null);
    this.replacement = '';
    this.fields().reset({ password: '' });
    this.attempted.set(false);
    this.backup.set(false);
    this.visible.set(false);
    this.action.setError('');
    this.action.setNotice('');
  }

  logout(): void {
    void this.signOut.run();
  }
}
