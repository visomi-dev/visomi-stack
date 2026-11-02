import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { EmailEntry } from '../shared/email-entry';
import { Journey } from '../shared/journey';

import { Recovery } from './recovery';

@Component({
  selector: 'app-recovery-request',
  imports: [Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry],
  providers: [AuthHttp, Recovery],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authRecoverTitle">Recover your account</h1>
    <p appUI tone="muted" i18n="@@authRecoveryUniform">
      If this email can be used for recovery, we will send a code. Additional verification may be required.
    </p>
    <app-email-entry [busy]="action.busy()" (confirmed)="request($event)" /><app-auth-feedback [action]="action" />
    <div class="space-y-3 border-t border-zinc-200 pt-5 text-sm dark:border-zinc-800">
      <a appUI routerLink="/auth/device-approval" class="block" i18n="@@authUseOpenDevice"
        >Use a device where you are signed in</a
      ><a appUI routerLink="/auth/forgot-password" class="block" i18n="@@authOnlyResetPassword"
        >Only need to reset your password?</a
      ><a appUI variant="muted" routerLink="/auth/sign-in" class="block" i18n="@@authBackSignIn">Back to sign in</a>
    </div>
  </section>`,
})
export class RecoveryRequest {
  private readonly api = inject(Recovery);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);

  readonly action = new Action();

  request(email: string): void {
    void this.action.run(async () => {
      const pending = await this.api.request(email);

      this.journey.start('recovery', pending);

      await this.router.navigate(['/auth/recovery/verify']);
    });
  }
}
