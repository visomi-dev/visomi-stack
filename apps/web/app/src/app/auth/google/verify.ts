import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { CodeEntry } from '../shared/code-entry';
import { ResendCode } from '../shared/resend';

import { Google } from './google';

@Component({
  selector: 'app-google-verify',
  imports: [Heading, Text, Link, RouterLink, AuthFeedback, CodeEntry, ResendCode],
  providers: [AuthHttp, Google],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authGoogleVerifyTitle">One more step</h1>
    @if (journey.challenge()?.purpose === 'google') {
      <p appUI tone="muted" i18n="@@authGoogleVerifyDescription">Verify your email to finish continuing with Google.</p>
      <app-code-entry [busy]="action.busy()" (confirmed)="verify($event)" /><app-resend-code />
    } @else {
      <p appUI tone="muted" i18n="@@authRestartChallenge">
        This step could not be restored. Start again to request a new verification.
      </p>
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/auth/sign-in" i18n="@@authBackSignIn"
      >Back to sign in</a
    >
  </section>`,
})
export class GoogleVerify {
  readonly journey = inject(Journey);
  private readonly google = inject(Google);
  private readonly navigation = inject(AuthNavigation);

  readonly action = new Action();

  verify(code: string): void {
    const pending = this.journey.challenge();

    if (pending?.purpose !== 'google') {
      return;
    }

    void this.action.run(async () => {
      await this.google.verify(pending.flowId, code);

      this.journey.clear();

      await this.navigation.complete();
    });
  }
}
