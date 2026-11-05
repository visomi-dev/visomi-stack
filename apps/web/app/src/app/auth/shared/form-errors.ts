import type { FieldTree } from '@angular/forms/signals';

export function focusInvalid<T>(fields: FieldTree<T>): void {
  fields().errorSummary()[0]?.fieldTree().focusBoundControl();
}
export const requiredMessage = $localize`:@@authRequired:Complete this field.`;
export const emailMessage = $localize`:@@authEmailInvalid:Enter a valid email address.`;
export const codeMessage = $localize`:@@authCodeInvalid:Enter the 6-digit code.`;
