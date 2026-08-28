import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const composeFile = 'compose.local-e2e.yaml';
const projectName = process.env['COMPOSE_PROJECT_NAME'] ?? `themis-local-e2e-${process.pid}`;
const runId = process.env['PZS005_RUN_ID'] ?? `local-${Date.now()}`;
const artifactDirectory = process.env['PZS005_ARTIFACT_DIR'] ?? `docs/verification/${runId}`;
const transcriptPath = `${artifactDirectory}/lifecycle-transcript.txt`;
const scopeInventoryPath = `${artifactDirectory}/scope-inventory.json`;
const postgresPort = process.env['POSTGRES_PORT'] ?? '15432';
const minioPort = process.env['MINIO_PORT'] ?? '19000';
const bucket = process.env['OPAQUE_SYNC_S3_BUCKET'] ?? `${projectName}-opaque`;
const postgresDatabase = 'themis_api_e2e';
const postgresUser = 'themis_api_e2e';
const servicePassword = 'themis_api_e2e_password';

type Command = { executable: string; prefix: string[] };

function selectCompose(): Command {
  if (spawnSync('podman', ['--version'], { stdio: 'ignore' }).status === 0)
    return { executable: 'podman', prefix: ['compose'] };
  if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0)
    return { executable: 'docker', prefix: ['compose'] };
  throw new Error('Local API E2E requires podman or docker.');
}

function run(command: Command, args: string[], environment: NodeJS.ProcessEnv = process.env): void {
  const renderedCommand = `${command.executable} ${[...command.prefix, ...args].join(' ')}`;

  record(`$ ${renderedCommand}`);
  const result = spawnSync(command.executable, [...command.prefix, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: environment,
  });

  if (result.stdout.trim()) record(`stdout=${result.stdout.trim()}`);
  if (result.stderr.trim()) record(`stderr=${result.stderr.trim()}`);
  if (result.status !== 0) {
    record(`result=${result.status ?? 'unknown'} ${renderedCommand}`);
    throw new Error(
      `${command.executable} ${[...command.prefix, ...args].join(' ')} failed (${result.status ?? 'unknown'}).`,
    );
  }
  record(`result=0 ${renderedCommand}`);
}

function compose(command: Command, args: string[], environment: NodeJS.ProcessEnv): void {
  run(command, ['--project-name', projectName, '--file', composeFile, ...args], environment);
}

function composeOutput(command: Command, args: string[], environment: NodeJS.ProcessEnv): string {
  const result = spawnSync(
    command.executable,
    [...command.prefix, '--project-name', projectName, '--file', composeFile, ...args],
    {
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  return result.status === 0 ? result.stdout.trim() : '';
}

function record(line: string): void {
  appendFileSync(transcriptPath, `${line}\n`);
}

function sanitizedDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);

    parsed.password = parsed.password ? '[REDACTED]' : '';

    return parsed.toString();
  } catch {
    return '[INVALID_DATABASE_URL]';
  }
}

function writeScopeInventory(provider: string): void {
  writeFileSync(
    scopeInventoryPath,
    `${JSON.stringify(
      {
        runId,
        projectName,
        composeFile,
        provider,
        services: ['postgres', 'redis', 'minio', 'minio-init'],
        ports: { postgres: postgresPort, minio: minioPort },
        database: postgresDatabase,
        bucket,
        artifacts: ['lifecycle-transcript.txt', 'scope-inventory.json', 'server.log'],
        cleanup: 'compose down --volumes --remove-orphans',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function inspect(command: Command, args: string[], environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(command.executable, [...command.prefix, ...args], {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const renderedCommand = `${command.executable} ${[...command.prefix, ...args].join(' ')}`;

  record(`inspection-command=${renderedCommand}`);
  record(`inspection-result=${result.status ?? 'unknown'} ${renderedCommand}`);
  if (result.stdout.trim()) record(`inspection-stdout=${result.stdout.trim()}`);
  if (result.stderr.trim()) record(`inspection-stderr=${result.stderr.trim()}`);
}

function inspectCompose(command: Command, args: string[], environment: NodeJS.ProcessEnv): void {
  inspect(command, ['--project-name', projectName, '--file', composeFile, ...args], environment);
}

function check(command: Command, args: string[], environment: NodeJS.ProcessEnv, label: string): boolean {
  const result = spawnSync(command.executable, [...command.prefix, ...args], {
    env: environment,
    stdio: 'ignore',
  });
  const renderedCommand = `${command.executable} ${[...command.prefix, ...args].join(' ')}`;

  record(`healthcheck=${label} command=${renderedCommand} result=${result.status ?? 'unknown'}`);

  return result.status === 0;
}

async function waitForService(
  command: Command,
  service: string,
  check: (containerId: string) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const containerId =
      command.executable === 'podman'
        ? spawnSync('podman', ['ps', '-q', '--filter', `name=${projectName}_${service}_1`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).stdout.trim()
        : composeOutput(command, ['ps', '-q', service], process.env);

    if (containerId && check(containerId)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${service} health.`);
}

