import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { parse } from 'dotenv';
import { parse as parseYaml } from 'yaml';

import { initializeTemplate, readTemplate } from './template-config.ts';
import { isPrivateEnvironmentFile } from './smoke.ts';

const root = process.cwd();
const cli = resolve(root, 'dist/template/main.cjs');
const settings = { name: 'Acme App', slug: 'acme-app', organization: 'Acme', demo: true };

test('clean-copy filtering excludes private environments without dropping schema source or examples', () => {
  for (const file of ['.env', '.env.local', 'deploy/production.env', 'secrets/service.env.production'])
    assert.equal(isPrivateEnvironmentFile(file), true);
  for (const file of [
    '.env.example',
    'deploy/production.env.example',
    'libs/backend/shared/src/lib/env.ts',
    'scripts/template/doctor.ts',
  ])
    assert.equal(isPrivateEnvironmentFile(file), false);
});

async function fixture(): Promise<string> {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const directory = await mkdtemp(join(root, 'tmp/template-test-'));
  const config = await readTemplate(root);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;

  await writeFile(join(directory, 'template.json'), JSON.stringify({ ...config, initialized: false }));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ ...pkg, description: 'Preserve this field' }));
  await writeFile(join(directory, 'README.md'), '<!-- visomi-template-readme -->\n# Template\n');
  await copyFile(join(root, '.env.example'), join(directory, '.env.example'));
  await copyFile(join(root, '.node-version'), join(directory, '.node-version'));

  return directory;
}

