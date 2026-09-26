import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { readTemplate } from './template-config.ts';
import { assertRestoreIsolation, restoreOwnedPostgres } from './restore.ts';
import { createProtectedTotpFixture } from './restore-crypto.ts';
import { restoreMinioImage, verifyOwnedObjectStore } from './restore-objects.ts';

const flowResponse = z.object({ data: z.object({ flowId: z.string() }) });
let activeCommand: ChildProcess | undefined;
let interrupted = false;

export function isPrivateEnvironmentFile(path: string): boolean {
  return /(^|\/)[^/]*\.env(?:\.[^/]*)?$/.test(path) && !path.endsWith('.env.example');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port allocated.')),
      );
    });
  });
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const send = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {
      child.kill(signal);
    }
  };

  send('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      send('SIGKILL');
      resolve();
    }, 10_000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: string): Promise<void> {
  if (interrupted) throw new Error('Smoke verification interrupted.');
  const output = createWriteStream(log);
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

  activeCommand = child;
  child.stdout?.pipe(output, { end: false });
  child.stderr?.pipe(output, { end: false });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void stop(child).then(() => reject(new Error(`Timed out running ${command}; inspect ${log}.`)));
      }, 300_000);

      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error(`Could not start ${command}; inspect ${log}.`));
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`${command} failed; inspect ${log}.`));
      });
    });
  } finally {
    await stop(child);
    activeCommand = undefined;
    output.end();
  }
}

