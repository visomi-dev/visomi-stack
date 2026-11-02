import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { CodeEntry } from '../shared/code-entry';
import { Session } from '../session/session';
import { Methods } from '../session/methods';

import { QrCode } from './qr-code';
import { BackupDisplay } from './backup-display';
import { Totp, type TotpSetup } from './totp';

@Component({
  selector: 'app-manage-totp',
  imports: [Button, Heading, Text, Link, RouterLink, AuthFeedback, CodeEntry, QrCode, BackupDisplay],
  providers: [AuthHttp, Totp, Methods],
  template: `<section class="max-w-lg space-y-6">
    <h1 appUI i18n="@@authAuthenticator">Authenticator app</h1>
    <p appUI tone="muted" i18n="@@authTotpDescription">
      An authenticator adds a code to password sign-in. Keep your backup codes safe in case you lose access to the app.
    </p>
    @if (codes().length) {
      <app-backup-display [codes]="codes()" />
    } @else if (setup(); as pending) {
      <app-totp-qr [uri]="pending.uri" />
      <p class="text-sm" i18n="@@authManualKey">Or enter this manual key in your authenticator:</p>
      <code class="block rounded-xl bg-zinc-100 p-4 break-all dark:bg-zinc-800">{{ pending.secret }}</code
      ><app-code-entry [busy]="action.busy()" (confirmed)="confirmCode($event)" /><button
        appUI
        variant="secondary"
        (click)="setup.set(null)"
        i18n="@@authCancel"
      >
        Cancel
      </button>
    } @else if (enabled()) {
      <p appUI i18n="@@authTotpEnabled">Your authenticator is enabled.</p>
      <a appUI routerLink="/security/recovery-codes" i18n="@@authBackupCodes">Backup codes</a
      ><button appUI variant="danger" [disabled]="action.busy()" (click)="removing.set(true)" i18n="@@authDisableTotp">
        Disable authenticator
      </button>
      @if (removing()) {
        <p role="status" i18n="@@authDisableTotpConfirm">
          Disable your authenticator and invalidate its backup codes? Password sign-in will use email verification.
        </p>
        <button appUI variant="danger" [disabled]="action.busy()" (click)="remove()" i18n="@@authConfirm">
          Confirm</button
        ><button appUI variant="secondary" (click)="removing.set(false)" i18n="@@authCancel">Cancel</button>
      }
    } @else if (session.providers()?.totp) {
      <button appUI [disabled]="action.busy()" (click)="start()" i18n="@@authEnableTotp">Set up authenticator</button>
    } @else {
      <p role="status" i18n="@@authTotpUnavailable">Authenticator setup is not available right now.</p>
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/security" i18n="@@authBackSecurity"
      >Back to security</a
    >
  </section>`,
})
export class ManageTotp {
  readonly session = inject(Session);
  private readonly api = inject(Totp);
  private readonly methods = inject(Methods);
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = signal(false);
  readonly setup = signal<TotpSetup | null>(null);
  readonly codes = signal<string[]>([]);
  readonly removing = signal(false);

  readonly action = new Action();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.setup.set(null);
      this.codes.set([]);
    });
    afterNextRender(
      () =>
        void this.action.run(async () => {
          const methods = await this.methods.list();

          this.enabled.set(methods.totp);

          await this.session.loadProviders();
        }),
    );
  }

  start(): void {
    void this.action.run(async () => {
      const setup = await this.api.setup();

      this.setup.set(setup);
    });
  }

  confirmCode(code: string): void {
    const pending = this.setup();

    if (!pending) {
      return;
    }

    void this.action.run(async () => {
      const result = await this.api.confirm(pending.enrollmentId, code);

      this.setup.set(null);
      this.codes.set(result.recoveryCodes);
      this.enabled.set(true);

      if (result.notificationSent === false) {
        this.action.notice.set(
          $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
        );
      }
    });
  }

  remove(): void {
    void this.action.run(async () => {
      const result = await this.api.remove();

      this.enabled.set(false);
      this.removing.set(false);
      this.codes.set([]);

      if (result.notificationSent === false) {
        this.action.notice.set(
          $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
        );
      }
    });
  }
}
