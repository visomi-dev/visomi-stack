import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { companion, quote, requiresFullLint, selectCheck } from './selection.ts';
import type { Project } from './selection.ts';
import { runCommand } from './run-command.ts';

// Never enable the daemon, even when invoked without a shell wrapper.
process.env['NX_DAEMON'] = 'false';

function output(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, { encoding: 'utf8', input, env: process.env, maxBuffer: 32 * 1024 * 1024 });

  if (result.error || result.status !== 0) {
    process.stderr.write(result.stderr ?? '');

    throw result.error ?? new Error(`${command} exited with ${result.status}`);
  }

  return result.stdout;
}

async function execute(args: string[], input: string, dryRun: boolean): Promise<void> {
  console.log(`pnpm nx ${args.map(quote).join(' ')}`);
  if (dryRun) return;
  const target = args[args.indexOf('-t') + 1];
  const timeoutMs = target === 'e2e' ? 25 * 60_000 : 5 * 60_000;

  await runCommand('pnpm', ['exec', 'nx', ...args], input, timeoutMs);
}

const [mode, ...parameters] = process.argv.slice(2);
const dryRun = parameters.includes('--dry-run');
const excludeE2e = parameters.includes('--exclude-e2e');
const values = parameters.filter((value) => !['--dry-run', '--exclude-e2e'].includes(value));
let files: string[];
let targets: string[];

if (mode === 'staged') {
  files = output('git', ['diff', '--cached', '--name-only', '--no-renames', '-z', '--diff-filter=ACMRD'])
    .split('\0')
    .filter(Boolean);
  targets = ['test', 'vite:test', 'e2e'];
  // lint-staged checks existing config consumers; deleted config files cannot reach it.
  if (files.some((file) => requiresFullLint(file) && !existsSync(file))) targets.unshift('lint');
} else if (mode === 'lint') {
  files = values.map((file) => relative(process.cwd(), resolve(file)));
  targets = ['lint'];
} else if (mode === 'range') {
  const [base, head, ...requested] = values;

  if (!base || !head) throw new Error('Usage: affected.ts range <base> <head> [targets...]');
  files = output('git', ['diff', '--name-only', '--no-renames', '-z', '--diff-filter=ACMRD', base, head])
    .split('\0')
    .filter(Boolean);
  targets = requested.length ? requested : ['lint', 'test', 'vite:test', 'typecheck', 'build', 'e2e'];
} else throw new Error('Usage: affected.ts staged|lint|range [arguments] [--dry-run]');

if (files.some((file) => /[\n\r,]/.test(file))) {
  throw new Error('Nx file selection cannot safely represent filenames containing newlines or commas.');
}
if (files.length) {
  const input = files.join('\n');
  const graphOutput = output('pnpm', ['exec', 'nx', 'graph', '--print']);
  const graph = JSON.parse(graphOutput) as { graph: { nodes: Record<string, { data: Project }> } };
  const affectedOutput = output('pnpm', ['exec', 'nx', 'show', 'projects', '--affected', '--stdin', '--json'], input);
  const affected = JSON.parse(affectedOutput) as string[];
  const missing = files.filter((file) => !existsSync(file));
  const related = [
    ...new Set(
      files.flatMap((file) => {
        const paired = companion(file);

        return paired && existsSync(paired) ? [file, paired] : [file];
      }),
    ),
  ];

  if (mode === 'range' && (!values.slice(2).length || targets.includes('format:check'))) {
    await execute(['format:check', '--stdin', '--sort-root-tsconfig-paths=false'], input, dryRun);
  }
  for (const target of targets) {
    for (const name of affected.sort()) {
      if (excludeE2e && name.endsWith('-e2e')) continue;
      const project = { ...graph.graph.nodes[name].data, name };
      // Companions broaden related-test discovery, not the staged autofix scope.
      const check = selectCheck(project, target, target === 'lint' ? files : related, missing);

      if (!check) continue;
      if (mode === 'lint' && check.reason === 'changed lintable files only') {
        if (check.args[0]?.startsWith('--command=')) check.args[0] += ' --fix';
        else check.args.push('--fix', '--maxWarnings=0');
      }
      if (mode === 'range' && check.args.includes('--onlyChanged')) {
        check.args = check.args.map((arg) => (arg === '--onlyChanged' ? `--onlyChanged=${values[0]}` : arg));
      }
      console.log(`${name}:${target}: ${check.reason}`);
      await execute(
        [
          'affected',
          '-t',
          target,
          '--stdin',
          `--exclude=*,!${name}`,
          '--outputStyle=static',
          '--parallel=1',
          ...check.args,
        ],
        input,
        dryRun,
      );
    }
  }
} else console.log('No changed files; no checks to run.');
