import { environmentSchema } from './environment-schema';

describe('side-effect-free runtime environment schema', () => {
  const production = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'test-production-secret-with-at-least-32-characters',
    DATABASE_DRIVER: 'pg',
    DATABASE_AUTO_MIGRATE: 'false',
    COOKIE_SECURE: 'true',
    OPAQUE_SYNC_STORAGE: 'durable',
    OPAQUE_SYNC_S3_ENDPOINT: 'https://objects.example.test',
    OPAQUE_SYNC_S3_ACCESS_KEY: 'test-access-key',
    OPAQUE_SYNC_S3_SECRET_KEY: 'test-secret-key',
    LOCAL_AGENT_PUBLIC_KEY: 'test-pinned-public-key',
    MAIL_TRANSPORT: 'mailgun',
    MAILGUN_API_KEY: 'test-mail-key',
    MAILGUN_DOMAIN: 'mail.example.test',
  };

  it('retains runtime defaults without reading or modifying process.env', () => {
    const result = environmentSchema.parse({});

    expect(result.NODE_ENV).toBe('development');
    expect(result.DATABASE_DRIVER).toBe('pg');
    expect(result.DATABASE_URL).toBe('postgresql://postgres:local-development-only@127.0.0.1:5432/visomi');
    expect(result.ENABLE_TEST_API).toBe(false);
    expect(result.ENABLE_LOCAL_ACTIVATION).toBe(false);
  });

  it('only permits local activation on a localhost development origin', () => {
    expect(
      environmentSchema.safeParse({
        ENABLE_LOCAL_ACTIVATION: 'true',
        HOST: '127.0.0.1',
        APP_BASE_URL: 'http://localhost:8080/app',
      }).success,
    ).toBe(true);
    expect(
      environmentSchema.safeParse({
        ENABLE_LOCAL_ACTIVATION: 'true',
        HOST: '127.0.0.1',
        APP_BASE_URL: 'https://example.test/app',
      }).success,
    ).toBe(false);
    expect(
      environmentSchema.safeParse({ ENABLE_LOCAL_ACTIVATION: 'true', APP_BASE_URL: 'http://localhost:8080/app' })
        .success,
    ).toBe(false);
    expect(environmentSchema.safeParse({ ...production, ENABLE_LOCAL_ACTIVATION: 'true' }).success).toBe(false);
  });

  it('rejects a production deployment with fixture APIs enabled', () => {
    expect(environmentSchema.safeParse({ ...production, ENABLE_TEST_API: 'false' }).success).toBe(true);
    const result = environmentSchema.safeParse({ ...production, ENABLE_TEST_API: 'true' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === 'ENABLE_TEST_API')).toBe(true);
  });

  it('rejects example-file placeholders even when they meet the minimum secret length', () => {
    expect(
      environmentSchema.safeParse({ ...production, SESSION_SECRET: 'replace-with-a-unique-local-secret' }).success,
    ).toBe(false);
    expect(
      environmentSchema.safeParse({
        ...production,
        AUTH_TOTP_ENROLLMENT_ENABLED: 'true',
        AUTH_TOTP_ENCRYPTION_KEY: 'replace-with-a-dedicated-local-encryption-key',
      }).success,
    ).toBe(false);
  });
});
