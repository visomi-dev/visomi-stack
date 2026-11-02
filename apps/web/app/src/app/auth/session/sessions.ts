import { Component, LOCALE_ID, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Heading, Text, Link, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';

import { Methods, type SessionEntry } from './methods';
import { Session } from './session';

@Component({
  selector: 'app-sessions',
  imports: [Button, Heading, Text, Link, Card, RouterLink, AuthFeedback],
  providers: [AuthHttp, Methods],
  template: `<section class="max-w-2xl space-y-6">
    <h1 appUI i18n="@@authSessions">Sessions</h1>
    <p appUI tone="muted" i18n="@@authSessionsPrivacy">
      Review when sessions started and how they signed in. Device details and locations are not collected.
    </p>
    <button
      appUI
      variant="secondary"
      [disabled]="action.busy()"
      (click)="confirm.set('others')"
      i18n="@@authEndOtherSessions"
    >
      End other sessions
    </button>
    @if (confirm() === 'others') {
      <p role="status" i18n="@@authEndOtherConfirm">End every other session? They will need to sign in again.</p>
      <button appUI variant="danger" [disabled]="action.busy()" (click)="revokeOthers()" i18n="@@authConfirm">
        Confirm</button
      ><button appUI variant="secondary" (click)="confirm.set(null)" i18n="@@authCancel">Cancel</button>
    }
    <app-auth-feedback [action]="action" />
    @for (entry of entries(); track entry.id) {
      <section appUI="card">
        <h2 class="font-semibold">{{ entry.current ? currentLabel : otherLabel }}</h2>
        <dl class="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
          <dt i18n="@@authMethod">Method</dt>
          <dd>{{ methodLabel(entry.method) }}</dd>
          <dt i18n="@@authStarted">Started</dt>
          <dd>{{ date(entry.createdAt) }}</dd>
          <dt i18n="@@authExpires">Expires</dt>
          <dd>{{ date(entry.expiresAt) }}</dd>
        </dl>
        <button
          appUI
          variant="secondary"
          [disabled]="action.busy()"
          (click)="confirm.set(entry.id)"
          i18n="@@authEndSession"
        >
          End session
        </button>
        @if (confirm() === entry.id) {
          <p role="status" i18n="@@authEndSessionConfirm">
            End this session? If it is your current session, you will be signed out.
          </p>
          <button appUI variant="danger" [disabled]="action.busy()" (click)="revoke(entry.id)" i18n="@@authConfirm">
            Confirm</button
          ><button appUI variant="secondary" (click)="confirm.set(null)" i18n="@@authCancel">Cancel</button>
        }
      </section>
    }
    <a appUI routerLink="/security" i18n="@@authBackSecurity">Back to security</a>
  </section>`,
})
export class Sessions {
  private readonly api = inject(Methods);
  private readonly session = inject(Session);
  private readonly navigation = inject(AuthNavigation);
  private readonly locale = inject(LOCALE_ID);

  readonly entries = signal<SessionEntry[]>([]);
  readonly confirm = signal<string | null>(null);

  readonly action = new Action();
  readonly currentLabel = $localize`:@@authCurrentSession:Current session`;
  readonly otherLabel = $localize`:@@authOtherSession:Other session`;
  readonly unknownLabel = $localize`:@@authUnknownMethod:Not available`;

  constructor() {
    afterNextRender(() => void this.action.run(() => this.reload()));
  }

  methodLabel(value: string | undefined): string {
    switch (value) {
      case 'passkey':
        return $localize`:@@authMethodPasskey:Passkey`;
      case 'password':
        return $localize`:@@authPassword:Password`;
      case 'google':
        return 'Google';
      case 'recovery':
        return $localize`:@@authMethodRecovery:Recovery`;
      case 'device':
        return $localize`:@@authMethodDevice:Device approval`;
      default:
        return this.unknownLabel;
    }
  }

  date(value: string): string {
    return new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  async reload(): Promise<void> {
    const result = await this.api.sessions();

    this.entries.set(result.sessions);
  }

  revoke(id: string): void {
    void this.action.run(async () => {
      await this.api.revoke(id);

      this.confirm.set(null);

      await this.session.load(true);

      if (this.session.full()) {
        await this.reload();
      } else {
        await this.navigation.complete();
      }
    });
  }

  revokeOthers(): void {
    void this.action.run(async () => {
      await this.api.revokeOthers();

      this.confirm.set(null);

      await this.reload();
    });
  }
}
