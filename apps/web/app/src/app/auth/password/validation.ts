import { validate, type SchemaPath } from '@angular/forms/signals';

export function passwordPolicy(path: SchemaPath<string>): void {
  validate(path, ({ value }) => {
    const length = Array.from(value().normalize('NFC')).length;

    return length >= 12 && length <= 128
      ? undefined
      : {
          kind: 'password_policy',
          message: $localize`:@@authPasswordPolicy:Use 12–128 characters. Spaces and passphrases are welcome.`,
        };
  });
}
