import { createHash, createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';

const databaseUrl = process.env['DATABASE_URL'];
const objectStoreEndpoint = process.env['OPAQUE_SYNC_S3_ENDPOINT'];
const runtimeContainers: string[] = [];
const runtimePrefix = `themis-api-e2e-${process.pid}`;
let postgresPort = process.env['API_E2E_POSTGRES_PORT'] ?? '15432';
let minioPort = process.env['API_E2E_MINIO_PORT'] ?? '19000';
const postgresDatabase = 'themis_api_e2e';
const postgresUser = 'themis_api_e2e';
const postgresPassword = 'themis_api_e2e_password';
const minioAccessKey = 'themis_api_e2e';
const minioSecretKey = 'themis_api_e2e_password';
const runtimeBucket = `${runtimePrefix}-opaque`;
let selectedCli: string | undefined;

function runtimeCli(): string {
  for (const candidate of ['podman', 'docker']) {
    if (spawnSync('command', ['-v', candidate], { shell: true, stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('API E2E durable prerequisites require podman or docker, or explicit CI storage overrides.');
}

function run(cli: string, args: string[], environment?: NodeJS.ProcessEnv): void {
  const result = spawnSync(cli, args, { stdio: 'inherit', env: environment });

  if (result.status !== 0)
    throw new Error(`${cli} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
}

async function waitFor(check: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function choosePort(configuredPort: string): Promise<string> {
  if (await portIsAvailable(Number(configuredPort))) return configuredPort;

  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      server.close(() => resolve(typeof address === 'object' && address ? String(address.port) : configuredPort));
    });
  });
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

async function ensureBucket(endpoint: string): Promise<void> {
  const url = new URL(`${endpoint.replace(/\/$/, '')}/${runtimeBucket}`);
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const date = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update('').digest('hex');
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name as keyof typeof headers]}\n`)
    .join('');
  const canonicalRequest = ['PUT', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/us-east-1/s3/aws4_request`;
  const dateKey = hmac(`AWS4${minioSecretKey}`, date);
  const regionKey = hmac(dateKey, 'us-east-1');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${minioAccessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${createHmac('sha256', signingKey).update(stringToSign).digest('hex')}`,
    },
  });

  if (!response.ok && response.status !== 409)
    throw new Error(`Isolated MinIO bucket setup failed (${response.status}).`);
}

function runJest(
  environment: NodeJS.ProcessEnv,
  args: string[],
  config = 'apps/web/api-e2e/jest.config.cts',
): Promise<number> {
  const child = spawn(process.execPath, ['node_modules/jest/bin/jest.js', '--config', config, '--runInBand', ...args], {
    stdio: 'inherit',
    env: environment,
  });

  return new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? 1)));
}

function provisionPostgres(cli: string): string {
  const name = `${runtimePrefix}-postgres`;

  run(cli, [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    `${postgresPort}:5432`,
    '--env',
    `POSTGRES_DB=${postgresDatabase}`,
    '--env',
    `POSTGRES_USER=${postgresUser}`,
    '--env',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    'docker.io/library/postgres:16-alpine',
  ]);

  runtimeContainers.push(name);

  return `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}`;
}

function provisionMinio(cli: string): string {
  const name = `${runtimePrefix}-minio`;

  run(cli, [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    `${minioPort}:9000`,
    '--env',
    `MINIO_ROOT_USER=${minioAccessKey}`,
    '--env',
    `MINIO_ROOT_PASSWORD=${minioSecretKey}`,
    'docker.io/minio/minio:latest',
    'server',
    '/data',
    '--address',
    ':9000',
  ]);

  runtimeContainers.push(name);

  return `http://127.0.0.1:${minioPort}`;
}

