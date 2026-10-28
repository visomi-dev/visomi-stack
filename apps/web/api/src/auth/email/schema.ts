import { z } from 'zod';

import { normalizeEmail } from './normalization';

export const emailSchema = z
  .string({ error: 'email_invalid' })
  .refine(validEmail, { error: 'email_invalid' })
  .transform(normalizeEmail)
  .meta({
    description:
      'Trimmed, lowercase account email, at most 254 characters after normalization. Provider-specific aliases are preserved.',
    example: 'synthetic@example.test',
  });

function validEmail(value: string): boolean {
  try {
    normalizeEmail(value);

    return true;
  } catch {
    return false;
  }
}
