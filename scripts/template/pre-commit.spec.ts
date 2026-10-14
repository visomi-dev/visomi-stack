import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

function runGate(failure = '') {
  // Exercise the real shell gate without launching nested Nx tasks or changing the index.
  return spawnSync(
    'sh',
    [
      '-c',
      `
    pnpm() {
      printf '%s|%s\n' "$NX_DAEMON" "$*"
      case "$*" in
        *lint-staged*) stage=format ;;
        *'scripts/template/checks/affected.ts staged'*) stage=checks ;;
        *) return 99 ;;
      esac
      [ "$FAIL_STAGE" != "$stage" ] || return 23
    }
    . "$HOOK_PATH"
  `,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NX_DAEMON: 'true', HOOK_PATH: resolve('.husky/pre-commit'), FAIL_STAGE: failure },
    },
  );
}

test('pre-commit runs staged autofixes before Nx consumer-aware related checks', () => {
  const result = runGate();

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'false|exec lint-staged',
    'false|exec node --experimental-strip-types scripts/template/checks/affected.ts staged',
  ]);
});

for (const [failure, calls] of [
  ['format', 1],
  ['checks', 2],
] as const) {
  test(`pre-commit stops and propagates a ${failure} failure`, () => {
    const result = runGate(failure);

    assert.equal(result.status, 23);
    assert.equal(result.stdout.trim().split('\n').length, calls);
  });
}
