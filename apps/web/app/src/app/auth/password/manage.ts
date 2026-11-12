import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, afterNextRender, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, disabled, submit } from '@angular/forms/signals';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Heading, Text, Link, Field, Input, Card } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { Session } from '../session/session';
import { Methods } from '../session/methods';
import { Reauthenticate } from '../session/reauthenticate';
import { requiredMessage, focusInvalid } from '../shared/form-errors';

import { passwordPolicy } from './validation';
import { Passwords } from './passwords';

@Component({
  selector: 'app-manage-password',
  imports: [
    NavigationHeading,
    Button,
    Heading,
    Text,
    Link,
    Field,
    Input,
    FormField,
    RouterLink,
    AuthFeedback,
    Card,
    Reauthenticate,
  ],
  providers: [Action, AuthHttp, Passwords, Methods, Journey],
  templateUrl: './manage.html',
})
export class ManagePassword {
  private readonly api = inject(Passwords);
  private readonly methods = inject(Methods);
  private readonly session = inject(Session);
  private readonly navigation = inject(AuthNavigation);
  private readonly destroyRef = inject(DestroyRef);
  readonly action = inject(Action);

  readonly exists = signal(false);
  readonly loaded = signal(false);
  readonly confirm = signal(false);
  readonly visible = signal(false);
  readonly model = signal({ password: '' });
  readonly attempted = signal(false);
  readonly verifying = signal(false);
  readonly restoreFocus = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.password, { message: requiredMessage });
    passwordPolicy(path.password);
    disabled(path, { when: () => this.action.busy() });
  });

  readonly showLabel = $localize`:@@authShowPassword:Show`;
  readonly hideLabel = $localize`:@@authHidePassword:Hide`;
  readonly passwordLabel = $localize`:@@authNewPassword:New password`;
  readonly policy = $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`;
  readonly confirmationTitle = $localize`:@@authPasswordConfirmTitle:Confirm your password change`;
  readonly confirmationDescription = $localize`:@@authPasswordConfirmDescription:Confirm your identity to save the password you just entered. It will be saved automatically after verification.`;

  private readonly owner = this.session.user()?.id;
  private readonly cleanup = this.destroyRef.onDestroy(() => this.model.set({ password: '' }));

  save(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () => this.action.run(() => this.persist(), { name: 'save' }),
      onInvalid: focusInvalid,
    });
  }

  verified(): void {
    if (!this.verifying()) {
      return;
    }

    this.verifying.set(false);
    this.restoreFocus.set(true);
    void this.action.run(() => this.persist(), { name: 'save' });
  }

  cancelVerification(): void {
    this.fields().reset({ password: '' });
    this.attempted.set(false);
    this.visible.set(false);
    this.verifying.set(false);
    this.restoreFocus.set(true);
  }

  remove(): void {
    void this.action.run(
      async () => {
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
      },
      { name: 'remove' },
    );
  }

  private async persist(): Promise<void> {
    if (!this.session.full() || this.session.user()?.id !== this.owner) {
      this.cancelVerification();

      throw new DOMException('Cancelled', 'AbortError');
    }

    try {
      const result = await this.api.save(this.model().password, this.exists());

      this.exists.set(true);
      this.fields().reset({ password: '' });
      this.attempted.set(false);
      this.visible.set(false);
      this.action.setNotice(
        result.notificationSent === false
          ? $localize`:@@authNotificationFailed:The change was saved, but the notification could not be sent.`
          : $localize`:@@authPasswordSaved:Your password has been saved.`,
      );
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.error?.error === 'reauthentication_required' &&
        this.session.full()
      ) {
        this.visible.set(false);
        this.verifying.set(true);
      } else {
        throw error;
      }
    }
  }

  private readonly initialize = afterNextRender(
    () =>
      void this.action.run(async () => {
        const methods = await this.methods.list();

        this.exists.set(methods.password);
        this.loaded.set(true);
      }),
  );

  private readonly protectDraft = effect((onCleanup) => {
    const cancellation = this.session.cancellation();

    if (!this.session.full() || this.session.user()?.id !== this.owner) {
      untracked(() => this.cancelVerification());
    }

    const clear = () => this.cancelVerification();

    cancellation.addEventListener('abort', clear, { once: true });
    onCleanup(() => cancellation.removeEventListener('abort', clear));
  });
}
