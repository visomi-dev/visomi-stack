import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { form, FormField, required, disabled, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Field, Input } from '../../ui';
import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { CodeEntry } from '../shared/code-entry';
import { Journey } from '../shared/journey';
import { ResendCode } from '../shared/resend';
import { Passkeys } from '../passkeys/passkeys';
import { passwordPolicy } from '../password/validation';
import { requiredMessage } from '../shared/form-errors';
import type { FactorPending } from '../session/models';

import { Recovery } from './recovery';

@Component({
  selector: 'app-recovery-enroll',
  imports: [Button, Heading, Text, Field, Input, FormField, AuthFeedback, CodeEntry, ResendCode],
  providers: [AuthHttp, Passkeys, Recovery],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authEnrollTitle">Set up access again</h1>
    <p appUI tone="muted" i18n="@@authEnrollDescription">
      Your recovery proof allows you to set up a replacement sign-in method. Complete its verification before entering
      your account.
    </p>
    @if (pending()) {
      <p appUI tone="muted" i18n="@@authReplacementPasswordHint">
        Confirm the replacement password with the required second factor. You can use a backup code instead of an
        authenticator code.
      </p>
      <app-code-entry [busy]="action.busy()" [backup]="backup()" (confirmed)="completePassword($event)" />
      @if (pending()?.factor === 'email') {
        <app-resend-code />
      }
      <button appUI variant="secondary" [disabled]="action.busy()" (click)="restart()" i18n="@@authStartAgain">
        Start again
      </button>
      @if (pending()?.factor === 'totp') {
        <button appUI variant="secondary" (click)="backup.set(!backup())" i18n="@@authSwitchFactor">
          Switch between authenticator and backup code
        </button>
      }
    } @else if (registered()) {
      <p appUI tone="muted" i18n="@@authReplacementPasskeyHint">
        Your replacement passkey is created. Sign in with that passkey to finish recovery.
      </p>
      <button appUI class="w-full" [disabled]="action.busy()" (click)="provePasskey()" i18n="@@authVerifyPasskey">
        Verify replacement passkey
      </button>
    } @else {
      <button appUI class="w-full" [disabled]="action.busy()" (click)="passkey()" i18n="@@authCreateReplacementPasskey">
        Create a replacement passkey
      </button>
      <details class="space-y-4">
        <summary class="cursor-pointer text-sm ui-focus-ring" i18n="@@authUsePassword">Use a password</summary>
        <form novalidate class="space-y-4" (submit)="password($event)">
          <app-field
            #field="appField"
            control-id="replacement-password"
            [label]="passwordLabel"
            [description]="policy"
            [error]="fields.password().errors()[0]?.message ?? ''"
            ><input
              appUI
              id="replacement-password"
              [type]="visible() ? 'text' : 'password'"
              autocomplete="new-password"
              [formField]="fields.password"
              [attr.aria-describedby]="field.describedBy()"
            /><button
              type="button"
              class="mt-2 text-sm ui-focus-ring"
              (click)="visible.set(!visible())"
              [attr.aria-pressed]="visible()"
              i18n="@@authTogglePassword"
            >
              Show or hide password
            </button></app-field
          ><button appUI type="submit" [disabled]="action.busy()" i18n="@@authSavePassword">Save password</button>
        </form>
      </details>
    }
    <app-auth-feedback [action]="action" /><button
      appUI
      variant="secondary"
      [disabled]="action.busy()"
      (click)="logout()"
      i18n="@@authSignOut"
    >
      Sign out
    </button>
  </section>`,
})
export class Enroll {
  private readonly api = inject(Recovery);
  private readonly journey = inject(Journey);
  private readonly keys = inject(Passkeys);
  private readonly navigation = inject(AuthNavigation);
  private readonly http = inject(AuthHttp);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly model = signal({ password: '' });
  readonly pending = signal<FactorPending | null>(null);
  readonly backup = signal(false);
  readonly registered = signal(this.session.snapshot().method === 'passkey');
  readonly visible = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.password, { message: requiredMessage });
    passwordPolicy(path.password);
    disabled(path, { when: () => this.action.busy() });
  });

  readonly action = new Action();
  readonly passwordLabel = $localize`:@@authNewPassword:New password`;
  readonly policy = $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`;

  private replacement = '';

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.replacement = '';
      this.model.set({ password: '' });
    });
  }

  passkey(): void {
    void this.action.run(async () => {
      await this.keys.register();

      this.registered.set(true);
    });
  }

  provePasskey(): void {
    void this.action.run(async () => {
      await this.keys.authenticate();

      await this.navigation.complete();
    });
  }

  password(event: Event): void {
    event.preventDefault();
    void submit(this.fields, async () =>
      this.action.run(async () => {
        try {
          this.replacement = this.model().password;
          const pending = await this.api.password(this.replacement);

          this.pending.set(pending);
          this.journey.start('replacement', pending);
        } catch (error) {
          this.replacement = '';

          throw error;
        } finally {
          this.model.set({ password: '' });
        }
      }),
    );
  }

  completePassword(code: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    void this.action.run(async () => {
      const result = await this.api.completePassword(pending.flowId, this.replacement, {
        kind: this.backup() ? 'recovery_code' : pending.factor,
        code,
      });

      this.replacement = '';
      this.pending.set(null);
      this.journey.clear();

      await this.navigation.complete(result);
    });
  }

  restart(): void {
    this.pending.set(null);
    this.journey.clear();
    this.replacement = '';
    this.model.set({ password: '' });
  }

  logout(): void {
    void this.action.run(async () => {
      this.session.cancelOperations();

      await this.http.request('POST', '/logout', {});

      this.session.clear();

      await this.router.navigate(['/auth/sign-in']);
    });
  }
}
