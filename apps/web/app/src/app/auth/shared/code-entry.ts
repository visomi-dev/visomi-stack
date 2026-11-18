import { Component, input, output, signal, type OnChanges, type SimpleChanges } from '@angular/core';
import { disabled, form, FormField, pattern, required, submit } from '@angular/forms/signals';

import { Button, Field, Input, PinInput } from '../../ui';

import { codeLength, codeMessage, requiredMessage, focusInvalid } from './form-errors';

@Component({
  selector: 'app-code-entry',
  imports: [Button, Field, Input, PinInput, FormField],
  host: { class: 'block min-w-0' },
  templateUrl: './code-entry.html',
})
export class CodeEntry implements OnChanges {
  readonly busy = input(false);
  readonly loading = input<boolean>();
  readonly backup = input(false);
  readonly confirmed = output<string>();

  readonly model = signal({ code: '' });
  readonly attempted = signal(false);

  readonly fields = form(this.model, (path) => {
    required(path.code, { message: requiredMessage });
    pattern(path.code, /^\d{6}$/, { when: () => !this.backup(), message: codeMessage });
    disabled(path, { when: () => this.busy() });
  });

  readonly codeLength = codeLength;
  readonly label = $localize`:@@authVerificationCode:Verification code`;

  ngOnChanges(changes: SimpleChanges<CodeEntry>): void {
    if (changes.backup) {
      this.fields().reset({ code: '' });
      this.attempted.set(false);
    }
  }

  verify(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
    void submit(this.fields, {
      action: async () => {
        this.confirmed.emit(this.model().code);
        this.fields().reset({ code: '' });
        this.attempted.set(false);
      },
      onInvalid: focusInvalid,
    });
  }
}
