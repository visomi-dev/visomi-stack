import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { scanMigrationOutputs } from './themis-project-migration-evidence.ts';
import { migrationPaths } from './themis-project-migration-paths.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function scan(contents: string) {
  const root = mkdtempSync(join(tmpdir(), 'themis-evidence-scan-'));

  roots.push(root);
  const locations = migrationPaths(root);

  mkdirSync(locations.logs, { recursive: true });
  writeFileSync(join(locations.logs, 'fixture.txt'), contents);

  return { root, result: scanMigrationOutputs(root) };
}

describe('migration evidence sensitive-output scan', () => {
  for (const contents of [
    'password = fixture-credential',
    'ACCESS_TOKEN\t: fixture-credential',
    '{"secret":"fixture-credential"}',
    "'api_key' : 'fixture-credential'",
  ]) {
    it(`detects credential assignments: ${contents}`, () => {
      const { result } = scan(contents);

      assert.deepEqual(
        result.findings.map(({ pattern }) => pattern),
        ['credential'],
      );
    });
  }

  for (const contents of [
    'project context = protected-content',
    'workspace key\t: protected-content',
    '{"plaintext":"protected-content"}',
    "'ciphertext payload' : 'protected-content'",
  ]) {
    it(`detects protected payload assignments: ${contents}`, () => {
      const { result } = scan(contents);

      assert.deepEqual(
        result.findings.map(({ pattern }) => pattern),
        ['protected-payload'],
      );
    });
  }

  it('retains private-key and exact local-path detection', () => {
    const { root } = scan('-----BEGIN PRIVATE KEY-----');
    const locations = migrationPaths(root);

    writeFileSync(join(locations.logs, 'fixture.txt'), `-----BEGIN PRIVATE KEY-----\n${root}`);
    const result = scanMigrationOutputs(root);

    assert.deepEqual(
      result.findings.map(({ pattern }) => pattern),
      ['local-path', 'private-key'],
    );
  });

  it('does not flag bounded status metadata or descriptive text without assignments', () => {
    const { result } = scan('{"phase":"cutover","projectCount":2}\nRotate password and protect workspace key.');

    assert.deepEqual(result.findings, []);
    assert.equal(result.categories['migration-logs'], 1);
    assert.equal(result.filesScanned.length, 1);
  });
});
