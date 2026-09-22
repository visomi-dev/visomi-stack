import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse } from 'dotenv';
import { Client } from 'pg';
import Redis from 'ioredis';

import { readTemplate } from './template-config.ts';

import { environmentSchema } from 'shared/environment-schema';

export type Diagnostic = { id: string; status: 'pass' | 'warn' | 'fail'; message: string; action?: string };
export type DoctorOptions = { offline?: boolean; running?: boolean; production?: boolean; envFile?: string };

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function parsedUrl(value: string | undefined, protocols: string[]): URL | null {
  try {
    const url = new URL(value ?? '');

    return protocols.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export async function diagnose(root: string, options: DoctorOptions = {}): Promise<Diagnostic[]> {
  const checks: Diagnostic[] = [];
  const add = (id: string, status: Diagnostic['status'], message: string, action?: string) =>
    checks.push({ id, status, message, ...(action ? { action } : {}) });
  const expectedNode = (await readFile(join(root, '.node-version'), 'utf8')).trim();
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    packageManager: string;
    name: string;
  };
  const expectedPnpm = pkg.packageManager.split('@')[1];
  const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 5000, cwd: root });

  add(
    'node',
    process.versions.node === expectedNode ? 'pass' : 'fail',
    `Expected Node ${expectedNode}; running ${process.versions.node}.`,
    'Run fnm install && fnm use.',
  );
  add(
    'pnpm',
    pnpm.status === 0 && pnpm.stdout.trim() === expectedPnpm ? 'pass' : 'fail',
    `Expected pnpm ${expectedPnpm}.`,
    'Run corepack enable; packageManager selects the pinned version.',
  );
  try {
    const template = await readTemplate(root);

    if (template.initialized)
      add(
        'project-name',
        pkg.name === template.project.slug ? 'pass' : 'fail',
        'Root package name must match the initialized project slug.',
        'Update the public metadata and package name together.',
      );

    add(
      'template',
      template.initialized ? 'pass' : 'warn',
      template.initialized
        ? 'Public template configuration is initialized.'
        : 'Template configuration has not been initialized.',
      'Run pnpm template:init --help.',
    );
  } catch {
    add(
      'template',
      'fail',
      'Public template configuration is invalid.',
      'Restore the documented template.json schema.',
    );
  }
  let file: Record<string, string>;

  try {
    file = parse(await readFile(resolve(root, options.envFile ?? '.env'), 'utf8'));
  } catch {
    add(
      'environment-file',
      'fail',
      'The requested environment file could not be read.',
      'Run template:init for a new project or supply --env-file explicitly.',
    );

    return checks;
  }
  const input: Record<string, string | undefined> = {
    ...file,
    ...process.env,
    ...(options.production ? { NODE_ENV: 'production' } : {}),
  };
  const parsed = environmentSchema.safeParse(input);

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].sort();

    add(
      'environment-schema',
      'fail',
      `Runtime configuration is invalid for: ${fields.join(', ')}.`,
      'See docs/template/configuration.md. Values are intentionally redacted.',
    );

    return checks;
  }
  const env = parsed.data;
  const secretKeys = [
    'SESSION_SECRET',
    'POSTGRES_PASSWORD',
    'AUTH_TOTP_ENCRYPTION_KEY',
    'MAILGUN_API_KEY',
    'OPAQUE_SYNC_S3_SECRET_KEY',
  ];
  const placeholders = secretKeys.filter(
    (key) => input[key] && /^(replace-|<)|local-development-only|themis-dev-session-secret/.test(input[key]!),
  );

  add(
    'secrets',
    placeholders.length ? 'fail' : 'pass',
    placeholders.length
      ? `Unconfigured values found for: ${placeholders.join(', ')}.`
      : 'No known secret placeholders detected.',
    'Generate unique values; do not print them in logs or paste them into diagnostics.',
  );
  const app = parsedUrl(env.APP_BASE_URL, ['http:', 'https:']);
  const webauthn = parsedUrl(input['WEBAUTHN_ORIGIN'], ['http:', 'https:']);
  const site = parsedUrl(input['SITE_URL'], ['http:', 'https:']);
  const rpId = input['WEBAUTHN_RP_ID'];
  const relatedRp = Boolean(webauthn && rpId && (webauthn.hostname === rpId || webauthn.hostname.endsWith(`.${rpId}`)));
  const secureOrigin = Boolean(
    webauthn && (webauthn.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(webauthn.hostname)),
  );
  const originsMatch = Boolean(
    app &&
    webauthn &&
    site &&
    app.origin === webauthn.origin &&
    site.origin === webauthn.origin &&
    webauthn.pathname === '/' &&
    !webauthn.search &&
    !webauthn.hash &&
    !webauthn.username &&
    !webauthn.password &&
    app.pathname === '/app' &&
    site.pathname === '/' &&
    [app, site].every((url) => !url.username && !url.password && !url.search && !url.hash),
  );

  add(
    'origins',
    originsMatch && relatedRp && secureOrigin ? 'pass' : 'fail',
    'Check SITE_URL, APP_BASE_URL, WEBAUTHN_ORIGIN, and WEBAUTHN_RP_ID as one origin contract.',
    'Use the same origin; APP_BASE_URL ends in /app. Remote WebAuthn requires HTTPS.',
  );
  const production = env.NODE_ENV === 'production';

  if (production && (!webauthn || webauthn.protocol !== 'https:' || !env.COOKIE_SECURE))
    add('production-origin', 'fail', 'Production requires HTTPS and secure cookies.');
  if (env.ENABLE_TEST_API) {
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(input['HOST'] ?? '');

    add(
      'test-api',
      loopback && !production ? 'warn' : 'fail',
      'Test fixture APIs are enabled.',
      'Use only for an isolated loopback-bound demo; disable before exposing the service.',
    );
  } else add('test-api', 'pass', 'Test APIs are disabled.');
  if (env.MAIL_TRANSPORT === 'mailgun') {
    const senderConfigured =
      Boolean(env.MAILGUN_FROM.trim()) && !/@(?:localhost|example\.invalid)[>\s]*$/i.test(env.MAILGUN_FROM);

    add(
      'mail',
      env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && senderConfigured ? 'pass' : 'fail',
      'Mailgun requires API key, verified domain, and sender configuration.',
      'Set MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_FROM.',
    );
  } else
    add(
      'mail',
      production ? 'fail' : 'warn',
      'Memory mail does not deliver verification emails.',
      'Use the local demo mailbox or configure Mailgun.',
    );
  add(
    'google',
    env.GOOGLE_AUTH_CLIENT_ID ? 'pass' : 'warn',
    env.GOOGLE_AUTH_CLIENT_ID
      ? 'Google client configuration is present; remote authorization was not tested.'
      : 'Google sign-in is disabled.',
  );
  add(
    'totp',
    env.AUTH_TOTP_ENROLLMENT_ENABLED && env.AUTH_TOTP_ENCRYPTION_KEY.length < 32 ? 'fail' : 'pass',
    env.AUTH_TOTP_ENROLLMENT_ENABLED
      ? 'TOTP requires a dedicated encryption key of at least 32 characters.'
      : 'TOTP enrollment is disabled.',
  );
  if (!env.LOCAL_AGENT_PUBLIC_KEY) add('local-agent', 'warn', 'Protected local-agent functionality is not configured.');
  const database = parsedUrl(env.DATABASE_URL, ['postgres:', 'postgresql:']);
  const redisUrl = parsedUrl(env.REDIS_URL, ['redis:', 'rediss:']);

  if (!database) add('database-url', 'fail', 'DATABASE_URL is not a valid PostgreSQL URL.');
  if (!redisUrl) add('redis-url', 'fail', 'REDIS_URL is not a valid Redis URL.');
  if (options.offline) {
    add('connectivity', 'warn', 'Offline mode: service connectivity, ports, and migration state were not checked.');

    return checks;
  }
  if (env.DATABASE_DRIVER === 'pg' && database) {
    const client = new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
      ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
    });

    try {
      client.on('error', () => undefined);
      await client.connect();
      await client.query('SELECT 1');
      add('postgres', 'pass', 'PostgreSQL connection and authentication succeeded.');
      try {
        const applied = await client.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations');
        const hashes = new Set(applied.rows.map((row) => row.hash));
        const directories = await readdir(join(root, 'drizzle'), { withFileTypes: true });
        let missing = 0;

        for (const entry of directories.filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))) {
          const sql = await readFile(join(root, 'drizzle', entry.name, 'migration.sql'), 'utf8');

          if (!hashes.has(createHash('sha256').update(sql).digest('hex'))) missing += 1;
        }
        add(
          'migrations',
          missing ? 'fail' : 'pass',
          missing
            ? `${missing} local migrations are not recorded with matching hashes.`
            : 'All local migration hashes are recorded.',
          'Review migration history, then run pnpm db:migrate against the intended database.',
        );
      } catch {
        add(
          'migrations',
          'fail',
          'Migration history could not be verified.',
          'Run pnpm db:migrate against the intended database.',
        );
      }
    } catch {
      add(
        'postgres',
        'fail',
        'PostgreSQL connection or authentication failed.',
        'Start the local database and check DATABASE_URL / DATABASE_SSL.',
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  } else if (env.DATABASE_DRIVER === 'memory')
    add('postgres', 'warn', 'The memory database is temporary; durable migration state cannot be inspected here.');
  if (redisUrl) {
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });

    redis.on('error', () => undefined);
    try {
      await redis.connect();
      await redis.ping();
      add('redis', 'pass', 'Redis connection and authentication succeeded.');
    } catch {
      add('redis', 'fail', 'Redis connection or authentication failed.', 'Start Redis and check REDIS_URL.');
    } finally {
      redis.disconnect();
    }
  }
  const port = Number(input['PORT'] ?? input['GATEWAY_PORT'] ?? 8080);

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    add('gateway', 'fail', 'PORT/GATEWAY_PORT must be a valid port number.');
  else if (options.running && webauthn) {
    try {
      const response = await fetch(new URL('/readyz', webauthn), { signal: AbortSignal.timeout(3000) });

      add(
        'gateway',
        response.ok ? 'pass' : 'fail',
        response.ok ? 'Gateway readiness endpoint succeeded.' : 'Gateway is not ready.',
      );
    } catch {
      add(
        'gateway',
        'fail',
        'Gateway readiness could not be reached.',
        'Start the composed runtime or check its public origin.',
      );
    }
  } else
    add(
      'gateway-port',
      (await portAvailable(port)) ? 'pass' : 'fail',
      `Gateway port ${port} must be available before startup.`,
      'If the app is already running, use --running. Do not stop unrelated processes.',
    );

  return checks;
}
