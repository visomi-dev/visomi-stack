import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Card, Code } from '../../ui';
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
  imports: [
    NavigationHeading,
    Button,
    Heading,
    Text,
    Link,
    RouterLink,
    AuthFeedback,
    CodeEntry,
    QrCode,
    BackupDisplay,
    Card,
    Code,
  ],
  providers: [Action, AuthHttp, Totp, Methods],
  templateUrl: './manage.html',
})
export class ManageTotp {
  readonly session = inject(Session);
  private readonly api = inject(Totp);
  private readonly methods = inject(Methods);
  private readonly destroyRef = inject(DestroyRef);
  readonly action = inject(Action);

  readonly enabled = signal(false);
  readonly setup = signal<TotpSetup | null>(null);
  readonly codes = signal<string[]>([]);
  readonly removing = signal(false);

  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.setup.set(null);
    this.codes.set([]);
  });

  start(): void {
    void this.action.run(
      async () => {
        const setup = await this.api.setup();

        this.setup.set(setup);
      },
      { name: 'start' },
    );
  }

  confirmCode(code: string): void {
    const pending = this.setup();

    if (!pending) {
      return;
    }

    void this.action.run(
      async () => {
        const result = await this.api.confirm(pending.enrollmentId, code);

        this.setup.set(null);
        this.codes.set(result.recoveryCodes);
        this.enabled.set(true);

        if (result.notificationSent === false) {
          this.action.setNotice(
            $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
          );
        }
      },
      { name: 'confirmCode' },
    );
  }

  remove(): void {
    void this.action.run(
      async () => {
        const result = await this.api.remove();

        this.enabled.set(false);
        this.removing.set(false);
        this.codes.set([]);

        if (result.notificationSent === false) {
          this.action.setNotice(
            $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
          );
        }
      },
      { name: 'remove' },
    );
  }

  private readonly initialize = afterNextRender(
    () =>
      void this.action.run(async () => {
        const methods = await this.methods.list();

        this.enabled.set(methods.totp);

        await this.session.loadProviders();
      }),
  );
}
