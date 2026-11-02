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
  templateUrl: './verify.html',
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
