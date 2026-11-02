import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Heading, Text, Link, Button } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Journey } from '../shared/journey';
import { AuthNavigation } from '../shared/navigation';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { CodeEntry } from '../shared/code-entry';
import { ResendCode } from '../shared/resend';

import { Passwords } from './passwords';

@Component({
  selector: 'app-password-verify',
  imports: [Heading, Text, Link, Button, RouterLink, AuthFeedback, CodeEntry, ResendCode],
  providers: [AuthHttp, Passwords],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authConfirmSignIn">Confirm your sign-in</h1>
    @if (pending && pending.purpose === 'password') {
      <p appUI tone="muted">{{ pending.factor === 'email' ? emailHint : totpHint }}</p>
      <app-code-entry [busy]="action.busy()" [backup]="backup()" (confirmed)="verify($event)" />
      @if (pending.factor === 'email') {
        <app-resend-code />
      } @else {
        <button appUI variant="secondary" class="w-full" (click)="backup.set(!backup())">
          {{ backup() ? useAuthenticator : useBackup }}
        </button>
      }
    } @else {
      <p appUI tone="muted" i18n="@@authRestartChallenge">
        This step could not be restored. Start again to request a new verification.
      </p>
    }
    <app-auth-feedback [action]="action" /><a
      appUI
      routerLink="/auth/sign-in/password"
      [queryParams]="navigation.returnQuery()"
      class="block text-center text-sm"
      i18n="@@authStartAgain"
      >Start again</a
    >
  </section>`,
})
export class PasswordVerify {
  private readonly journey = inject(Journey);
  private readonly passwords = inject(Passwords);
  readonly navigation = inject(AuthNavigation);

  readonly backup = signal(false);

  readonly pending = this.journey.challenge();
  readonly action = new Action();
  readonly emailHint = $localize`:@@authEmailFactorHint:Enter the code sent to your email.`;
  readonly totpHint = $localize`:@@authTotpFactorHint:Enter a code from your authenticator app, or use a backup code.`;
  readonly useAuthenticator = $localize`:@@authUseAuthenticator:Use authenticator app`;
  readonly useBackup = $localize`:@@authUseBackup:Use a backup code`;

  verify(code: string): void {
    const pending = this.journey.challenge();

    if (pending?.purpose !== 'password') {
      return;
    }

    void this.action.run(async () => {
      await this.passwords.verify(pending.flowId, {
        kind: this.backup() ? 'recovery_code' : (pending.factor ?? 'email'),
        code,
      });

      this.journey.clear();

      await this.navigation.complete();
    });
  }
}
