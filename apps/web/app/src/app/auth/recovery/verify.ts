import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, pattern, disabled, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Link, Field, Input, Select } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { Journey } from '../shared/journey';
import { ResendCode } from '../shared/resend';
import { AuthNavigation } from '../shared/navigation';
import { codeMessage, requiredMessage, formFocus } from '../shared/form-errors';
import type { Factor } from '../session/models';

import { Recovery } from './recovery';

@Component({
  selector: 'app-recovery-verify',
  imports: [Button, Heading, Text, Link, Field, Input, Select, FormField, RouterLink, AuthFeedback, ResendCode],
  providers: [AuthHttp, Recovery],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authRecoveryVerifyTitle">Verify recovery</h1>
    @if (journey.challenge()?.purpose === 'recovery') {
      <p appUI tone="muted" i18n="@@authRecoveryProofHint">
        Enter your email code. If you enabled an authenticator, also include an authenticator or backup code.
      </p>
      <form novalidate class="space-y-5" [attr.data-submitted]="attempted() ? '' : null" (submit)="verify($event)">
        <app-field
          #emailField="appField"
          control-id="recovery-email-code"
          [label]="emailLabel"
          [error]="fields.code().errors()[0]?.message ?? ''"
          ><input
            appUI
            id="recovery-email-code"
            [formField]="fields.code"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder=" "
            [attr.aria-describedby]="emailField.describedBy()"
            [attr.aria-invalid]="fields.code().touched() && fields.code().invalid()"
        /></app-field>
        <app-field control-id="recovery-factor-kind" [label]="factorLabel"
          ><select appUI id="recovery-factor-kind" [formField]="fields.kind">
            <option value="none" i18n="@@authNoExtraFactor">No additional code</option>
            <option value="totp" i18n="@@authAuthenticator">Authenticator app</option>
            <option value="recovery_code" i18n="@@authBackupCode">Backup code</option>
          </select></app-field
        >
        @if (model().kind !== 'none') {
          <app-field
            #factorField="appField"
            control-id="recovery-factor"
            [label]="factorLabel"
            [error]="fields.factor().errors()[0]?.message ?? ''"
            ><input
              appUI
              id="recovery-factor"
              [formField]="fields.factor"
              [attr.inputmode]="model().kind === 'totp' ? 'numeric' : 'text'"
              placeholder=" "
              [attr.aria-describedby]="factorField.describedBy()"
              [attr.aria-invalid]="fields.factor().touched() && fields.factor().invalid()"
          /></app-field>
        }
        <button appUI type="submit" class="w-full" [disabled]="action.busy()" i18n="@@authVerify">Verify</button>
      </form>
      <app-resend-code />
    } @else {
      <p appUI tone="muted" i18n="@@authRestartChallenge">
        This step could not be restored. Start again to request a new verification.
      </p>
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/auth/recovery" i18n="@@authStartAgain">Start again</a>
  </section>`,
})
export class RecoveryVerify {
  readonly journey = inject(Journey);
  private readonly api = inject(Recovery);
  private readonly navigation = inject(AuthNavigation);

  readonly model = signal({ code: '', kind: 'none', factor: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { message: codeMessage });
    required(path.factor, { when: () => this.model().kind !== 'none', message: requiredMessage });
    pattern(path.factor, /^\d{6}$/, { when: () => this.model().kind === 'totp', message: codeMessage });
    disabled(path, { when: () => this.action.busy() });
  });

  readonly action = new Action();
  readonly emailLabel = $localize`:@@authEmailCode:Email verification code`;
  readonly factorLabel = $localize`:@@authAdditionalCode:Additional verification`;

  private readonly focusInvalid = formFocus();

  verify(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, async () =>
      this.action.run(async () => {
        const pending = this.journey.challenge();

        if (pending?.purpose !== 'recovery') {
          return;
        }

        const value = this.model();

        try {
          const result = await this.api.verify(
            pending.flowId,
            value.code,
            value.kind === 'none' ? undefined : { kind: value.kind as Factor['kind'], code: value.factor },
          );

          this.journey.clear();

          await this.navigation.complete(result);
        } finally {
          this.model.update((v) => ({ ...v, code: '', factor: '' }));
        }
      }),
    );

    if (this.fields().invalid()) {
      this.focusInvalid();
    }
  }
}