async function main(): Promise<void> {
  const command = selectCompose();
  const environment = {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    OPAQUE_SYNC_S3_BUCKET: bucket,
    POSTGRES_DB: postgresDatabase,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: servicePassword,
    MINIO_ROOT_USER: postgresUser,
    MINIO_ROOT_PASSWORD: servicePassword,
    POSTGRES_PORT: postgresPort,
    MINIO_PORT: minioPort,
    PZS005_RUN_ID: runId,
    PZS005_ARTIFACT_DIR: artifactDirectory,
    PZS005_SERVER_LOG: `${artifactDirectory}/server.log`,
  };

  await mkdir(artifactDirectory, { recursive: true });
  writeFileSync(transcriptPath, '', 'utf8');
  writeScopeInventory(command.executable);
  record(`runId=${runId}`);
  record(`project=${projectName}`);
  record(`provider=${command.executable}`);

  try {
    compose(command, ['up', '--detach', 'postgres', 'redis', 'minio', 'minio-init'], environment);
    record('compose-up=completed');
    if (process.env['LOCAL_E2E_FAIL_AFTER_START'] === 'true') throw new Error('intentional startup failure');
    await waitForService(command, 'postgres', (containerId) =>
      check(
        { executable: command.executable, prefix: [] },
        ['exec', containerId, 'pg_isready', '-U', 'themis_api_e2e', '-d', 'themis_api_e2e'],
        environment,
        'postgres',
      ),
    );
    record('postgres-readiness=passed');
    await waitForService(command, 'redis', (containerId) =>
      check(
        { executable: command.executable, prefix: [] },
        ['exec', containerId, 'redis-cli', 'ping'],
        environment,
        'redis',
      ),
    );
    record('redis-readiness=passed');
    inspectCompose(command, ['ps'], environment);
    const minioContainerId =
      command.executable === 'podman'
        ? spawnSync('podman', ['ps', '-q', '--filter', `name=${projectName}_minio_1`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).stdout.trim()
        : composeOutput(command, ['ps', '-q', 'minio'], environment);

    if (!minioContainerId) {
      record('healthcheck=minio-image-healthcheck-availability command=container-id result=missing');
      throw new Error('Unable to inspect the MinIO container healthcheck command.');
    }
    if (
      !check(
        { executable: command.executable, prefix: [] },
        [
          'exec',
          minioContainerId,
          'sh',
          '-c',
          'command -v curl && curl --fail --silent http://127.0.0.1:9000/minio/health/ready',
        ],
        environment,
        'minio-image-healthcheck-availability',
      )
    )
      throw new Error('MinIO image healthcheck command is unavailable or not ready.');
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${minioPort}/minio/health/ready`);

        record(
          `healthcheck=minio-http command=GET http://127.0.0.1:${minioPort}/minio/health/ready result=${response.status}`,
        );
        if (response.ok) break;
      } catch {
        record(
          `healthcheck=minio-http command=GET http://127.0.0.1:${minioPort}/minio/health/ready result=unavailable`,
        );
        // The service can accept connections before its readiness endpoint is available.
      }
      if (attempt === 59) throw new Error('Timed out waiting for minio health.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    record('minio-readiness=passed');
    compose(command, ['run', '--rm', 'minio-init'], environment);
    const durableEnvironment = {
      ...environment,
      DATABASE_URL: `postgresql://${postgresUser}:${servicePassword}@127.0.0.1:${postgresPort}/${postgresDatabase}`,
      DATABASE_DRIVER: 'pg',
      DATABASE_AUTO_MIGRATE: 'false',
      OPAQUE_SYNC_STORAGE: 'durable',
      API_E2E_EXTERNAL_SERVICES: 'true',
      PZS005_REAL: 'true',
      OPAQUE_SYNC_S3_ENDPOINT: `http://127.0.0.1:${minioPort}`,
      OPAQUE_SYNC_S3_ACCESS_KEY: postgresUser,
      OPAQUE_SYNC_S3_SECRET_KEY: servicePassword,
    };

    if (durableEnvironment.DATABASE_DRIVER === 'memory' || durableEnvironment.OPAQUE_SYNC_STORAGE === 'memory') {
      throw new Error('PZS-005 durable harness refuses memory database or object storage configuration.');
    }
    record(
      `migration-config=DATABASE_URL:${sanitizedDatabaseUrl(durableEnvironment.DATABASE_URL)} schema:./libs/shared/src/lib/db/schema.ts out:./drizzle driver:postgresql`,
    );
    try {
      run(
        { executable: 'pnpm', prefix: [] },
        ['exec', 'drizzle-kit', 'migrate', '--config=drizzle.config.ts'],
        durableEnvironment,
      );
    } catch (error: unknown) {
      record(
        `migration-diagnostic=DATABASE_URL:${sanitizedDatabaseUrl(durableEnvironment.DATABASE_URL)} config:drizzle.config.ts result=failed`,
      );
      throw new Error(
        `Database migration failed for the isolated PostgreSQL target (${sanitizedDatabaseUrl(durableEnvironment.DATABASE_URL)}). Verify PostgreSQL readiness and drizzle.config.ts; original: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    run({ executable: 'pnpm', prefix: [] }, ['nx', 'run', 'api-e2e:e2e', '--skip-nx-cache'], durableEnvironment);
    record('migrations=passed');
    record('nx-api-e2e=passed');
  } catch (error: unknown) {
    record(`original-failure=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    try {
      compose(command, ['down', '--volumes', '--remove-orphans'], environment);
      record('compose-down=completed');
    } catch (error: unknown) {
      console.error(`Local E2E cleanup failed: ${error instanceof Error ? error.message : error}`);
      record(`compose-down=failed ${String(error)}`);
    }
    try {
      inspectCompose(command, ['ps'], environment);
      const volumeFilter =
        command.executable === 'podman'
          ? `label=io.podman.compose.project=${projectName}`
          : `label=com.docker.compose.project=${projectName}`;

      inspect({ executable: command.executable, prefix: [] }, ['volume', 'ls', '--filter', volumeFilter], environment);
    } catch (error: unknown) {
      record(`post-cleanup-inspection=failed ${String(error)}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
