import { HttpError } from '@visomi-stack/web-backend-shared';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'email_invalid');
  }

  const email = value.trim().toLowerCase();

  if (
    email.length > 254 ||
    Array.from(email).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
  ) {
    throw new HttpError(400, 'email_invalid');
  }

  return email;
}
