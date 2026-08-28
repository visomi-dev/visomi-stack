import { Component, computed, input, output, signal } from '@angular/core';
import { form, FormField, maxLength, minLength, required, type FieldTree } from '@angular/forms/signals';

import { Alert } from '../../shared/ui/overlays/alert/alert';
import { Button } from '../../shared/ui/actions/button/button';
import { Description } from '../../shared/ui/forms/description/description';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Label } from '../../shared/ui/forms/label/label';
import { PinInput } from '../../shared/ui/forms/pin-input/pin-input';

type VerificationModel = {
  pin: string;
};

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-verification-code-form',
  imports: [Alert, AppForm, Button, Description, ErrorMessage, Field, FormField, Label, PinInput],
  templateUrl: './verification-code-form.html',
  styleUrl: './verification-code-form.css',
})
export class VerificationCodeForm {
  readonly errorMessage = input('');
  readonly pinManualError = input<string | null>(null);
  readonly statusMessage = input('');
  readonly submitting = input(false);

  readonly verify = output<string>();
  readonly resend = output<void>();

  readonly verificationModel = signal<VerificationModel>({ pin: '' });

  readonly verificationForm: FieldTree<VerificationModel> = form(
    this.verificationModel,
    (p) => {
      required(p.pin, { message: $localize`:@@verificationCodeErrorRequired:Enter the verification code.` });
      minLength(p.pin, 6, { message: $localize`:@@verificationCodeErrorLength:Enter the full 6-digit code.` });
      maxLength(p.pin, 6, { message: $localize`:@@verificationCodeErrorLength:Enter the full 6-digit code.` });
    },
    {
      submission: {
        action: async (field) => {
          if (this.submitting()) {
            return;
          }

          this.verify.emit(field().value().pin);
        },
      },
    },
  );

  readonly pinError = computed(() => this.verificationForm.pin().errors()[0]?.message ?? '');
  readonly resolvedPinError = computed(() => this.pinError() || this.pinManualError() || '');
}
