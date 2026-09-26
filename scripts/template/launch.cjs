const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const env = { ...process.env, NX_DAEMON: 'false' };
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const target = process.argv[2] === 'smoke' ? 'template:smoke' : `template:${process.argv[2]}`;

// Arguments are forwarded as an argv array, never interpolated into a shell.
const build = spawnSync(pnpm, ['exec', 'nx', 'run', 'template:build'], { cwd: root, env, stdio: ['inherit', 2, 2] });

if (build.error || build.status !== 0) process.exit(build.status ?? 1);
const result = spawnSync(
  process.execPath,
  [resolve(root, 'dist/template/main.cjs'), process.argv[2], ...process.argv.slice(3)],
  {
    cwd: root,
    env,
    stdio: 'inherit',
  },
);

if (result.error) console.error(`Could not run ${target}.`);
process.exit(result.status ?? 1);