export async function smoke(
  root: string,
  options: { memory?: boolean; keep?: boolean; restore?: boolean },
): Promise<string> {
  if (options.restore) assertRestoreIsolation(options, process.env);
  interrupted = false;
  await mkdir(join(root, 'tmp'), { recursive: true });
  const artifacts = await mkdtemp(join(root, 'tmp/template-smoke-'));

  await chmod(artifacts, 0o700);
  const copy = join(artifacts, 'project');
  const logs = join(artifacts, 'logs');

  await mkdir(copy);
  await mkdir(logs);
  try {
    const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (files.status !== 0) throw new Error('Clean-copy smoke requires a Git working tree.');
    for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
      if (
        /^(?:node_modules|dist|tmp|\.git|\.nx|\.angular|playwright-report)(?:\/|$)/.test(file) ||
        isPrivateEnvironmentFile(file) ||
        file === '.themis/registry.json'
      )
        continue;
      const source = join(root, file);
      let stat;

      try {
        stat = await lstat(source);
      } catch {
        continue;
      }
      if (!stat.isFile()) throw new Error(`Clean-copy export does not follow links or special files: ${file}`);
      const destination = join(copy, file);

      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    // Reinitialize only the owned disposable copy, including when the source is
    // already a derived application. Never alter its source metadata or README.
    const sourceConfig = await readTemplate(copy);

    await writeFile(
      join(copy, 'template.json'),
      `${JSON.stringify({ ...sourceConfig, initialized: false }, null, 2)}\n`,
    );
    await writeFile(join(copy, 'README.md'), '<!-- visomi-template-readme -->\n# Disposable template verification\n');
  } catch (error) {
    await rm(copy, { recursive: true, force: true });
    throw error;
  }
  const ports = new Set<number>();

  while (ports.size < (options.restore ? 4 : 3)) ports.add(await freePort());
  const [gatewayPort, postgresPort, redisPort, objectStorePort] = [...ports];
  const origin = `http://localhost:${gatewayPort}`;
  const prefix = `visomi-template-${randomBytes(6).toString('hex')}`;
  const databasePassword = randomBytes(24).toString('hex');
  const objectStoreCredentials = {
    accessKey: randomBytes(12).toString('hex'),
    secretKey: randomBytes(32).toString('hex'),
  };
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    COREPACK_HOME: process.env.COREPACK_HOME,
    PNPM_HOME: process.env.PNPM_HOME,
    NX_DAEMON: 'false',
    NX_INTERACTIVE: 'false',
    CI: 'true',
    NODE_ENV: 'development',
  };
  let engine: string | undefined;
  const containers: string[] = [];
  let redisProcess: ChildProcess | undefined;
  let gateway: ChildProcess | undefined;
  let databaseUrl = process.env.SMOKE_DATABASE_URL;
  let ownedPostgres: string | undefined;
  let restoreEvidence: ReturnType<typeof restoreOwnedPostgres> | undefined;
  let objectEvidence: Awaited<ReturnType<typeof verifyOwnedObjectStore>> | undefined;
  let redisUrl = process.env.SMOKE_REDIS_URL;
  const container = (args: string[], credentials: Record<string, string> = {}) => {
    const result = spawnSync(engine!, args, {
      env: { ...process.env, NX_DAEMON: 'false', POSTGRES_PASSWORD: databasePassword, ...credentials },
      encoding: 'utf8',
      timeout: 120_000,
    });

    if (result.status !== 0)
      throw new Error('An isolated smoke container could not be started. Check the container engine.');
  };
  const shutdown = () => {
    interrupted = true;
    void stop(activeCommand);
    void stop(gateway);
    void stop(redisProcess);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    if (options.memory) {
      if (!redisUrl) {
        redisProcess = spawn(
          'redis-server',
          ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no'],
          { detached: true, stdio: 'ignore' },
        );
        redisProcess.on('error', () => undefined);
        redisUrl = `redis://127.0.0.1:${redisPort}`;
      }
    } else if (!databaseUrl || !redisUrl) {
      engine = ['docker', 'podman'].find(
        (candidate) => spawnSync(candidate, ['info'], { stdio: 'ignore', timeout: 5000 }).status === 0,
      );
      if (!engine)
        throw new Error(
          'No working container engine. Start Docker/Podman, supply isolated SMOKE_DATABASE_URL and SMOKE_REDIS_URL, or use --memory with redis-server.',
        );
      if (!databaseUrl) {
        const name = `${prefix}-postgres`;

        container([
          'run',
          options.restore ? '--pull=never' : '--pull=missing',
          '--detach',
          '--rm',
          '--name',
          name,
          '--publish',
          `127.0.0.1:${postgresPort}:5432`,
          '--env',
          'POSTGRES_DB=template_smoke',
          '--env',
          'POSTGRES_USER=postgres',
          '--env',
          'POSTGRES_PASSWORD',
          'docker.io/library/postgres:16-alpine',
        ]);
        containers.push(name);
        ownedPostgres = name;
        databaseUrl = `postgresql://postgres:${databasePassword}@127.0.0.1:${postgresPort}/template_smoke`;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (
            spawnSync(engine, ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore', timeout: 3000 })
              .status === 0
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!redisUrl) {
        const name = `${prefix}-redis`;

        container([
          'run',
          options.restore ? '--pull=never' : '--pull=missing',
          '--detach',
          '--rm',
          '--name',
          name,
          '--publish',
          `127.0.0.1:${redisPort}:6379`,
          'docker.io/library/redis:7-alpine',
        ]);
        containers.push(name);
        redisUrl = `redis://127.0.0.1:${redisPort}`;
      }
    }
    if (options.restore) {
      if (!engine || !objectStorePort) throw new Error('Task-owned object-store infrastructure is missing.');
      const name = `${prefix}-minio`;

      containers.push(name);
      container(
        [
          'run',
          '--pull=never',
          '--detach',
          '--rm',
          '--name',
          name,
          '--publish',
          `127.0.0.1:${objectStorePort}:9000`,
          '--env',
          'MINIO_ROOT_USER',
          '--env',
          'MINIO_ROOT_PASSWORD',
          restoreMinioImage,
          'server',
          '/data',
          '--console-address',
          ':9001',
        ],
        { MINIO_ROOT_USER: objectStoreCredentials.accessKey, MINIO_ROOT_PASSWORD: objectStoreCredentials.secretKey },
      );
    }
    console.log('Smoke: installing into a clean copy (no node_modules, build output, cache, or local secrets copied).');
    const installArgs = ['install', '--frozen-lockfile', ...(options.restore ? ['--offline'] : [])];

    await run('git', ['init', '--quiet'], copy, env, join(logs, 'git.log'));
    await run('pnpm', installArgs, copy, env, join(logs, 'install.log'));
    await run(
      'pnpm',
      [
        'template:init',
        '--name',
        'Smoke App',
        '--slug',
        'smoke-app',
        '--organization',
        'Smoke Organization',
        '--locale',
        'es',
        '--local-origin',
        origin,
        '--postgres-port',
        String(postgresPort),
        '--redis-port',
        String(redisPort),
        '--demo',
      ],
      copy,
      env,
      join(logs, 'init.log'),
    );
    const initializedEnv = await readFile(join(copy, '.env'), 'utf8');

    await run(
      'pnpm',
      [
        'template:init',
        '--name',
        'Smoke App',
        '--slug',
        'smoke-app',
        '--organization',
        'Smoke Organization',
        '--locale',
        'es',
        '--local-origin',
        origin,
        '--postgres-port',
        String(postgresPort),
        '--redis-port',
        String(redisPort),
        '--demo',
      ],
      copy,
      env,
      join(logs, 'idempotence.log'),
    );
    if (initializedEnv !== (await readFile(join(copy, '.env'), 'utf8')))
      throw new Error('Repeated initialization changed secrets.');
    await run('pnpm', installArgs, copy, env, join(logs, 'frozen-after-init.log'));
    const runtimeEnv = {
      ...env,
      DATABASE_DRIVER: options.memory ? 'memory' : 'pg',
      DATABASE_AUTO_MIGRATE: options.memory ? 'true' : 'false',
      ...(databaseUrl ? { DATABASE_URL: databaseUrl, DRIZZLE_DATABASE_URL: databaseUrl } : {}),
      REDIS_URL: redisUrl,
      HOST: '127.0.0.1',
      PORT: String(gatewayPort),
      GATEWAY_PORT: String(gatewayPort),
      ENABLE_TEST_API: 'true',
      OPAQUE_SYNC_STORAGE: 'memory',
      COOKIE_SECURE: 'false',
    };

    if (!options.memory) await run('pnpm', ['db:migrate'], copy, runtimeEnv, join(logs, 'migrate.log'));
    await run('pnpm', ['template:doctor', '--json'], copy, runtimeEnv, join(logs, 'doctor-before.log'));
    console.log('Smoke: building the renamed composed runtime.');
    await run('pnpm', ['exec', 'nx', 'run', 'server:build:production'], copy, env, join(logs, 'build.log'));
    const startGateway = async () => {
      const serverLog = createWriteStream(join(logs, 'gateway.log'), { flags: 'a', mode: 0o600 });

      gateway = spawn(process.execPath, ['dist/apps/web/server/main.js'], {
        cwd: copy,
        env: runtimeEnv,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      gateway.on('error', () => undefined);
      gateway.stdout?.pipe(serverLog, { end: false });
      gateway.stderr?.pipe(serverLog, { end: false });
      gateway.once('exit', () => serverLog.end());
      let ready = false;

      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (gateway.exitCode !== null || gateway.signalCode) break;
        try {
          ready = (await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(1000) })).ok;
        } catch {
          /* Bootstrap is still pending. */
        }
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!ready) throw new Error(`Fresh-copy gateway did not become ready; inspect ${join(logs, 'gateway.log')}.`);
    };

    await startGateway();
    const home = await fetch(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });

    if (home.status !== 302 || home.headers.get('location') !== '/es/')
      throw new Error('Configured default locale was not applied to the public entry.');
    for (const path of ['/es/', '/app/es/auth/sign-in']) {
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15_000) });

      if (!response.ok || !(await response.text()).includes('Smoke App'))
        throw new Error(`Renamed public branding was not rendered at ${path}.`);
    }
    const jar = new Map<string, string>();
    const request = async (path: string, body?: Record<string, string>) => {
      const response = await fetch(`${origin}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });

      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0];
        const delimiter = pair.indexOf('=');

        jar.set(pair.slice(0, delimiter), pair.slice(delimiter + 1));
      }
      if (!response.ok) throw new Error('Fresh-copy authentication HTTP scenario failed; inspect the runtime log.');

      return response.json() as Promise<unknown>;
    };
    const email = `${prefix}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const signup = z
      .object({ data: z.object({ flowId: z.string(), resendAvailableAt: z.iso.datetime() }) })
      .parse(await request('/api/auth/password/sign-up', { email, password }));
    const signupCode = z
      .object({ pin: z.string() })
      .parse(await request(`/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=password_signup`));

    await request('/api/auth/password/sign-up/verify', { flowId: signup.data.flowId, code: signupCode.pin });
    if (options.restore) {
      await stop(gateway);
      if (!engine || !ownedPostgres || !databaseUrl) throw new Error('Task-owned restore infrastructure is missing.');
      const totpFixture = createProtectedTotpFixture(artifacts);

      try {
        restoreEvidence = restoreOwnedPostgres(engine, ownedPostgres, undefined, totpFixture);
      } finally {
        totpFixture.cleanup();
      }
      if (!restoreEvidence.totpKeyContinuity || !objectStorePort)
        throw new Error('Required restore fixture evidence is missing.');
      objectEvidence = await verifyOwnedObjectStore(
        objectStorePort,
        objectStoreCredentials.accessKey,
        objectStoreCredentials.secretKey,
        artifacts,
      );
      const destination = new URL(databaseUrl);

      destination.pathname = '/template_restore';
      runtimeEnv.DATABASE_URL = destination.toString();
      runtimeEnv.DRIZZLE_DATABASE_URL = destination.toString();
      // Re-running migrations verifies the restored migration ledger is usable.
      await run('pnpm', ['db:migrate'], copy, runtimeEnv, join(logs, 'restore-migrate.log'));
      jar.clear();
      await startGateway();
    }
    // Signup and sign-in share the destination cooldown; honor the server's deadline.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Date.parse(signup.data.resendAvailableAt) - Date.now())),
    );
    const signin = flowResponse.parse(await request('/api/auth/password/sign-in', { email, password }));
    const signinCode = z
      .object({ pin: z.string() })
      .parse(await request(`/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=password_second_step`));

    await request('/api/auth/password/verify', { flowId: signin.data.flowId, code: signinCode.pin, kind: 'email' });
    z.object({ data: z.object({ authenticated: z.literal(true), kind: z.literal('full') }) }).parse(
      await request('/api/auth/session'),
    );
    await run('pnpm', ['template:doctor', '--running', '--json'], copy, runtimeEnv, join(logs, 'doctor-running.log'));
    await writeFile(
      join(artifacts, 'result.json'),
      `${JSON.stringify({ passed: true, database: options.memory ? 'memory' : 'postgresql', freshInstall: true, frozenAfterInit: true, idempotent: true, renamedBrand: true, defaultLocale: 'es', signupAndSignIn: true, ...(restoreEvidence ? { restore: { scope: 'database-and-synthetic-recovery-fixtures', schemaAndData: { schema: restoreEvidence.schema, data: restoreEvidence.data }, migrations: true, passwordAuthenticationContinuity: true, objectCanary: objectEvidence, serverTotpKeyContinuity: restoreEvidence.totpKeyContinuity, fullProductVaultRecovery: false, productionKeyEscrowRecovery: false } } : {}) }, null, 2)}\n`,
    );
    console.log(
      `Smoke passed (${options.memory ? 'memory database; PostgreSQL not exercised' : 'PostgreSQL'}). Evidence: ${artifacts}`,
    );

    return artifacts;
  } catch (error) {
    await writeFile(
      join(artifacts, 'result.json'),
      `${JSON.stringify({ passed: false, database: options.memory ? 'memory' : 'postgresql', message: error instanceof Error && error.name !== 'ZodError' ? error.message : 'Smoke contract validation failed.' }, null, 2)}\n`,
    );
    throw error;
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await stop(gateway);
    await stop(redisProcess);
    for (const name of containers.reverse())
      spawnSync(engine!, ['rm', '--force', name], { stdio: 'ignore', timeout: 30_000 });
    if (!options.keep) await rm(copy, { recursive: true, force: true });
  }
}
