import { randomBytes } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

const displayName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0)!;

        return code >= 32 && code !== 127 && character !== '<' && character !== '>';
      }),
    'Use a plain-text display name without control characters.',
  );
const origin = z.string().transform((value) => {
  const url = new URL(value);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use an HTTP(S) origin without credentials, paths, query parameters, or fragments.');

  return url.origin;
});

export const templateSchema = z
  .object({
    schemaVersion: z.literal(1),
    initialized: z.boolean(),
    template: z.object({ repository: z.url(), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
    project: z
      .object({
        slug: z
          .string()
          .min(2)
          .max(48)
          .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
        name: displayName,
        organization: displayName,
        publicOrigin: origin.nullable(),
        defaultLocale: z.enum(['en', 'es']),
        googleClientId: z
          .string()
          .regex(/^[\w.-]*$/)
          .default(''),
      })
      .strict(),
    local: z
      .object({
        origin,
        postgresPort: z.number().int().min(1024).max(65535),
        redisPort: z.number().int().min(1024).max(65535),
        demo: z.boolean(),
        totp: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type TemplateConfig = z.infer<typeof templateSchema>;
export type InitOptions = {
  name: string;
  slug: string;
  organization?: string;
  localOrigin?: string;
  publicOrigin?: string;
  locale?: string;
  postgresPort?: number;
  redisPort?: number;
  googleClientId?: string;
  demo?: boolean;
  totp?: boolean;
  dryRun?: boolean;
};

export async function readTemplate(root: string): Promise<TemplateConfig> {
  return templateSchema.parse(JSON.parse(await readFile(join(root, 'template.json'), 'utf8')) as unknown);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function projectReadme(config: TemplateConfig): string {
  return `# ${config.project.name}

Application maintained by ${config.project.organization}, initialized from [Visomi Stack](${config.template.repository}) template ${config.template.version}.

## Development

\`\`\`sh
fnm install
fnm use
export NX_DAEMON=false
corepack enable
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
export NX_DAEMON=false
pnpm template:doctor
pnpm nx run server:serve
\`\`\`

Open ${config.local.origin}/ and ${config.local.origin}/app/${config.project.defaultLocale}/auth/sign-up.

Public configuration lives in \`template.json\`. Local credentials live in the ignored \`.env\` generated at initialization. Never copy local fixture settings into production.

${config.local.demo ? 'Local demo APIs are enabled on the loopback-bound development server. See the getting-started guide for reading the in-memory verification mailbox.' : 'Memory mail does not send email. Configure Mailgun to receive verification codes, or use an explicitly isolated demo configuration described in the getting-started guide.'}

## Guides

- [Getting started](docs/template/getting-started.md)
- [Configuration reference](docs/template/configuration.md)
- [Architecture and optional Themis integration](docs/template/architecture.md)
- [Updating derived projects](docs/template/maintenance.md)

The upstream MIT license and attribution are retained in \`LICENSE\`. Customize the sample landing-page content and visual assets for your product; initialization does not rewrite domain models, database history, or internal package identities.
`;
}

export async function initializeTemplate(
  root: string,
  options: InitOptions,
): Promise<{ changed: string[]; dryRun: boolean }> {
  const original = await readTemplate(root);
  const config = templateSchema.parse({
    ...original,
    initialized: true,
    project: {
      ...original.project,
      name: options.name,
      slug: options.slug,
      organization: options.organization ?? original.project.organization,
      publicOrigin: options.publicOrigin ?? original.project.publicOrigin,
      defaultLocale: options.locale ?? original.project.defaultLocale,
      googleClientId: options.googleClientId ?? original.project.googleClientId,
    },
    local: {
      ...original.local,
      origin: options.localOrigin ?? original.local.origin,
      postgresPort: options.postgresPort ?? original.local.postgresPort,
      redisPort: options.redisPort ?? original.local.redisPort,
      demo: options.demo ?? original.local.demo,
      totp: options.totp ?? original.local.totp,
    },
  });
  const local = new URL(config.local.origin);
  const gatewayPort = Number(local.port || (local.protocol === 'https:' ? 443 : 80));

  if (local.protocol !== 'http:' || local.hostname !== 'localhost' || gatewayPort < 1024)
    throw new Error(
      'The local bootstrap requires http://localhost with an unprivileged port. Configure public HTTPS separately.',
    );
  if (new Set([gatewayPort, config.local.postgresPort, config.local.redisPort]).size !== 3)
    throw new Error('Gateway, PostgreSQL, and Redis ports must be different.');
  if (config.project.publicOrigin && !config.project.publicOrigin.startsWith('https://'))
    throw new Error('The public origin must use HTTPS.');
  const paths = ['template.json', 'package.json', 'README.md', '.env'];

  for (const path of paths) {
    if ((await exists(join(root, path))) && (await lstat(join(root, path))).isSymbolicLink())
      throw new Error(`Refusing to overwrite a symlink at ${path}.`);
  }
  const envExists = await exists(join(root, '.env'));

  if (original.initialized) {
    if (JSON.stringify(config) !== JSON.stringify(original))
      throw new Error(
        'This project is already initialized with different settings. Update template.json and environment configuration explicitly.',
      );
    if (!envExists)
      throw new Error(
        'This project is initialized but .env is missing. Restore its secrets or create a new environment explicitly.',
      );

    return { changed: [], dryRun: options.dryRun ?? false };
  }
  if (envExists)
    throw new Error('An existing .env was found. Initialization will not overwrite it or rotate its secrets.');
  const readme = await readFile(join(root, 'README.md'), 'utf8');

  if (!readme.includes('<!-- visomi-template-readme -->'))
    throw new Error('README.md has already been customized. Initialization will not overwrite it.');
  const pkg: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) throw new Error('Invalid package.json.');
  if (options.dryRun) return { changed: paths, dryRun: true };
  const password = randomBytes(24).toString('base64url');
  const database = config.project.slug.replaceAll('-', '_');
  const values: Record<string, string> = {
    HOST: '127.0.0.1',
    GATEWAY_PORT: String(gatewayPort),
    PORT: String(gatewayPort),
    NG_ALLOWED_HOSTS: local.hostname,
    SITE_URL: config.local.origin,
    APP_BASE_URL: `${config.local.origin}/app`,
    WEBAUTHN_ORIGIN: config.local.origin,
    WEBAUTHN_RP_ID: local.hostname,
    SESSION_SECRET: randomBytes(48).toString('base64url'),
    COMPOSE_PROJECT_NAME: config.project.slug,
    POSTGRES_DB: database,
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: password,
    POSTGRES_PORT: String(config.local.postgresPort),
    REDIS_PORT: String(config.local.redisPort),
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${config.local.postgresPort}/${database}`,
    REDIS_URL: `redis://127.0.0.1:${config.local.redisPort}`,
    ENABLE_TEST_API: String(config.local.demo),
    GOOGLE_AUTH_CLIENT_ID: config.project.googleClientId,
    AUTH_TOTP_ENROLLMENT_ENABLED: String(config.local.totp),
    AUTH_TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    MAILGUN_FROM: `${config.project.slug} <no-reply@localhost>`,
    OPAQUE_SYNC_S3_BUCKET: `${config.project.slug}-opaque-sync`,
  };
  const sample = await readFile(join(root, '.env.example'), 'utf8');
  const seen = new Set<string>();
  const environment = sample
    .split('\n')
    .map((line) => {
      const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];

      if (!key || !(key in values)) return line;
      seen.add(key);

      return `${key}=${values[key]}`;
    })
    .join('\n');

  if (Object.keys(values).some((key) => !seen.has(key)))
    throw new Error('The local environment example is missing a managed variable.');
  const output: Record<string, string> = {
    'template.json': `${JSON.stringify(config, null, 2)}\n`,
    'package.json': `${JSON.stringify({ ...pkg, name: config.project.slug }, null, 2)}\n`,
    'README.md': projectReadme(config),
    '.env': environment,
  };
  const lock = join(root, '.template-init.lock');

  await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
  const originals = new Map<string, string>();
  const written: string[] = [];
  const suffix = randomBytes(8).toString('hex');

  try {
    for (const path of paths) {
      if (path !== '.env') originals.set(path, await readFile(join(root, path), 'utf8'));
    }
    // Claim the secret file exclusively before touching public configuration.
    await writeFile(join(root, '.env'), environment, { flag: 'wx', mode: 0o600 });
    written.push('.env');
    for (const path of paths.filter((path) => path !== '.env')) {
      const temporary = join(root, `.${path}.${suffix}.tmp`);

      await writeFile(temporary, output[path], { flag: 'wx' });
      await rename(temporary, join(root, path));
      written.push(path);
    }
  } catch (error) {
    for (const path of written.reverse()) {
      if (path === '.env') await rm(join(root, path));
      else await writeFile(join(root, path), originals.get(path)!);
    }
    throw error;
  } finally {
    await Promise.all(
      paths.filter((path) => path !== '.env').map((path) => rm(join(root, `.${path}.${suffix}.tmp`), { force: true })),
    );
    await rm(lock, { force: true });
  }

  return { changed: paths, dryRun: false };
}
