import { z } from 'zod';

export const loginPasswordSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.length <= 512);
export const newPasswordSchema = loginPasswordSchema
  .normalize('NFC')
  .refine((value) => Array.from(value).length >= 12 && Array.from(value).length <= 128, { error: 'password_policy' })
  .meta({
    description:
      'A new password must contain 12–128 Unicode characters after NFC normalization. The HTTP input is bounded to 512 characters. Login proofs do not apply the new-password policy.',
    format: 'password',
  });
