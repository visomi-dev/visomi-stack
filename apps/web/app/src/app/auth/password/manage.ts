import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, disabled, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Field, Input, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Session } from '../session/session';
import { Methods } from '../session/methods';
import { requiredMessage, focusInvalid } from '../shared/form-errors';

import { passwordPolicy } from './validation';
import { Passwords } from './passwords';

@Component({
  selector: 'app-manage-password',
  imports: [NavigationHeading, Button, Heading, Text, Link, Field, Input, FormField, RouterLink, AuthFeedback, Card],
  providers: [Action, AuthHttp, Passwords, Methods],
  templateUrl: './manage.html',
})
export class ManagePassword {
  private readonly api = inject(Passwords);
  private readonly methods = inject(Methods);
  private readonly session = inject(Session);
  private readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

  readonly exists = signal(false);
  readonly loaded = signal(false);
  readonly confirm = signal(false);
  readonly visible = signal(false);
  readonly model = signal({ password: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.password, { message: requiredMessage });
    passwordPolicy(path.password);
    disabled(path, { when: () => this.action.busy() });
  });

  readonly showLabel = $localize`:@@authShowPassword:Show`;
  readonly hideLabel = $localize`:@@authHidePassword:Hide`;
  readonly passwordLabel = $localize`:@@authNewPassword:New password`;
  readonly policy = $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`;

  save(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () =>
        this.action.run(async () => {
          try {
            const result = await this.api.save(this.model().password, this.exists());

            this.exists.set(true);
            this.action.setNotice(
              result.notificationSent === false
                ? $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`
                : $localize`:@@authPasswordSaved:Your password has been saved.`,
            );
          } finally {
            this.fields().reset({ password: '' });
            this.attempted.set(false);
          }
        }),
      onInvalid: focusInvalid,
    });
  }

  remove(): void {
    void this.action.run(async () => {
      const result = await this.api.remove();

      this.confirm.set(false);

      await this.session.load(true);

      if (!this.session.full()) {
        await this.navigation.complete();

        return;
      }

      this.exists.set(false);
      this.action.setNotice(
        result?.notificationSent === false
          ? $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`
          : $localize`:@@authPasswordRemoved:Your password has been removed.`,
      );
    });
  }

  private readonly initialize = afterNextRender(
    () =>
      void this.action.run(async () => {
        const methods = await this.methods.list();

        this.exists.set(methods.password);
        this.loaded.set(true);
      }),
  );
}
