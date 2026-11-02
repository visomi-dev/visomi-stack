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
  templateUrl: './sessions.html',
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
