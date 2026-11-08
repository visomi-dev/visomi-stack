import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { buildQueue, injectClient, isSource, runtimeEnvironment, startDevelopment } from './live-reload.mjs';

async function until(check) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const passed = await check();

    if (passed) {
      return;
    }

    await delay(10);
  }
  assert.fail('Development fixture did not reach the expected state');
}

async function freePort() {
  const server = createServer();

  await new Promise((done) => server.listen(0, '127.0.0.1', done));

  const port = server.address().port;

  await new Promise((done) => server.close(done));

  return port;
}

test('queues changes during a build, serializes work and recovers from failure', async () => {
  let calls = 0;
  let release;
  let errors = 0;
  const queue = buildQueue(
    async () => {
      calls++;

      if (calls === 1) {
        await new Promise((done) => {
          release = done;
        });
      }

      if (calls === 2) {
        throw new Error('synthetic_build_failure');
      }
    },
    () => errors++,
    0,
  );

  queue.request();

  await until(() => release);

  queue.request();
  queue.request();

  await delay(10);

  assert.equal(calls, 1);
  release();

  await until(() => errors === 1);

  assert.equal(calls, 2);
  queue.request();

  await until(() => calls === 3);

  await queue.close();

  queue.request();

  await delay(10);

  assert.equal(calls, 3);
});

test('limits source observation and preserves explicit database configuration', () => {
  assert.equal(isSource('src/button.html'), true);
  for (const path of [
    'node_modules/module.js',
    'dist/main.js',
    '.astro/types.d.ts',
    'button.spec.ts',
    'file.ts~',
    'src/lib/mail/templates.generated.ts',
    '.env',
    'src/.env.local',
  ]) {
    assert.equal(isSource(path), false);
  }
  const env = runtimeEnvironment({
    POSTGRES_USER: 'synthetic@user',
    POSTGRES_PASSWORD: 'synthetic:password',
    APP_PORT: '8123',
  });

  assert.equal(new URL(env.DATABASE_URL).username, 'synthetic%40user');
  assert.equal(new URL(env.DATABASE_URL).password, 'synthetic%3Apassword');
  assert.equal(env.AUTH_ORIGIN, 'http://localhost:8123');
  assert.equal(env.NX_DAEMON, 'false');
  assert.equal(runtimeEnvironment({ DATABASE_URL: '' }).DATABASE_URL, '');
  assert.throws(() => runtimeEnvironment({ NODE_ENV: 'production' }));
  assert.throws(() => runtimeEnvironment({ PORT: 'invalid' }));
  assert.equal(
    injectClient('<head></head><body>Example</body>'),
    '<head><script type="module" src="/__dev/live-reload/client.js"></script></head><body>Example</body>',
  );
});

test('watches source edits, replaces compiled executables and keeps API responses and headers intact', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'visomi-development-'));
  let development;

  try {
    for (const path of ['bin', 'apps/web/site/src', 'dist/apps/web/gateway']) {
      await mkdir(join(cwd, path), { recursive: true });
    }

    await writeFile(join(cwd, 'package.json'), '{"type":"module"}');

    await writeFile(join(cwd, 'apps/web/site/src/probe.txt'), 'initial');

    await writeFile(
      join(cwd, 'bin/pnpm'),
      `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const value = await readFile('apps/web/site/src/probe.txt', 'utf8');
if (value === 'invalid') {
 await writeFile('build-failed', 'synthetic');
 process.exit(1);
}
const source = \`import {createServer} from 'node:http';
const value = \${JSON.stringify(value)};
const server = createServer((req, res) => {
 res.setHeader('set-cookie', 'synthetic=value; HttpOnly');
 res.setHeader('content-security-policy', "script-src 'self'");
 if (req.url === '/api/') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({value})); }
 else { res.setHeader('content-type', 'text/html'); res.end('<html><head></head><body>'+value+'</body></html>'); }
});
server.listen(Number(process.env.PORT), process.env.HOST);
process.once('SIGTERM', () => server.close());\`;
await writeFile('dist/apps/web/gateway/main.js', source);
`,
      { mode: 0o755 },
    );

    const port = await freePort();

    const started = await startDevelopment({
      cwd,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: '',
        PORT: String(port),
        HOST: '127.0.0.1',
        PATH: join(cwd, 'bin') + ':' + process.env.PATH,
      },
    });

    development = started;
    const origin = `http://127.0.0.1:${port}`;

    async function value() {
      const response = await fetch(origin + '/api/');

      if (!response.ok) {
        await response.body.cancel();

        return undefined;
      }

      const body = await response.json();

      return body.value;
    }

    await until(async () => {
      const actual = await value();

      return actual === 'initial';
    });

    const html = await fetch(origin + '/');

    assert.equal(html.headers.get('set-cookie'), 'synthetic=value; HttpOnly');
    assert.equal(html.headers.get('content-security-policy'), "script-src 'self'");
    const htmlBody = await html.text();

    assert.match(htmlBody, /live-reload\/client.js/);
    const script = await fetch(origin + '/__dev/live-reload/client.js');

    const scriptBody = await script.text();

    assert.match(scriptBody, /EventSource/);

    await writeFile(join(cwd, 'apps/web/site/src/probe.txt'), 'changed');

    await until(async () => {
      const actual = await value();

      return actual === 'changed';
    });

    await writeFile(join(cwd, 'apps/web/site/src/probe.txt'), 'invalid');

    await until(async () => {
      try {
        await readFile(join(cwd, 'build-failed'));

        return true;
      } catch {
        return false;
      }
    });

    await until(async () => {
      const response = await fetch(origin + '/');
      const body = await response.text();

      return response.status === 503 && body.includes('live-reload/client.js');
    });

    const loading = await fetch(origin + '/app/es/sign-in');
    const loadingHtml = await loading.text();

    assert.equal(loading.status, 503);
    assert.equal(loading.headers.get('cache-control'), 'no-store');
    assert.equal(loading.headers.get('retry-after'), '1');
    assert.match(loading.headers.get('content-security-policy'), /style-src 'self'; font-src 'self'/);
    assert.match(loadingHtml, /lang="es"/);
    assert.match(loadingHtml, /Preparando tu espacio de trabajo/);
    assert.match(loadingHtml, /name="viewport"/);
    assert.match(loadingHtml, /role="status"/);
    assert.doesNotMatch(loadingHtml, /\{\{|<style|style=|<script(?![^>]*src=)/);

    const stylesheet = await fetch(origin + '/__dev/live-reload/loading.css');
    const css = await stylesheet.text();

    assert.equal(stylesheet.headers.get('content-type'), 'text/css');
    assert.match(css, /prefers-reduced-motion/);
    const fontUrl = /url\("([^"]+\.woff2)"\)/.exec(css)?.[1];

    assert.ok(fontUrl);
    const font = await fetch(origin + fontUrl);
    const fontData = await font.arrayBuffer();

    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.ok(fontData.byteLength > 1000);

    await writeFile(join(cwd, 'apps/web/site/src/probe.txt'), 'recovered');

    await until(async () => {
      const actual = await value();

      return actual === 'recovered';
    });

    const built = await readFile(join(cwd, 'dist/apps/web/gateway/main.js'), 'utf8');

    assert.match(built, /recovered/);
  } finally {
    await development?.close();

    await rm(cwd, { recursive: true, force: true });
  }
});
