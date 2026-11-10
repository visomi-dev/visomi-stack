import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';

import { BackupDisplay } from './backup-display';
import { Totp } from './totp';

@Component({
  selector: 'app-backup-codes',
  imports: [NavigationHeading, Button, Heading, Text, Link, RouterLink, AuthFeedback, BackupDisplay, Card],
  providers: [Action, AuthHttp, Totp],
  templateUrl: './backup-codes.html',
})
export class BackupCodes {
  private readonly api = inject(Totp);
  private readonly destroyRef = inject(DestroyRef);
  readonly action = inject(Action);

  readonly codes = signal<string[]>([]);
  readonly confirm = signal(false);

  private readonly cleanup = this.destroyRef.onDestroy(() => this.codes.set([]));

  regenerate(): void {
    void this.action.run(async () => {
      const result = await this.api.regenerate();

      this.codes.set(result.recoveryCodes);
      this.confirm.set(false);
    });
  }
}
