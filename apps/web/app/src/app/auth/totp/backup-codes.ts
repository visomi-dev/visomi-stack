import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';

import { BackupDisplay } from './backup-display';
import { Totp } from './totp';

@Component({
  selector: 'app-backup-codes',
  imports: [Button, Heading, Text, Link, RouterLink, AuthFeedback, BackupDisplay],
  providers: [AuthHttp, Totp],
  templateUrl: './backup-codes.html',
})
export class BackupCodes {
  private readonly api = inject(Totp);
  private readonly destroyRef = inject(DestroyRef);

  readonly codes = signal<string[]>([]);
  readonly confirm = signal(false);

  readonly action = new Action();

  constructor() {
    this.destroyRef.onDestroy(() => this.codes.set([]));
  }

  regenerate(): void {
    void this.action.run(async () => {
      const result = await this.api.regenerate();

      this.codes.set(result.recoveryCodes);
      this.confirm.set(false);
    });
  }
}
