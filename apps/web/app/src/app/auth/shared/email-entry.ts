import { Component, input, output, signal } from '@angular/core';
import { disabled, email, form, FormField, required, submit } from '@angular/forms/signals';

import { Button, Field, Input } from '../../ui';

import { emailMessage, requiredMessage, focusInvalid } from './form-errors';

@Component({
  selector: 'app-email-entry',
  imports: [Button, Field, Input, FormField],
  templateUrl: './email-entry.html',
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

  send(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () => {
        this.confirmed.emit(this.model().email.trim());
      },
      onInvalid: focusInvalid,
    });
  }
}
