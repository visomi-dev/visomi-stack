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
  template: `<section class="max-w-lg space-y-6">
    <h1 appUI i18n="@@authManageGoogle">Manage Google</h1>
    <p appUI tone="muted" i18n="@@authGoogleManageDescription">
      Link Google as another sign-in method. Linking or removing it requires a recent identity check.
    </p>
    @if (pending()) {
      <app-code-entry [busy]="action.busy()" (confirmed)="verify($event)" />
    } @else if (session.providers()?.google?.enabled) {
      <app-google-button
        [disabled]="action.busy()"
        (processing)="action.busy.set($event)"
        intent="link"
        (completed)="linked($event)"
      />
    }
    @for (provider of methods()?.google ?? []; track provider.id) {
      <section appUI="card">
        <p i18n="@@authGoogleLinked">Google is linked to your account.</p>
        <button
          appUI
          variant="danger"
          [disabled]="action.busy()"
          (click)="confirm.set(provider.id)"
          i18n="@@authUnlinkGoogle"
        >
          Unlink Google
        </button>
        @if (confirm() === provider.id) {
          <p role="status" i18n="@@authUnlinkGoogleConfirm">
            Unlink Google and end sessions using it? Keep another working sign-in method.
          </p>
          <button
            appUI
            variant="danger"
            [disabled]="action.busy()"
            (click)="unlink(provider.id)"
            i18n="@@authConfirmRemove"
          >
            Confirm removal</button
          ><button appUI variant="secondary" (click)="confirm.set(null)" i18n="@@authCancel">Cancel</button>
        }
      </section>
    }
    <app-auth-feedback [action]="action" /><a appUI routerLink="/security" i18n="@@authBackSecurity"
      >Back to security</a
    >
  </section>`,
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
