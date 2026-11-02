import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { Journey } from '../shared/journey';
import { EmailEntry } from '../shared/email-entry';

import { Passwords } from './passwords';

@Component({
  selector: 'app-reset-request',
  imports: [Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry],
  providers: [AuthHttp, Passwords],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authResetRequestTitle">Reset your password</h1>
    <p appUI tone="muted" i18n="@@authRecoveryUniform">
      If this email can be used for recovery, we will send a code. Additional verification may be required.
    </p>
    <app-email-entry [busy]="action.busy()" (confirmed)="request($event)" /><app-auth-feedback [action]="action" /><a
      appUI
      routerLink="/auth/sign-in/password"
      i18n="@@authBackSignIn"
      >Back to sign in</a
    >
  </section>`,
})
export class ResetRequest {
  private readonly passwords = inject(Passwords);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);

  readonly action = new Action();

  request(email: string): void {
    void this.action.run(async () => {
      const pending = await this.passwords.reset(email);

      this.journey.start('reset', pending);

      await this.router.navigate(['/auth/reset-password']);
    });
  }
}
