import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Button, Heading, Text, Link, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Methods, type MethodsView } from '../session/methods';
import { Session } from '../session/session';
import type { Pending, SessionView } from '../session/models';
import { CodeEntry } from '../shared/code-entry';

import { GoogleButton } from './google-button';
import { Google } from './google';

@Component({
  selector: 'app-manage-google',
  imports: [Button, Heading, Text, Link, Card, RouterLink, AuthFeedback, GoogleButton, CodeEntry],
  providers: [AuthHttp, Google, Methods],
  templateUrl: './manage.html',
})
export class ManageGoogle {
  readonly session = inject(Session);
  private readonly google = inject(Google);
  private readonly api = inject(Methods);
  private readonly navigation = inject(AuthNavigation);

  readonly methods = signal<MethodsView | null>(null);
  readonly pending = signal<Pending | null>(null);
  readonly confirm = signal<string | null>(null);

  readonly action = new Action();

  constructor() {
    afterNextRender(() => void this.action.run(() => this.reload()));
  }

  async reload(): Promise<void> {
    const methods = await this.api.list();

    this.methods.set(methods);

    await this.session.loadProviders();
  }

  linked(result: SessionView | (Pending & { factor: 'email' })): void {
    if ('access' in result) {
      void this.action.run(() => this.reload());
    } else {
      this.pending.set(result);
    }
  }

  verify(code: string): void {
    const pending = this.pending();

    if (pending) {
      void this.action.run(async () => {
        await this.google.verify(pending.flowId, code);

        this.pending.set(null);

        await this.reload();
      });
    }
  }

  unlink(id: string): void {
    void this.action.run(async () => {
      const result = await this.google.unlink(id);

      await this.session.load(true);

      if (this.session.full()) {
        this.confirm.set(null);

        await this.reload();

        if (result?.notificationSent === false) {
          this.action.notice.set(
            $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
          );
        }
      } else {
        await this.navigation.complete(result ?? undefined);
      }
    });
  }
}
