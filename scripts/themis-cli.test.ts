import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const runCli = (root: string, args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/themis-cli.ts', ...args, '--root', root, '--json'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('Themis CLI project authority', () => {
  it('requires project scope and removes root aggregate commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'themis-cli-negative-'));
    roots.push(root);
    const missingProject = runCli(root, ['ready']);
    assert.notEqual(missingProject.status, 0);
    const help = runCli(root, ['--help']);
    assert.equal(help.status, 0);
    assert.doesNotMatch(help.stdout, /(^|\n)\s*(status|validate|events|portfolio)\b/);
  });

  it('reports an uninitialized fresh workspace with zero counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'themis-cli-status-'));
    roots.push(root);
    const result = runCli(root, ['workspace-status']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      initialized: false,
      stateFileExists: false,
      eventsFileExists: false,
      counts: { projects: 0, epics: 0, workItems: 0, sprints: 0 },
    });
  });

  it('creates and reads only a registered project store', () => {
    const root = mkdtempSync(join(tmpdir(), 'themis-cli-scoped-'));
    roots.push(root);
    const created = runCli(root, ['project-create', '--project', 'PRJ-CLI', '--name', 'CLI project']);
    assert.equal(created.status, 0, created.stderr);
    const listed = runCli(root, ['project-list', '--project', 'PRJ-CLI']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /PRJ-CLI/);
    const timeline = runCli(root, ['timeline', '--project', 'PRJ-CLI']);
    assert.equal(timeline.status, 0, timeline.stderr);
    assert.match(timeline.stdout, /project\.created/);
  });
});
