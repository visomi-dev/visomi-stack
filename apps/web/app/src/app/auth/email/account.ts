import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Heading, Text, Link } from '../../ui';
import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { EmailEntry } from '../shared/email-entry';
import { CodeEntry } from '../shared/code-entry';
import type { Pending } from '../session/models';

import { Email } from './email';

@Component({
  selector: 'app-account',
  imports: [Button, Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry, CodeEntry],
  providers: [AuthHttp, Email],
  template: `<section class="max-w-lg space-y-6">
    <header class="space-y-3">
      <h1 appUI i18n="@@authAccount">Account</h1>
      <p appUI tone="muted" i18n="@@authAccountEmailDescription">
        Your verified email helps you recover access. Changing it requires a recent identity check.
      </p>
    </header>
    <p class="font-medium break-all">{{ session.user()?.email }}</p>
    @if (pending()) {
      <p appUI tone="muted" i18n="@@authNewEmailCode">Enter the code sent to your new email address.</p>
      <app-code-entry [busy]="action.busy()" (confirmed)="verify($event)" /><button
        appUI
        variant="secondary"
        [disabled]="action.busy()"
        (click)="resend()"
        i18n="@@authResend"
      >
        Send a new code</button
      ><button appUI variant="secondary" (click)="pending.set(null)" i18n="@@authCancel">Cancel</button>
    } @else {
      <app-email-entry [label]="changeLabel" [busy]="action.busy()" (confirmed)="change($event)" />
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/security" i18n="@@authBackSecurity"
      >Back to security</a
    >
  </section>`,
})
export class Account {
  readonly session = inject(Session);
  private readonly email = inject(Email);

  readonly pending = signal<Pending | null>(null);

  readonly action = new Action();
  readonly changeLabel = $localize`:@@authChangeEmail:Change email`;

  change(email: string): void {
    void this.action.run(async () => {
      const pending = await this.email.change(email);

      this.pending.set(pending);
    });
  }

  resend(): void {
    const pending = this.pending();

    if (pending) {
      void this.action.run(async () => {
        const next = await this.email.resend(pending.flowId);

        this.pending.set(next);
        this.action.notice.set($localize`:@@authCodeSent:A new code has been requested. Check your email.`);
      });
    }
  }

  verify(code: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    void this.action.run(async () => {
      const result = await this.email.completeChange(pending.flowId, code);

      this.pending.set(null);
      this.action.notice.set(
        result.notificationSent === false
          ? $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`
          : $localize`:@@authEmailChanged:Your email has been updated.`,
      );
    });
  }
}
