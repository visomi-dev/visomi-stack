import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, pattern, disabled, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Link, Field, Input, Select } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { Journey } from '../shared/journey';
import { ResendCode } from '../shared/resend';
import { codeMessage, requiredMessage, formFocus } from '../shared/form-errors';
import type { Factor } from '../session/models';

import { passwordPolicy } from './validation';
import { Passwords } from './passwords';

@Component({
  selector: 'app-password-reset',
  imports: [Button, Heading, Text, Link, Field, Input, Select, FormField, RouterLink, AuthFeedback, ResendCode],
  providers: [AuthHttp, Passwords],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authResetTitle">Choose a new password</h1>
    @if (done()) {
      <p appUI i18n="@@authResetDone">Your password has been reset. Sign in with your new password to continue.</p>
      <a appUI routerLink="/auth/sign-in/password" i18n="@@authSignIn">Sign in</a>
    } @else if (journey.challenge()?.purpose === 'reset') {
      <form novalidate class="space-y-5" [attr.data-submitted]="attempted() ? '' : null" (submit)="save($event)">
        <app-field
          #codeField="appField"
          control-id="reset-code"
          [label]="codeLabel"
          [error]="fields.code().errors()[0]?.message ?? ''"
          ><input
            appUI
            id="reset-code"
            [formField]="fields.code"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder=" "
            [attr.aria-describedby]="codeField.describedBy()"
            [attr.aria-invalid]="fields.code().touched() && fields.code().invalid()"
        /></app-field>
        <app-field
          #passwordField="appField"
          control-id="reset-password"
          [label]="passwordLabel"
          [description]="policy"
          [error]="fields.password().errors()[0]?.message ?? ''"
          ><input
            appUI
            id="reset-password"
            [formField]="fields.password"
            [type]="visible() ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder=" "
            [attr.aria-describedby]="passwordField.describedBy()"
            [attr.aria-invalid]="fields.password().touched() && fields.password().invalid()"
          /><button
            type="button"
            class="mt-2 text-sm ui-focus-ring"
            [attr.aria-pressed]="visible()"
            (click)="visible.set(!visible())"
            i18n="@@authTogglePassword"
          >
            Show or hide password
          </button></app-field
        >
        <app-field control-id="reset-factor-kind" [label]="factorLabel"
          ><select appUI id="reset-factor-kind" [formField]="fields.kind">
            <option value="none" i18n="@@authNoExtraFactor">No additional code</option>
            <option value="totp" i18n="@@authAuthenticator">Authenticator app</option>
            <option value="recovery_code" i18n="@@authBackupCode">Backup code</option>
          </select></app-field
        >
        <p appUI tone="muted" class="text-sm" i18n="@@authExtraFactorHint">
          If you enabled an authenticator, include its code or a backup code. Email alone cannot replace it.
        </p>
        @if (model().kind !== 'none') {
          <app-field
            #factorField="appField"
            control-id="reset-factor"
            [label]="factorLabel"
            [error]="fields.factor().errors()[0]?.message ?? ''"
            ><input
              appUI
              id="reset-factor"
              [formField]="fields.factor"
              placeholder=" "
              [attr.inputmode]="model().kind === 'totp' ? 'numeric' : 'text'"
              [attr.aria-describedby]="factorField.describedBy()"
              [attr.aria-invalid]="fields.factor().touched() && fields.factor().invalid()"
          /></app-field>
        }
        <button appUI type="submit" class="w-full" [disabled]="action.busy()" i18n="@@authResetPassword">
          Reset password
        </button>
      </form>
      <app-resend-code />
    } @else {
      <p appUI tone="muted" i18n="@@authRestartChallenge">
        This step could not be restored. Start again to request a new verification.
      </p>
    }
    <app-auth-feedback [action]="action" /><a
      appUI
      routerLink="/auth/forgot-password"
      class="block text-center text-sm"
      i18n="@@authStartAgain"
      >Start again</a
    >
  </section>`,
})
export class PasswordReset {
  readonly journey = inject(Journey);
  private readonly passwords = inject(Passwords);

  readonly model = signal({ code: '', password: '', kind: 'none', factor: '' });
  readonly attempted = signal(false);
  readonly done = signal(false);
  readonly visible = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { message: codeMessage });
    required(path.password, { message: requiredMessage });
    passwordPolicy(path.password);
    required(path.factor, { when: () => this.model().kind !== 'none', message: requiredMessage });
    pattern(path.factor, /^\d{6}$/, { when: () => this.model().kind === 'totp', message: codeMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly action = new Action();
  readonly codeLabel = $localize`:@@authEmailCode:Email verification code`;
  readonly passwordLabel = $localize`:@@authNewPassword:New password`;
  readonly factorLabel = $localize`:@@authAdditionalCode:Additional verification`;
  readonly policy = $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`;

  private readonly focusInvalid = formFocus();

  save(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, async () =>
      this.action.run(async () => {
        const pending = this.journey.challenge();

        if (pending?.purpose !== 'reset') {
          return;
        }

        const value = this.model();
        const factor = value.kind === 'none' ? undefined : { kind: value.kind as Factor['kind'], code: value.factor };

        try {
          const result = await this.passwords.completeReset(pending.flowId, value.code, value.password, factor);

          this.journey.clear();
          this.done.set(true);

          if (!result.notificationSent) {
            this.action.notice.set(
              $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
            );
          }
        } finally {
          this.model.update((v) => ({ ...v, password: '', code: '', factor: '' }));
        }
      }),
    );

    if (this.fields().invalid()) {
      this.focusInvalid();
    }
  }
}
