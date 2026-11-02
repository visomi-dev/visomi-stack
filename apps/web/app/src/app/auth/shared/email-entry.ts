import { Component, input, output, signal } from '@angular/core';
import { disabled, email, form, FormField, required, submit } from '@angular/forms/signals';

import { Button, Field, Input } from '../../ui';

import { emailMessage, requiredMessage, formFocus } from './form-errors';

@Component({
  selector: 'app-email-entry',
  imports: [Button, Field, Input, FormField],
  template: `<form novalidate class="space-y-5" [attr.data-submitted]="attempted() ? '' : null" (submit)="send($event)">
    <app-field
      #field="appField"
      control-id="auth-email"
      [label]="emailLabel"
      [error]="fields.email().errors()[0]?.message ?? ''"
      ><input
        appUI
        [formField]="fields.email"
        type="email"
        autocomplete="email"
        [id]="field.controlId()"
        [attr.aria-describedby]="field.describedBy()"
        [attr.aria-invalid]="fields.email().touched() && fields.email().invalid()"
        placeholder=" " /></app-field
    ><button appUI class="w-full" type="submit" [disabled]="busy()">{{ label() }}</button>
  </form>`,
})
export class EmailEntry {
  readonly busy = input(false);
  readonly label = input($localize`:@@authContinue:Continue`);
  readonly confirmed = output<string>();

  readonly model = signal({ email: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.email, { message: requiredMessage });
    email(path.email, { message: emailMessage });
    disabled(path, { when: () => this.busy() });
  });

  readonly emailLabel = $localize`:@@authEmail:Email address`;

  private readonly focusInvalid = formFocus();

  send(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, async () => {
      this.confirmed.emit(this.model().email.trim());
    });

    if (this.fields().invalid()) {
      this.focusInvalid();
    }
  }
}
