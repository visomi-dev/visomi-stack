import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCommand } from './checks/run-command.ts';

type Invocation = { args: string[]; input: string; daemon: string };

test('command deadlines fail closed instead of allowing hung checks to block publication', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], '', 100),
    /Nx check timed out/,
  );
});

test('command failures and successful exits remain distinguishable and remove listeners', async () => {
  const sigintListeners = process.listenerCount('SIGINT');
  const sigtermListeners = process.listenerCount('SIGTERM');

  await runCommand(process.execPath, ['-e', 'process.exit(0)'], '', 5000);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(23)'], '', 5000), /Nx check exited with 23/);
  assert.equal(process.listenerCount('SIGINT'), sigintListeners);
  assert.equal(process.listenerCount('SIGTERM'), sigtermListeners);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(
    `interruption with ${signal} stops detached checks before the runner exits`,
    {
      skip: process.platform === 'win32',
      timeout: 15000,
    },
    async () => {
      const workerCode = `${signal === 'SIGTERM' ? "process.on('SIGTERM', () => {});" : ''}
      process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 1000);`;
      const runnerCode = `import { runCommand } from './scripts/template/checks/run-command.ts';
      await runCommand(process.execPath, ['-e', ${JSON.stringify(workerCode)}], '', 60000);`;
      const runner = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', runnerCode]);
      const exit = once(runner, 'exit');
      let workerPid: number | undefined;

      try {
        const [chunk] = await once(runner.stdout, 'data', { signal: AbortSignal.timeout(5000) });

        workerPid = Number(String(chunk).trim());
        assert.ok(Number.isInteger(workerPid) && workerPid > 0);
        runner.kill(signal);
        const [code] = await exit;

        assert.equal(code, signal === 'SIGINT' ? 130 : 143);
        assert.throws(() => process.kill(workerPid!, 0), { code: 'ESRCH' });
      } finally {
        runner.kill('SIGKILL');
        if (workerPid) {
          try {
            process.kill(-workerPid, 'SIGKILL');
          } catch (error: unknown) {
            assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
          }
        }
      }
    },
  );
}

test('API integration tests isolate Jest without losing config or runtime build prerequisites', () => {
  const configuration = JSON.parse(readFileSync('apps/web/api-e2e/project.json', 'utf8')) as {
    targets: { test: { executor: string; dependsOn: string[]; options: { command: string } } };
  };
  const target = configuration.targets.test;

  assert.equal(target.executor, 'nx:run-commands');
  assert.match(target.options.command, /node_modules\/jest\/bin\/jest.js/);
  assert.match(target.options.command, /--config apps\/web\/api-e2e\/jest.config.cts/);
  assert.match(target.options.command, /--runInBand/);
  assert.ok(!target.options.command.includes('--forceExit'));
  assert.deepEqual(target.dependsOn, [
    'fixture-test',
    'api:build',
    'app:build',
    'site:build',
    'worker:build',
    'realtime:build',
    'server:build',
  ]);
});

test('composed gateway project dependencies propagate runtime edits to HTTP and browser consumers', () => {
  const server = JSON.parse(readFileSync('apps/web/server/project.json', 'utf8')) as { implicitDependencies: string[] };

  assert.deepEqual(server.implicitDependencies, ['api', 'app', 'site', 'worker', 'realtime']);
  for (const project of ['app-e2e', 'api-e2e', 'server-e2e']) {
    const configuration = JSON.parse(readFileSync(`apps/web/${project}/project.json`, 'utf8')) as {
      implicitDependencies: string[];
    };

    assert.ok(configuration.implicitDependencies.includes('server'));
  }
});

function run(files: string[], affected: string[], failure = false, parameters = ['staged']) {
  const directory = mkdtempSync(join(tmpdir(), 'affected-runner-'));
  const log = join(directory, 'calls.jsonl');
  const graph = {
    graph: {
      nodes: {
        app: {
          data: {
            root: 'apps/web/app',
            targets: {
              lint: { executor: '@nx/eslint:lint' },
              'vite:test': { options: { command: 'vitest' } },
            },
          },
        },
        'app-e2e': { data: { root: 'apps/web/app-e2e', targets: { e2e: { executor: '@nx/playwright:playwright' } } } },
      },
    },
  };

  try {
    writeFileSync(
      join(directory, 'git'),
      `#!/usr/bin/env node
process.stdout.write(JSON.parse(process.env.CHANGED_FILES).join('\\0'));
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(directory, 'pnpm'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args.includes('--stdin') ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({args, input, daemon: process.env.NX_DAEMON}) + '\\n');
if (args.includes('graph')) process.stdout.write(process.env.PROJECT_GRAPH);
else if (args.includes('show')) process.stdout.write(process.env.AFFECTED_PROJECTS);
else if (process.env.FAIL_CHECK === 'true') process.exitCode = 23;
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/template/checks/affected.ts', ...parameters],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env['PATH']}`,
          NX_DAEMON: 'true',
          CHANGED_FILES: JSON.stringify(files),
          PROJECT_GRAPH: JSON.stringify(graph),
          AFFECTED_PROJECTS: JSON.stringify(affected),
          CALL_LOG: log,
          FAIL_CHECK: String(failure),
        },
      },
    );
    const calls =
      files.length && !files.some((file) => /[\n\r,]/.test(file))
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as Invocation)
        : [];

    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('empty staged changes and docs outside the graph run no project checks', () => {
  for (const files of [[], ['docs/agents/e2e.md']]) {
    const { result, calls } = run(files, []);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls.filter((call) => call.args.includes('affected')).length, 0);
  }
});

