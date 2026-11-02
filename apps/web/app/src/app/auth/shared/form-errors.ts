import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';

export function formFocus() {
  const document = inject(DOCUMENT);

  return () =>
    queueMicrotask(() =>
      document.querySelector<HTMLInputElement>('form [aria-invalid="true"], form input:invalid')?.focus(),
    );
}
export const requiredMessage = $localize`:@@authRequired:Complete this field.`;
export const emailMessage = $localize`:@@authEmailInvalid:Enter a valid email address.`;
export const codeMessage = $localize`:@@authCodeInvalid:Enter the 6-digit code.`;
