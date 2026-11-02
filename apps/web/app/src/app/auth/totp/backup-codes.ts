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
  template: `<section class="max-w-lg space-y-6">
    <h1 appUI i18n="@@authBackupCodes">Backup codes</h1>
    @if (codes().length) {
      <app-backup-display [codes]="codes()" />
    } @else {
      <p appUI tone="muted" i18n="@@authBackupCannotRestore">
        Existing backup codes cannot be displayed again. You can create a replacement set after confirming your
        identity.
      </p>
      <button appUI [disabled]="action.busy()" (click)="confirm.set(true)" i18n="@@authReplaceCodes">
        Replace backup codes
      </button>
      @if (confirm()) {
        <p role="status" i18n="@@authReplaceCodesConfirm">
          Replace all existing codes? The old set will stop working immediately.
        </p>
        <button appUI variant="danger" [disabled]="action.busy()" (click)="regenerate()" i18n="@@authConfirm">
          Confirm</button
        ><button appUI variant="secondary" (click)="confirm.set(false)" i18n="@@authCancel">Cancel</button>
      }
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/security" i18n="@@authBackSecurity"
      >Back to security</a
    >
  </section>`,
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
