import { Component, input, output, signal } from '@angular/core';
import { disabled, form, FormField, pattern, required, submit } from '@angular/forms/signals';

import { Button, Field, Input } from '../../ui';

import { codeMessage, requiredMessage, focusInvalid } from './form-errors';

@Component({
  selector: 'app-code-entry',
  imports: [Button, Field, Input, FormField],
  templateUrl: './code-entry.html',
})
export class CodeEntry {
  readonly busy = input(false);
  readonly backup = input(false);
  readonly confirmed = output<string>();

  readonly model = signal({ code: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { when: () => !this.backup(), message: codeMessage });
    disabled(path, { when: () => this.busy() });
  });

  readonly label = $localize`:@@authVerificationCode:Verification code`;

  verify(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () => {
        this.confirmed.emit(this.model().code);
        this.model.set({ code: '' });
      },
      onInvalid: focusInvalid,
    });
  }
}