test('dry run does not create secrets or change files', async () => {
  const directory = await fixture();

  try {
    const before = await readFile(join(directory, 'template.json'), 'utf8');
    const result = await initializeTemplate(directory, { ...settings, dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.changed.length, 4);
    assert.equal(await readFile(join(directory, 'template.json'), 'utf8'), before);
    await assert.rejects(lstat(join(directory, '.env')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('initialization preserves contracts and is idempotent without secret rotation', async () => {
  const directory = await fixture();

  try {
    await initializeTemplate(directory, settings);
    const first = await readFile(join(directory, '.env'), 'utf8');
    const env = parse(first);
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>;

    assert.equal((await readTemplate(directory)).project.name, 'Acme App');
    assert.equal(pkg['name'], 'acme-app');
    assert.equal(pkg['description'], 'Preserve this field');
    assert.equal(env['POSTGRES_DB'], 'acme_app');
    assert.equal(env['WEBAUTHN_ORIGIN'], 'http://localhost:8080');
    assert.equal(env['WEBAUTHN_RP_ID'], 'localhost');
    assert.equal(env['ENABLE_TEST_API'], 'true');
    assert.ok(env['SESSION_SECRET'].length >= 32);
    assert.ok(env['AUTH_TOTP_ENCRYPTION_KEY'].length >= 32);
    assert.notEqual(env['SESSION_SECRET'], env['AUTH_TOTP_ENCRYPTION_KEY']);
    assert.equal((await lstat(join(directory, '.env'))).mode & 0o777, 0o600);
    assert.deepEqual((await initializeTemplate(directory, settings)).changed, []);
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), first);
    await assert.rejects(initializeTemplate(directory, { ...settings, slug: 'another-app' }), /already initialized/);
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('protects existing environment files and custom documentation', async () => {
  const directory = await fixture();

  try {
    await writeFile(join(directory, '.env'), 'SESSION_SECRET=existing-private-value');
    await assert.rejects(initializeTemplate(directory, settings), /existing .env/);
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), 'SESSION_SECRET=existing-private-value');
    assert.equal((await readTemplate(directory)).initialized, false);
    await rm(join(directory, '.env'));
    await writeFile(join(directory, 'README.md'), '# Existing application');
    await assert.rejects(initializeTemplate(directory, settings), /customized/);
    assert.equal(await readFile(join(directory, 'README.md'), 'utf8'), '# Existing application');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects symlink targets, unsafe origins, traversal slugs, and port collisions', async () => {
  const directory = await fixture();

  try {
    await writeFile(join(directory, 'private.txt'), 'keep-me');
    await symlink(join(directory, 'private.txt'), join(directory, '.env'));
    await assert.rejects(initializeTemplate(directory, settings), /symlink/);
    assert.equal(await readFile(join(directory, 'private.txt'), 'utf8'), 'keep-me');
    await rm(join(directory, '.env'));
    for (const overrides of [
      { slug: '../escape' },
      { localOrigin: 'http://remote.example:8080' },
      { publicOrigin: 'http://app.example' },
      { localOrigin: 'http://user:secret@localhost:8080' },
      { redisPort: 5432 },
      { locale: 'unsupported' },
    ])
      await assert.rejects(initializeTemplate(directory, { ...settings, ...overrides }));
    assert.equal((await readTemplate(directory)).initialized, false);
    await assert.rejects(lstat(join(directory, '.env')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor supports offline JSON without exposing configuration values', async () => {
  const directory = await fixture();

  try {
    await initializeTemplate(directory, settings);
    const env = parse(await readFile(join(directory, '.env'), 'utf8'));
    const result = spawnSync(process.execPath, [cli, 'doctor', '--offline', '--json'], {
      cwd: directory,
      env: { ...process.env, NODE_ENV: 'development' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    const report = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ id: string; status: string }> };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.ok, true);
    assert.ok(report.checks.some((check) => check.id === 'connectivity' && check.status === 'warn'));
    for (const key of ['SESSION_SECRET', 'POSTGRES_PASSWORD', 'AUTH_TOTP_ENCRYPTION_KEY'])
      assert.ok(!result.stdout.includes(env[key]));
    await writeFile(join(directory, '.env'), 'NODE_ENV=production\nSESSION_SECRET=DO_NOT_LEAK_THIS_VALUE\n');
    const invalid = spawnSync(process.execPath, [cli, 'doctor', '--offline', '--json', '--production'], {
      cwd: directory,
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 15_000,
    });

    assert.equal(invalid.status, 1);
    assert.ok(!`${invalid.stdout}${invalid.stderr}`.includes('DO_NOT_LEAK_THIS_VALUE'));
    assert.ok(invalid.stdout.includes('SESSION_SECRET'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('toolchain pins agree across the manifest, Node version file, CI, and Docker', async () => {
  const version = (await readFile(join(root, '.node-version'), 'utf8')).trim();
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    packageManager: string;
    engines: { pnpm: string };
  };
  const docker = await readFile(join(root, 'Dockerfile'), 'utf8');
  const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');

  assert.ok(docker.includes(`FROM node:${version}-bookworm-slim`));
  assert.ok(docker.includes(`corepack prepare ${pkg.packageManager} --activate`));
  assert.equal(pkg.packageManager, `pnpm@${pkg.engines.pnpm}`);
  assert.ok(ci.includes('node-version-file: .node-version'));
  assert.ok(!ci.includes('version: 10'));
  for (const workspace of [
    'libs/backend/shared',
    'libs/shared/crypto',
    'libs/projects',
    'libs/themis-workflow',
    'apps/cli',
  ])
    assert.ok(docker.includes(`COPY ${workspace}/package.json`));
});

test('rejects command-specific options instead of silently ignoring deployment intent', async () => {
  const directory = await fixture();

  try {
    const result = spawnSync(process.execPath, [cli, 'init', '--name', 'Acme', '--slug', 'acme', '--production'], {
      cwd: directory,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not supported by init/);
    assert.equal((await readTemplate(directory)).initialized, false);
    await assert.rejects(lstat(join(directory, '.env')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CI defines real PostgreSQL clean-copy verification and critical auth journeys', async () => {
  const workflow = parseYaml(await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')) as {
    on: Record<string, unknown>;
    jobs: Record<string, { services?: Record<string, { image: string }>; steps: Array<{ run?: string; if?: string }> }>;
  };

  assert.ok('pull_request' in workflow.on);
  assert.ok('schedule' in workflow.on);
  assert.ok(workflow.jobs['template-smoke'].services?.['postgres'].image.startsWith('postgres:16'));
  assert.ok(workflow.jobs['template-smoke'].steps.some((step) => step.run?.includes('pnpm template:smoke')));
  for (const scenario of ['signup-validation', 'verification-feedback', 'device-approval'])
    assert.ok(workflow.jobs['critical-e2e'].steps.some((step) => step.run?.includes(`${scenario}.spec.ts`)));
  assert.ok(
    workflow.jobs['critical-e2e'].steps.some(
      (step) => step.if?.includes('schedule') && step.run?.includes('api-e2e:e2e'),
    ),
  );
});
