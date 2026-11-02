import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Button, Heading, Text } from '../../ui';
import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';
import { AuthFeedback } from '../shared/feedback';
import { Action } from '../shared/action';
import { Journey } from '../shared/journey';
import { AuthNavigation } from '../shared/navigation';
import { CodeEntry } from '../shared/code-entry';
import { EmailEntry } from '../shared/email-entry';
import { ResendCode } from '../shared/resend';

import { Email } from './email';

@Component({
  selector: 'app-email-verify',
  imports: [Button, Heading, Text, AuthFeedback, CodeEntry, EmailEntry, ResendCode],
  providers: [AuthHttp, Email],
  template: `<section class="space-y-6">
    <h1 appUI i18n="@@authVerifyEmailTitle">Verify your email</h1>
    <p appUI tone="muted" i18n="@@authVerifyEmailDescription">
      Your account is created. Verify your email to finish signing in.
    </p>
    @if (session.snapshot().nextStep === 'add_email') {
      <app-email-entry [busy]="action.busy()" (confirmed)="request($event)" />
    } @else {
      <p class="text-sm font-medium break-all">{{ session.user()?.email }}</p>
      @if (journey.challenge()?.purpose === 'email') {
        <app-code-entry [busy]="action.busy()" (confirmed)="verify($event)" /><app-resend-code />
      } @else {
        <p appUI tone="muted" i18n="@@authEmailRestart">Request a new code to continue verifying this email.</p>
        <button appUI class="w-full" [disabled]="action.busy()" (click)="request()" i18n="@@authRequestCode">
          Request a code
        </button>
      }
    }
    <app-auth-feedback [action]="action" /><button
      appUI
      variant="secondary"
      class="w-full"
      [disabled]="action.busy()"
      (click)="logout()"
      i18n="@@authSignOut"
    >
      Sign out
    </button>
  </section>`,
})
export class EmailVerify {
  readonly session = inject(Session);
  readonly journey = inject(Journey);
  private readonly email = inject(Email);
  private readonly http = inject(AuthHttp);
  private readonly navigation = inject(AuthNavigation);
  private readonly router = inject(Router);

  readonly action = new Action();

  request(address?: string): void {
    void this.action.run(async () => {
      const pending = await this.email.request(address);

      this.journey.start('email', pending);

      await this.session.load(true);
    });
  }

  verify(code: string): void {
    const pending = this.journey.challenge();

    if (pending?.purpose !== 'email') {
      return;
    }

    void this.action.run(async () => {
      await this.email.verify(pending.flowId, code);

      this.journey.clear();

      await this.navigation.complete();
    });
  }

  logout(): void {
    void this.action.run(async () => {
      this.session.cancelOperations();

      await this.http.request('POST', '/logout', {});

      this.session.clear();
      this.journey.clear();

      await this.router.navigate(['/auth/sign-in']);
    });
  }
}
