import { Component, input, output, signal } from '@angular/core';
import { disabled, form, FormField, pattern, required, submit } from '@angular/forms/signals';

import { Button, Field, Input } from '../../ui';

import { codeMessage, requiredMessage, formFocus } from './form-errors';

@Component({
  selector: 'app-code-entry',
  imports: [Button, Field, Input, FormField],
  template: ` <form
    novalidate
    [attr.data-submitted]="attempted() ? '' : null"
    (submit)="verify($event)"
    class="space-y-5"
  >
    <app-field
      #field="appField"
      control-id="verification-code"
      [label]="label"
      [error]="fields.code().errors()[0]?.message ?? ''"
    >
      <input
        appUI
        [formField]="fields.code"
        [id]="field.controlId()"
        [attr.aria-describedby]="field.describedBy()"
        [attr.aria-invalid]="fields.code().touched() && fields.code().invalid()"
        [attr.autocomplete]="backup() ? 'off' : 'one-time-code'"
        [attr.inputmode]="backup() ? 'text' : 'numeric'"
        placeholder=" "
      /> </app-field
    ><button appUI type="submit" class="w-full" [disabled]="busy()" i18n="@@authVerify">Verify</button>
  </form>`,
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

  private readonly focusInvalid = formFocus();

  verify(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, async () => {
      this.confirmed.emit(this.model().code);
      this.model.set({ code: '' });
    });

    if (this.fields().invalid()) {
      this.focusInvalid();
    }
  }
}