async function main(): Promise<void> {
  const requestedArgs = process.argv.slice(2);
  const durableOnly = process.env['API_E2E_DURABLE_ONLY'] === 'true';
  const pzs005Real = process.env['PZS005_REAL'] === 'true';
  const fullRun = requestedArgs.length === 0 && !durableOnly && !pzs005Real;
  const requestedRestart = requestedArgs.some((argument) => argument.includes('sync-restart.spec.ts'));
  const needsDurableRun = fullRun || requestedRestart || durableOnly || pzs005Real;
  const externalServices = process.env['API_E2E_EXTERNAL_SERVICES'] === 'true';
  const needsPostgres = !databaseUrl || pzs005Real;
  const needsMinio = !objectStoreEndpoint || pzs005Real;

  selectedCli = needsDurableRun && !externalServices && (needsPostgres || needsMinio) ? runtimeCli() : undefined;
  const cli = selectedCli;

  if (needsDurableRun && !externalServices && needsPostgres) postgresPort = await choosePort(postgresPort);
  if (needsDurableRun && !externalServices && needsMinio) minioPort = await choosePort(minioPort);

  const effectiveDatabaseUrl =
    needsDurableRun && needsPostgres && !externalServices ? provisionPostgres(cli as string) : databaseUrl;
  const effectiveEndpoint =
    needsDurableRun && needsMinio && !externalServices ? provisionMinio(cli as string) : objectStoreEndpoint;

  if (needsDurableRun && needsPostgres && !externalServices) {
    await waitFor(
      () =>
        spawnSync(
          cli as string,
          ['exec', `${runtimePrefix}-postgres`, 'pg_isready', '-U', postgresUser, '-d', postgresDatabase],
          { stdio: 'ignore' },
        ).status === 0,
      'isolated PostgreSQL',
    );
  }
  if (needsDurableRun && !externalServices) {
    await waitFor(
      () =>
        spawnSync('curl', ['--fail', '--silent', `${effectiveEndpoint}/minio/health/ready`], { stdio: 'ignore' })
          .status === 0,
      'isolated MinIO',
    );

    await ensureBucket(effectiveEndpoint as string);
  }

  const memoryEnvironment = { ...process.env, DATABASE_DRIVER: 'memory', OPAQUE_SYNC_STORAGE: 'memory' };
  const runId = process.env['PZS005_RUN_ID'] ?? `RUN-${Date.now()}-${process.pid}`;
  const artifactDirectory = process.env['PZS005_ARTIFACT_DIR'] ?? `docs/verification/pzs-005-${runId.toLowerCase()}`;

  await mkdir(artifactDirectory, { recursive: true });
  const durableEnvironment = {
    ...process.env,
    DATABASE_URL: effectiveDatabaseUrl,
    DATABASE_DRIVER: 'pg',
    OPAQUE_SYNC_STORAGE: 'durable',
    OPAQUE_SYNC_S3_ENDPOINT: effectiveEndpoint,
    OPAQUE_SYNC_S3_BUCKET: process.env['OPAQUE_SYNC_S3_BUCKET'] ?? runtimeBucket,
    OPAQUE_SYNC_S3_ACCESS_KEY: process.env['OPAQUE_SYNC_S3_ACCESS_KEY'] ?? minioAccessKey,
    OPAQUE_SYNC_S3_SECRET_KEY: process.env['OPAQUE_SYNC_S3_SECRET_KEY'] ?? minioSecretKey,
    PZS005_RUN_ID: runId,
    PZS005_ARTIFACT_DIR: artifactDirectory,
    PZS005_SERVER_LOG: process.env['PZS005_SERVER_LOG'] ?? `${artifactDirectory}/server.log`,
  };

  if ((durableOnly || pzs005Real) && process.env['API_E2E_EXTERNAL_SERVICES'] !== 'true') {
    const migrationEnvironment = {
      ...durableEnvironment,
      DATABASE_URL: effectiveDatabaseUrl,
      DATABASE_DRIVER: 'pg',
      OPAQUE_SYNC_STORAGE: 'durable',
      // Do not let a caller's unrelated database/storage configuration leak
      // into the isolated migration process.
      OPAQUE_SYNC_S3_ENDPOINT: effectiveEndpoint,
      OPAQUE_SYNC_S3_BUCKET: durableEnvironment.OPAQUE_SYNC_S3_BUCKET,
      OPAQUE_SYNC_S3_ACCESS_KEY: durableEnvironment.OPAQUE_SYNC_S3_ACCESS_KEY,
      OPAQUE_SYNC_S3_SECRET_KEY: durableEnvironment.OPAQUE_SYNC_S3_SECRET_KEY,
    };

    run('pnpm', ['db:migrate'], migrationEnvironment);
  }

  let exitCode: number;

  if (pzs005Real) {
    exitCode = await runJest(durableEnvironment, ['--runTestsByPath', 'apps/web/api-e2e/src/api/pzs-005-real.spec.ts']);
  } else if (durableOnly) {
    exitCode = await runJest(durableEnvironment, requestedArgs, 'apps/web/api-e2e/durable-jest.config.cts');
  } else if (fullRun) {
    exitCode = await runJest(memoryEnvironment, ['--testPathIgnorePatterns=sync-restart.spec.ts|durable/']);
    if (exitCode === 0)
      exitCode = await runJest(durableEnvironment, [
        '--runTestsByPath',
        'apps/web/api-e2e/src/api/sync-restart.spec.ts',
      ]);
  } else {
    exitCode = await runJest(requestedRestart ? durableEnvironment : memoryEnvironment, requestedArgs);
  }

  for (const name of runtimeContainers.reverse()) {
    spawnSync(cli as string, ['rm', '--force', name], { stdio: 'ignore' });
  }
  process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  for (const name of runtimeContainers.reverse()) {
    if (selectedCli) spawnSync(selectedCli, ['rm', '--force', name], { stdio: 'ignore' });
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
