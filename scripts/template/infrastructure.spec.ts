import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { parse } from 'yaml';

test('durable API fixtures use Docker when both engines exist and fall back to Podman otherwise', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visomi-container-engine-'));
  const runner = resolve('apps/web/api-e2e/src/support/run-api-e2e.ts');

  try {
    for (const engines of [['docker', 'podman'], ['podman']]) {
      for (const engine of ['docker', 'podman']) {
        const executable = join(directory, engine);

        await rm(executable, { force: true });
        if (!engines.includes(engine)) continue;
        // Fail before any real service starts; stderr identifies the selected engine and image.
        await writeFile(executable, '#!/bin/sh\nexit 1\n');
        await chmod(executable, 0o755);
      }
      const result = spawnSync(process.execPath, ['--experimental-strip-types', runner], {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: directory,
          API_E2E_DURABLE_ONLY: 'true',
          API_E2E_EXTERNAL_SERVICES: 'false',
        },
      });

      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`${engines[0]} run .*docker.io/library/postgres:16-alpine failed`));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('non-bundled runtimes package the push translation resource beside its compiled importer', async () => {
  for (const path of ['apps/worker/project.json', 'apps/web/realtime/project.json']) {
    const project = JSON.parse(await readFile(path, 'utf8')) as {
      targets: {
        build: { options: { bundle: boolean; assets: (string | { input: string; glob: string; output: string })[] } };
      };
    };

    assert.equal(project.targets.build.options.bundle, false);
    assert.ok(
      project.targets.build.options.assets.some(
        (asset) =>
          typeof asset !== 'string' &&
          asset.input === 'libs/backend/shared/src/lib/notifications' &&
          asset.glob === 'push-copy.json' &&
          asset.output === 'libs/backend/shared/src/lib/notifications',
      ),
    );
  }
});

test('the durable API matrix builds and selects checksum-pinned object storage without product infrastructure', async () => {
  const dockerfile = await readFile('scripts/minio-fixture.dockerfile', 'utf8');
  const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as {
    jobs: Record<string, { env?: Record<string, string>; steps: { name?: string; if?: string; run?: string }[] }>;
  };
  const job = workflow.jobs['critical-e2e'];
  const project = JSON.parse(await readFile('scripts/template/project.json', 'utf8')) as {
    targets: Record<string, { options: { command: string } }>;
  };
  const image = job.env?.['API_E2E_MINIO_IMAGE'];
  const build = job.steps.find((step) => step.name === 'Build pinned object-storage fixture');
  const run = job.steps.find((step) => step.name === 'Run full browser and durable API matrix');

  assert.equal(image, 'visomi-minio-e2e:07c3a429');
  assert.ok(build?.run?.includes('export NX_DAEMON=false'));
  assert.ok(build?.run?.includes('pnpm nx run template:minio-fixture'));
  assert.ok(project.targets['minio-fixture'].options.command.includes(`--tag ${image}`));
  // Both affected PR checks and the full scheduled matrix need the pinned image.
  assert.equal(build?.if, undefined);
  assert.ok(run?.if?.includes('schedule'));
  assert.ok(job.steps.indexOf(build!) < job.steps.indexOf(run!));
  const affected = job.steps.find((step) => step.name === 'Run affected E2E projects and related browser specs');

  assert.ok(affected?.run?.includes('affected.ts range'));
  assert.ok(job.steps.indexOf(build!) < job.steps.indexOf(affected!));
  assert.match(dockerfile, /codeload\.github\.com\/minio\/minio\/tar\.gz\/07c3a429bfed433e49018cb0f78a52145d4bedeb/);
  assert.match(dockerfile, /8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2/);
  assert.match(dockerfile, /sha256sum -c -/);
  assert.match(dockerfile, /MINIO_UPDATE=off/);
  assert.equal(dockerfile.includes(':latest'), false);
  assert.equal(image?.includes('nive'), false);
});

test('local compose isolates fixture ports on loopback and allows the pinned object-storage image', async () => {
  const content = await readFile('compose.local-e2e.yaml', 'utf8');
  const configuration = parse(content) as {
    name: string;
    services: Record<string, { ports?: string[]; image: string }>;
  };

  assert.ok(configuration.name.includes('COMPOSE_PROJECT_NAME'));
  for (const service of ['postgres', 'redis', 'minio']) {
    assert.ok(configuration.services[service].ports?.every((port) => port.startsWith('127.0.0.1:')));
  }
  assert.ok(configuration.services['minio'].image.includes('API_E2E_MINIO_IMAGE'));
  for (const name of ['POSTGRES_PORT', 'REDIS_PORT', 'MINIO_PORT', 'MINIO_CONSOLE_PORT']) {
    assert.ok(content.includes(`\${${name}:-`));
  }
});