test('runner retains Nx-selected consumers and passes exact staged paths over stdin', () => {
  const files = ['libs/backend/shared/src/lib/http.ts'];
  const { result, calls } = run(files, ['app', 'app-e2e']);
  const checks = calls.filter((call) => call.args.includes('affected'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(checks.length, 2);
  assert.ok(checks.some((call) => call.args.includes('--exclude=*,!app')));
  assert.ok(checks.some((call) => call.args.includes('--exclude=*,!app-e2e')));
  assert.ok(calls.every((call) => call.daemon === 'false'));
  assert.ok(checks.every((call) => call.input === files[0]));
  assert.ok(checks.every((call) => !call.args.some((arg) => arg.includes('related') || arg.includes('onlyChanged'))));
});

test('runner maps Angular templates and stops before E2E after unit failure', () => {
  const { result, calls } = run(['apps/web/app/src/app/shared/layout/layout.html'], ['app', 'app-e2e'], true);
  const checks = calls.filter((call) => call.args.includes('affected'));

  assert.notEqual(result.status, 0);
  assert.equal(checks.length, 1);
  assert.ok(checks[0].args.some((arg) => arg.includes('related') && arg.includes('layout.ts')));
  assert.match(result.stderr, /Nx check exited with 23/);
});

test('deleted ESLint configuration reruns full lint before full unit checks', () => {
  const file = 'apps/web/app/removed/eslint.config.mjs';
  const { result, calls } = run([file], ['app']);
  const checks = calls.filter((call) => call.args.includes('affected'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].args[checks[0].args.indexOf('-t') + 1], 'lint');
  assert.ok(!checks[0].args.some((arg) => arg.startsWith('--lintFilePatterns=')));
  assert.ok(checks[1].args.includes('--run'));
  assert.ok(!checks[1].args.some((arg) => arg.includes('related')));
});

test('range formatting uses the exact diff paths and keeps integration out of the unit job', () => {
  const file = 'libs/backend/shared/src/lib/http.ts';
  const { result, calls } = run([file], ['app', 'app-e2e'], false, ['range', 'base', 'head', '--exclude-e2e']);
  const format = calls.find((call) => call.args.includes('format:check'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(format?.input, file);
  assert.ok(format?.args.includes('--sort-root-tsconfig-paths=false'));
  assert.ok(!calls.some((call) => call.args.includes('--exclude=*,!app-e2e')));
});

test('range fixture filtering uses the CI base rather than the current HEAD', () => {
  const { result, calls } = run(['apps/web/app-e2e/src/support/auth.ts'], ['app-e2e'], false, [
    'range',
    'base-revision',
    'head-revision',
    'e2e',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(calls.some((call) => call.args.includes('--onlyChanged=base-revision')));
});

test('staged lint autofixes exact selected templates without touching unstaged TypeScript companions', () => {
  const file = 'apps/web/app/src/app/shared/layout/layout.html';
  const { result, calls } = run([file], ['app'], false, ['lint', file]);
  const checks = calls.filter((call) => call.args.includes('affected'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(checks.length, 1);
  assert.ok(checks[0].args.includes(`--lintFilePatterns=${file}`));
  assert.ok(checks[0].args.includes('--fix'));
  assert.ok(checks[0].args.includes('--maxWarnings=0'));
  assert.ok(!checks[0].args.some((arg) => arg.includes('layout.ts')));
});

test('lint-staged uses a single fail-fast command chain with literal shell-safe filenames', () => {
  const files = ["folder/user's $literal file.ts", 'docs/a guide.md'];
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import config from './lint-staged.config.mjs';
    process.stdout.write(JSON.stringify(config['*'](JSON.parse(process.argv[1]))));
  `,
      JSON.stringify(files),
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const commands = JSON.parse(result.stdout) as string[];

  assert.equal(commands.length, 2);
  assert.match(commands[0], /affected\.ts lint/);
  assert.match(commands[1], /nx format:write/);
  assert.ok(commands[0].includes("'folder/user'\\''s $literal file.ts'"));
  assert.ok(commands[0].includes("'docs/a guide.md'"));
  assert.ok(commands[1].includes('--sort-root-tsconfig-paths=false'));
});

test('dry-run selects checks without launching them and rejects ambiguous path separators', () => {
  const dry = run(['libs/backend/shared/src/lib/http.ts'], ['app', 'app-e2e'], false, ['staged', '--dry-run']);

  assert.equal(dry.result.status, 0, dry.result.stderr);
  assert.ok(!dry.calls.some((call) => call.args.includes('affected')));
  for (const file of ['source,one.ts', 'source\nnewline.ts', 'source\rcarriage.ts']) {
    const { result, calls } = run([file], ['app']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot safely represent filenames/);
    assert.equal(calls.length, 0);
  }
});
