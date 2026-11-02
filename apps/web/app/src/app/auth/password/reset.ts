import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, pattern, disabled, submit } from '@angular/forms/signals';

import { Button, Heading, Text, Link, Field, Input, Select } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { Journey } from '../shared/journey';
import { ResendCode } from '../shared/resend';
import { codeMessage, requiredMessage, focusInvalid } from '../shared/form-errors';
import type { Factor } from '../session/models';

import { passwordPolicy } from './validation';
import { Passwords } from './passwords';

@Component({
  selector: 'app-password-reset',
  imports: [Button, Heading, Text, Link, Field, Input, Select, FormField, RouterLink, AuthFeedback, ResendCode],
  providers: [AuthHttp, Passwords],
  templateUrl: './reset.html',
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

  save(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
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
      onInvalid: focusInvalid,
    });
  }
}
