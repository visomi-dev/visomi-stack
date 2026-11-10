import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
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
  imports: [NavigationHeading, Button, Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry, CodeEntry],
  providers: [Action, AuthHttp, Email],
  templateUrl: './account.html',
})
export class Account {
  readonly session = inject(Session);
  private readonly email = inject(Email);
  readonly action = inject(Action);

  readonly pending = signal<Pending | null>(null);

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
        this.action.setNotice($localize`:@@authCodeSent:A new code has been requested. Check your email.`);
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
      this.action.setNotice(
        result.notificationSent === false
          ? $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`
          : $localize`:@@authEmailChanged:Your email has been updated.`,
      );
    });
  }
}
