import { DatePipe } from '@angular/common';
import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';

import { Methods, type SessionEntry } from './methods';
import { Session } from './session';

@Component({
  selector: 'app-sessions',
  imports: [NavigationHeading, Button, Heading, Text, Link, Card, RouterLink, AuthFeedback, DatePipe],
  providers: [Action, AuthHttp, Methods],
  templateUrl: './sessions.html',
})
export class Sessions {
  private readonly api = inject(Methods);
  private readonly session = inject(Session);
  private readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

  readonly entries = signal<SessionEntry[]>([]);
  readonly confirm = signal<string | null>(null);

  readonly currentLabel = $localize`:@@authCurrentSession:Current session`;
  readonly otherLabel = $localize`:@@authOtherSession:Other session`;
  readonly unknownLabel = $localize`:@@authUnknownMethod:Not available`;

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

  async reload(): Promise<void> {
    const result = await this.api.sessions();

    this.entries.set(result.sessions);
  }

  revoke(id: string): void {
    void this.action.run(
      async () => {
        await this.api.revoke(id);

        this.confirm.set(null);

        await this.session.load(true);

        if (this.session.full()) {
          await this.reload();
        } else {
          await this.navigation.complete();
        }
      },
      { name: 'revoke:' + id },
    );
  }

  revokeOthers(): void {
    void this.action.run(
      async () => {
        await this.api.revokeOthers();

        this.confirm.set(null);

        await this.reload();
      },
      { name: 'revokeOthers' },
    );
  }

  private readonly initialize = afterNextRender(() => void this.action.run(() => this.reload()));
}
