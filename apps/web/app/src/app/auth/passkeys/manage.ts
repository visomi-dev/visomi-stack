import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, maxLength, disabled, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Field, Input, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Session } from '../session/session';
import { requiredMessage, focusInvalid } from '../shared/form-errors';

import { Passkeys, type Passkey } from './passkeys';

@Component({
  selector: 'app-manage-passkeys',
  imports: [NavigationHeading, Button, Heading, Text, Link, Field, Input, Card, FormField, RouterLink, AuthFeedback],
  providers: [Action, AuthHttp, Passkeys],
  templateUrl: './manage.html',
})
export class ManagePasskeys {
  private readonly api = inject(Passkeys);
  private readonly session = inject(Session);
  private readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

  readonly keys = signal<Passkey[]>([]);
  readonly editing = signal<string | null>(null);
  readonly removing = signal<string | null>(null);
  readonly model = signal({ label: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.label, { message: requiredMessage });
    maxLength(path.label, 64);
    disabled(path, { when: () => this.action.busy() });
  });

  readonly nameLabel = $localize`:@@authPasskeyName:Passkey name`;

  async reload(): Promise<void> {
    const result = await this.api.list();

    this.keys.set(result.credentials);
  }

  add(): void {
    void this.action.run(
      async () => {
        await this.api.register();

        await this.reload();

        this.action.setNotice($localize`:@@authPasskeyAdded:Your passkey has been added.`);
      },
      { name: 'add' },
    );
  }

  edit(key: Passkey): void {
    this.removing.set(null);
    this.fields().reset({ label: key.label });
    this.attempted.set(false);
    this.editing.set(key.id);
  }

  rename(event: Event, id: string): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
        this.action.run(
          async () => {
            await this.api.rename(id, this.model().label);

            this.editing.set(null);

            await this.reload();
          },
          { name: 'rename:' + id },
        ),
      onInvalid: focusInvalid,
    });
  }

  remove(id: string): void {
    void this.action.run(
      async () => {
        await this.api.revoke(id);

        this.removing.set(null);

        await this.session.load(true);

        if (this.session.full()) {
          await this.reload();
        } else {
          await this.navigation.complete();
        }
      },
      { name: 'remove:' + id },
    );
  }

  private readonly initialize = afterNextRender(() => void this.action.run(() => this.reload()));
}
