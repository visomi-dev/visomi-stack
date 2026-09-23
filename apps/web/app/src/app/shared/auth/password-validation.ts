import { validate, type SchemaPath } from '@angular/forms/signals';

export function passwordLength(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

export function validatePasswordLength(path: SchemaPath<string>): void {
  validate(path, ({ value }) => {
    const length = passwordLength(value());

    if (length < 12)
      return { kind: 'minLength', message: $localize`:@@identityPasswordSetupLength:Use at least 12 characters.` };
    if (length > 128)
      return { kind: 'maxLength', message: $localize`:@@signupPasswordMaximum:Use 128 characters or fewer.` };

    return undefined;
  });
}
