import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

import { initializeTemplate, readTemplate } from './template-config.ts';
import { diagnose } from './doctor.ts';
import { smoke } from './smoke.ts';

const help = `Visomi Stack template tools

pnpm template:init --name "My App" --slug my-app --organization "My Company" [options]
  --local-origin http://localhost:8080   Development origin (localhost, port >= 1024)
  --public-origin https://example.com  Public metadata; does not deploy or configure DNS
  --locale en|es                       Default public-site language; both builds remain available
  --postgres-port 5432 --redis-port 6379
  --google-client-id PUBLIC_CLIENT_ID  Optional Google configuration
  --totp enabled|disabled              Default: enabled, with a newly generated dedicated key
  --demo                              Enable test APIs on the loopback-bound local server
  --dry-run                           Show only the explicit files that would change

pnpm template:doctor [--offline] [--running] [--production] [--env-file .env] [--json]
  Read-only diagnostics. Configuration values and service errors are redacted.

pnpm template:smoke [--memory] [--keep] [--restore]
  --restore requires task-owned containers and verifies pg_dump/pg_restore into a new database,
  schema/data fingerprints, migrations, password sign-in, a MinIO encrypted canary restore,
  and protected synthetic TOTP-v1 key continuity. Full vault/production escrow recovery is not claimed.
  Export a clean copy, install, initialize, build, start, and exercise real signup/sign-in.
  Default: isolated PostgreSQL/Redis containers, or explicitly supplied SMOKE_DATABASE_URL
  and SMOKE_REDIS_URL pointing to disposable test services. Never uses ambient DATABASE_URL.
  --memory uses PGlite and a task-owned redis-server (or SMOKE_REDIS_URL), not PostgreSQL.
  --keep retains the ignored temporary copy; logs/result evidence are retained either way.
`;

async function main(): Promise<void> {
  const command = process.argv[2];
  const root = process.cwd();
  const { values } = parseArgs({
    args: process.argv.slice(3),
    strict: true,
    options: {
      help: { type: 'boolean' },
      name: { type: 'string' },
      slug: { type: 'string' },
      organization: { type: 'string' },
      'local-origin': { type: 'string' },
      'public-origin': { type: 'string' },
      locale: { type: 'string' },
      'postgres-port': { type: 'string' },
      'redis-port': { type: 'string' },
      'google-client-id': { type: 'string' },
      totp: { type: 'string' },
      demo: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      offline: { type: 'boolean' },
      running: { type: 'boolean' },
      production: { type: 'boolean' },
      'env-file': { type: 'string' },
      json: { type: 'boolean' },
      memory: { type: 'boolean' },
      restore: { type: 'boolean' },
      keep: { type: 'boolean' },
    },
  });

  if (values.help || !command) {
    console.log(help);

    return;
  }
  const allowed: Record<string, string[]> = {
    init: [
      'name',
      'slug',
      'organization',
      'local-origin',
      'public-origin',
      'locale',
      'postgres-port',
      'redis-port',
      'google-client-id',
      'totp',
      'demo',
      'dry-run',
    ],
    doctor: ['offline', 'running', 'production', 'env-file', 'json'],
    smoke: ['memory', 'keep', 'restore'],
  };
  const invalid = Object.keys(values).find((key) => !allowed[command]?.includes(key));

  if (invalid) throw new Error(`Option --${invalid} is not supported by ${command}. Use --help.`);
  if (command === 'init') {
    let name = values.name;
    let slug = values.slug;
    let organization = values.organization;

    if (!name || !slug) {
      if (!process.stdin.isTTY)
        throw new Error('Noninteractive initialization requires --name and --slug. Use --help.');
      const existing = await readTemplate(root);
      const input = createInterface({ input: process.stdin, output: process.stdout });

      try {
        name ??= await input.question('Application display name: ');
        slug ??= await input.question('Project slug (lowercase kebab-case): ');
        organization ??=
          (await input.question(`Organization [${existing.project.organization}]: `)) || existing.project.organization;
      } finally {
        input.close();
      }
    }
    if (values.totp && !['enabled', 'disabled'].includes(values.totp))
      throw new Error('--totp must be enabled or disabled.');
    const result = await initializeTemplate(root, {
      name,
      slug,
      organization,
      localOrigin: values['local-origin'],
      publicOrigin: values['public-origin'],
      locale: values.locale,
      postgresPort: values['postgres-port'] ? Number(values['postgres-port']) : undefined,
      redisPort: values['redis-port'] ? Number(values['redis-port']) : undefined,
      googleClientId: values['google-client-id'],
      demo: values.demo,
      totp: values.totp ? values.totp === 'enabled' : undefined,
      dryRun: values['dry-run'],
    });

    console.log(
      result.changed.length
        ? `${result.dryRun ? 'Would initialize' : 'Initialized'}: ${result.changed.join(', ')}. No secret values printed.`
        : 'Already initialized. No files or secrets changed.',
    );
  } else if (command === 'doctor') {
    const checks = await diagnose(root, {
      offline: values.offline,
      running: values.running,
      production: values.production,
      envFile: values['env-file'],
    });
    const ok = checks.every((check) => check.status !== 'fail');

    if (values.json) console.log(JSON.stringify({ ok, checks }, null, 2));
    else
      for (const check of checks)
        console.log(
          `[${check.status.toUpperCase()}] ${check.id}: ${check.message}${check.status !== 'pass' && check.action ? ` ${check.action}` : ''}`,
        );
    process.exitCode = ok ? 0 : 1;
  } else if (command === 'smoke')
    await smoke(root, { memory: values.memory, keep: values.keep, restore: values.restore });
  else throw new Error('Unknown template command. Use --help.');
}

main().catch((error) => {
  // Zod's default serialized error can include input values; never print it.
  console.error(
    error instanceof Error && error.name !== 'ZodError'
      ? error.message
      : 'Invalid template configuration. See --help and docs/template/configuration.md.',
  );
  process.exitCode = 1;
});
