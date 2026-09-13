import { config } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    MAIL_TRANSPORT: z.enum(['mailgun', 'memory']).optional(),
    MAILGUN_API_KEY: z.string().default(''),
    MAILGUN_DOMAIN: z.string().default(''),
    MAILGUN_FROM: z.string().default('Themis <no-reply@themis.local>'),
    MAILGUN_URL: z.string().optional(),
    API_INTERNAL_URL: z.string().default('http://127.0.0.1:3000'),
    DATABASE_URL: z.string().default('postgresql://postgres:postgres@127.0.0.1:5432/themis'),
    APP_BASE_URL: z.url().default('http://localhost:8080/app'),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    DATABASE_AUTO_MIGRATE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    DATABASE_DRIVER: z.enum(['memory', 'pg']).default('pg'),
    DATABASE_SSL: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    ENABLE_TEST_API: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    PIN_EXPIRY_MINUTES: z.coerce.number().default(10),
    PIN_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(45),
    EMAIL_OTP_DELIVERY_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 1000),
    EMAIL_OTP_DELIVERY_EMAIL_MAX: z.coerce.number().int().positive().default(5),
    EMAIL_OTP_DELIVERY_IP_MAX: z.coerce.number().int().positive().default(20),
    EMAIL_OTP_VERIFY_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    EMAIL_OTP_VERIFY_IP_MAX: z.coerce.number().int().positive().default(30),
    REMEMBERED_DEVICE_MAX_AGE_MS: z.coerce.number().default(1000 * 60 * 60 * 24 * 30),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    REALTIME_INTERNAL_URL: z.string().default('http://127.0.0.1:3001'),
    REALTIME_PATH: z.string().default('/socket.io'),
    SESSION_MAX_AGE_MS: z.coerce.number().default(1000 * 60 * 60 * 24 * 7),
    SESSION_SECRET: z.string().default('themis-dev-session-secret'),
    OPAQUE_SYNC_STORAGE: z.enum(['memory', 'durable']).default('memory'),
    OPAQUE_SYNC_S3_ENDPOINT: z.url().optional(),
    OPAQUE_SYNC_S3_BUCKET: z.string().default('themis-opaque-sync'),
    OPAQUE_SYNC_S3_ACCESS_KEY: z.string().default(''),
    OPAQUE_SYNC_S3_SECRET_KEY: z.string().default(''),
    OPAQUE_SYNC_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    LOCAL_AGENT_PUBLIC_KEY: z.string().default(''),
    GOOGLE_AUTH_CLIENT_ID: z.string().default(''),
    AUTH_PASSWORD_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    AUTH_TOTP_ENROLLMENT_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    AUTH_TOTP_ENCRYPTION_KEY: z.string().default(''),
    AUTH_PASSWORD_RATE_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    AUTH_PASSWORD_RATE_IDENTIFIER_MAX: z.coerce.number().int().positive().default(10),
    AUTH_PASSWORD_RATE_IP_MAX: z.coerce.number().int().positive().default(50),
    AUTH_PASSWORD_BLOCKLIST_PATH: z.string().default(''),
  })
  .superRefine((data, context) => {
    if (data.NODE_ENV !== 'production') return;

    if (data.SESSION_SECRET === 'themis-dev-session-secret' || data.SESSION_SECRET.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'A unique production session secret is required.',
      });
    }
    if (data.DATABASE_DRIVER !== 'pg' || data.DATABASE_AUTO_MIGRATE === true) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_DRIVER'],
        message: 'Production requires PostgreSQL and explicit migrations.',
      });
    }
    if (
      data.OPAQUE_SYNC_STORAGE !== 'durable' ||
      !data.OPAQUE_SYNC_S3_ENDPOINT ||
      !data.OPAQUE_SYNC_S3_ACCESS_KEY ||
      !data.OPAQUE_SYNC_S3_SECRET_KEY
    ) {
      context.addIssue({
        code: 'custom',
        path: ['OPAQUE_SYNC_STORAGE'],
        message: 'Production requires durable opaque object storage credentials.',
      });
    }
    if (!data.LOCAL_AGENT_PUBLIC_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_AGENT_PUBLIC_KEY'],
        message: 'The local-agent public key is required in production.',
      });
    }
    if (data.COOKIE_SECURE === 'false') {
      context.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Production cookies must be secure.' });
    }
    if (data.AUTH_TOTP_ENROLLMENT_ENABLED && data.AUTH_TOTP_ENCRYPTION_KEY.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_TOTP_ENCRYPTION_KEY'],
        message: 'A dedicated TOTP encryption key of at least 32 characters is required when TOTP is enabled.',
      });
    }
    if (data.AUTH_PASSWORD_ENABLED && !data.AUTH_PASSWORD_BLOCKLIST_PATH) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_PASSWORD_BLOCKLIST_PATH'],
        message: 'Password authentication requires a deployed common-password blocklist.',
      });
    }
  })
  .transform((data) => {
    const hasMailgunCredentials = Boolean(data.MAILGUN_API_KEY && data.MAILGUN_DOMAIN && data.MAILGUN_FROM);

    const mailTransport = data.MAIL_TRANSPORT ?? (hasMailgunCredentials ? 'mailgun' : 'memory');

    return {
      ...data,
      COOKIE_SECURE: data.COOKIE_SECURE === undefined ? data.NODE_ENV === 'production' : data.COOKIE_SECURE === 'true',
      MAIL_TRANSPORT: mailTransport,
    } as const;
  });

function getEnv({ filePath }: { filePath?: string } = {}) {
  config({ path: filePath });

  return environmentSchema.parse(process.env);
}

const env = getEnv();

export { env, getEnv };
