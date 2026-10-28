import type { ValidationErrors } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

export const emptyBody = z.strictObject({});
export const identifierSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const identityParams = z.object({ id: identifierSchema });
export const factorSchema = z.strictObject({
  kind: z.enum(['email', 'totp', 'recovery_code']),
  code: z.string().min(1).max(128),
});
export const codeSchema = z.string().min(1).max(6).meta({ description: 'Six-digit email or authenticator code.' });
export const flowBody = z.strictObject({ flowId: identifierSchema });
export const verificationBody = flowBody.extend({ code: codeSchema });
export const expirySchema = z.iso.datetime();
export const pendingSchema = z.object({ flowId: identifierSchema, expiresAt: expirySchema });
export const factorPendingSchema = pendingSchema.extend({ factor: z.enum(['email', 'totp']) });
export const sessionSchema = z.object({
  authenticated: z.boolean(),
  user: z.object({ id: z.string(), email: z.string().nullable(), emailVerified: z.boolean() }).nullable(),
  csrfToken: z.string(),
  access: z.enum(['anonymous', 'unverified', 'full', 'recovery', 'enrollment']),
  method: z.enum(['passkey', 'password', 'google', 'recovery', 'device']).nullable(),
  nextStep: z.enum(['verify_email', 'add_email', 'enroll_method']).nullable(),
});
export const notifiedSessionSchema = sessionSchema.extend({ notificationSent: z.boolean() });
export const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  body: z.unknown().optional(),
});
export const commonErrors = {
  400: {
    description: 'Invalid request or verification proof.',
    content: { 'application/json': { schema: errorSchema } },
  },
  401: {
    description: 'Authentication or recent reauthentication required.',
    content: { 'application/json': { schema: errorSchema } },
  },
  403: {
    description: 'Access denied, mismatched identity or invalid origin/CSRF proof.',
    content: { 'application/json': { schema: errorSchema } },
  },
  404: { description: 'Resource not found.', content: { 'application/json': { schema: errorSchema } } },
  409: {
    description: 'Conflict with identity state or the last usable method.',
    content: { 'application/json': { schema: errorSchema } },
  },
  413: { description: 'JSON body exceeds 32 KiB.', content: { 'application/json': { schema: errorSchema } } },
  429: {
    description: 'Shared request/identity limit or proof cooldown exhausted.',
    headers: { 'Retry-After': { description: 'Retry delay in seconds when provided.', schema: z.string() } },
    content: { 'application/json': { schema: errorSchema } },
  },
  503: {
    description: 'Authentication, persistence or mail delivery unavailable.',
    content: { 'application/json': { schema: errorSchema } },
  },
};
export const cookieSecurity = [{ sessionCookie: [] }, { localSessionCookie: [] }];
export const csrfSecurity = [
  { sessionCookie: [], csrf: [] },
  { localSessionCookie: [], csrf: [] },
];
export const mutationDescription =
  'Requires the configured Origin and the X-CSRF-Token returned by GET /auth/session. Replace the token after session rotation. PostgreSQL request limits and proof lifetimes apply.';

export const validationErrors = {
  email_invalid: { status: 400, code: 'email_invalid' },
  password_policy: { status: 400, code: 'password_policy' },
  intent_invalid: { status: 403, code: 'intent_invalid' },
} satisfies ValidationErrors;
