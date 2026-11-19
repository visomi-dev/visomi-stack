import {
  Component,
  booleanAttribute,
  computed,
  input,
  output,
  signal,
  type OnChanges,
  type SimpleChanges,
} from '@angular/core';
import { disabled, form, FormField, pattern, required, submit } from '@angular/forms/signals';

import { Button, Field, Input, Loader, PinInput } from '../../../ui';
import { codeLength, codeMessage, requiredMessage, focusInvalid } from '../form-errors';

@Component({
  selector: 'app-code-entry',
  imports: [Button, Field, Input, Loader, PinInput, FormField],
  host: { class: 'block min-w-0' },
  templateUrl: './code-entry.html',
})
export class CodeEntry implements OnChanges {
  readonly backup = input(false);
  readonly autoSubmit = input(false, { alias: 'auto-submit', transform: booleanAttribute });
  protected readonly automatic = computed(() => this.autoSubmit() && !this.backup());

  readonly busy = input(false);
  readonly loading = input<boolean>();
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

  protected verify(event: Event): void {
    event.preventDefault();

    if (!this.automatic()) {
      this.submitCode();
    }
  }

  protected complete(): void {
    if (this.automatic()) {
      this.submitCode();
    }
  }

  private submitCode(): void {
    if (this.busy() || this.fields().submitting()) {
      return;
    }

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
