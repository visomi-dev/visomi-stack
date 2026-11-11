import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Card, Alert } from '../../ui';
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
  imports: [
    NavigationHeading,
    Button,
    Heading,
    Text,
    Link,
    Card,
    RouterLink,
    AuthFeedback,
    GoogleButton,
    CodeEntry,
    Alert,
  ],
  providers: [Action, AuthHttp, Google, Methods],
  templateUrl: './manage.html',
})
export class ManageGoogle {
  readonly session = inject(Session);
  private readonly google = inject(Google);
  private readonly api = inject(Methods);
  private readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

  readonly methods = signal<MethodsView | null>(null);
  readonly pending = signal<Pending | null>(null);
  readonly confirm = signal<string | null>(null);

  async reload(): Promise<void> {
    const methods = await this.api.list();

    this.methods.set(methods);

    await this.session.loadProviders();
  }

  linked(result: SessionView | (Pending & { factor: 'email' })): void {
    if ('access' in result) {
      void this.action.run(() => this.reload(), { name: 'provider' });
    } else {
      this.pending.set(result);
    }
  }

  verify(code: string): void {
    const pending = this.pending();

    if (pending) {
      void this.action.run(
        async () => {
          await this.google.verify(pending.flowId, code);

          this.pending.set(null);

          await this.reload();
        },
        { name: 'verify' },
      );
    }
  }

  unlink(id: string): void {
    void this.action.run(
      async () => {
        const result = await this.google.unlink(id);

        await this.session.load(true);

        if (this.session.full()) {
          this.confirm.set(null);

          await this.reload();

          if (result?.notificationSent === false) {
            this.action.setNotice(
              $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`,
            );
          }
        } else {
          await this.navigation.complete(result ?? undefined);
        }
      },
      { name: 'unlink:' + id },
    );
  }

  private readonly initialize = afterNextRender(() => void this.action.run(() => this.reload()));
}
