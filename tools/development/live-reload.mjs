import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readdirSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request as forwardRequest } from 'node:http';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { createLoadingPage, loadingPrefix as prefix } from './loading-page.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const projectRoots = [
  'apps/web/api',
  'apps/web/gateway',
  'apps/web/realtime',
  'apps/web/site',
  'apps/web/app',
  'libs/backend/shared',
  'libs/web/backend/shared',
  'libs/web/frontend/ui',
  'libs/web/shared/observability',
];
const rootInputs = new Set([
  'styles.base.css',
  '.postcssrc.json',
  'nx.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]);
const ignored = new Set(['node_modules', 'dist', '.nx', '.astro', '.git', 'coverage', 'tmp']);
const client = `const loadingPage = document.documentElement.hasAttribute('data-development-loading');
if (loadingPage) {
  let theme;
  try { theme = localStorage.getItem('visomi.theme'); } catch { /* Storage may be unavailable. */ }
  document.documentElement.classList.toggle('dark', theme === 'dark' ||
    (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches));
}
const events = new EventSource('${prefix}/events');
let revision;
events.onmessage = ({ data }) => {
  const state = JSON.parse(data);
  if (state.ready && (loadingPage || (revision !== undefined && revision !== state.revision))) location.reload();
  revision ??= state.revision;
};`;

export function isSource(path) {
  return (
    !path.split(/[\\/]/).some((part) => ignored.has(part) || /^\.env(?:\.|$)/.test(part)) &&
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path) &&
    !path.endsWith('templates.generated.ts') &&
    !path.endsWith('~')
  );
}

// Changes arriving during a build are batched into the next build, never lost or run concurrently.
export function buildQueue(build, onError, debounce = 150) {
  let timer;
  let running;
  let dirty = false;
  let closed = false;

  async function drain() {
    if (running || closed) {
      return;
    }

    running = (async () => {
      while (dirty && !closed) {
        dirty = false;

        try {
          await build();
        } catch {
          onError();
        }
      }
    })();

    await running;

    running = undefined;
  }

  return {
    request() {
      if (closed) {
        return;
      }

      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void drain(), debounce);
    },
    async close() {
      closed = true;
      clearTimeout(timer);

      await running;
    },
  };
}

export function injectClient(html) {
  return html.replace('</head>', `<script type="module" src="${prefix}/client.js"></script></head>`);
}

export function runtimeEnvironment(env) {
  const port = Number(env.PORT ?? env.APP_PORT ?? 8080);

  if (!Number.isInteger(port) || port < 1 || port > 65535 || env.NODE_ENV === 'production') {
    throw new Error('development_configuration_invalid');
  }

  const database = new URL('postgresql://127.0.0.1');

  database.port = env.POSTGRES_PORT || '5432';
  database.username = env.POSTGRES_USER || 'postgres';
  database.password = env.POSTGRES_PASSWORD || 'local-development-only';
  database.pathname = '/' + encodeURIComponent(env.POSTGRES_DB || 'visomi');

  return {
    ...env,
    NODE_ENV: 'development',
    AUTH_ORIGIN: env.AUTH_ORIGIN || `http://localhost:${port}`,
    AUTH_RP_ID: env.AUTH_RP_ID || 'localhost',
    DATABASE_URL: env.DATABASE_URL ?? database.href,
    // Nx is a short-lived build runner here; framework watch servers are not started.
    NX_DAEMON: 'false',
    NX_ISOLATE_PLUGINS: 'false',
    API_APP_PATH: '',
    SITE_APP_PATH: '',
    APPLICATION_APP_PATH: '',
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = once(child, 'exit');
  // Build processes own descendants (Nx, Angular, Astro); close the entire process group on Linux.
  const signal = (name) => {
    try {
      if (process.platform === 'win32') {
        child.kill(name);
      } else {
        process.kill(-child.pid, name);
      }
    } catch {
      /* The process may already have exited. */
    }
  };

  signal('SIGTERM');
  const deadline = setTimeout(() => signal('SIGKILL'), 6000);

  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}

export async function startDevelopment({ cwd = root, env = process.env } = {}) {
  const runtime = runtimeEnvironment(env);
  const loading = await createLoadingPage();
  const port = Number(env.PORT ?? env.APP_PORT ?? 8080);
  const clients = new Set();
  const watchers = [];
  let revision = randomUUID();
  let ready = false;
  let stopping = false;
  let child;
  let builder;
  let upstreamPort;

  const publish = () => {
    const event = `data: ${JSON.stringify({ ready, revision })}\n\n`;

    for (const response of clients) {
      response.write(event);
    }
  };
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0];

    if (path === `${prefix}/events`) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      clients.add(response);
      response.write(`data: ${JSON.stringify({ ready, revision })}\n\n`);
      response.on('close', () => clients.delete(response));

      return;
    }

    if (path === `${prefix}/client.js`) {
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      response.end(client);

      return;
    }

    if (path === `${prefix}/loading.css`) {
      response.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' });
      response.end(loading.css);

      return;
    }

    if (Object.hasOwn(loading.fonts, path)) {
      void readFile(loading.fonts[path]).then(
        (font) => {
          response.writeHead(200, {
            'content-type': path.endsWith('.woff2') ? 'font/woff2' : 'font/woff',
            'cache-control': 'no-store',
          });
          response.end(font);
        },
        () => {
          response.writeHead(404);
          response.end();
        },
      );

      return;
    }

    if (!ready) {
      const locale = /^\/(?:app\/)?es(?:\/|$)/.test(path) ? 'es' : 'en';

      response.writeHead(503, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '1',
        'content-security-policy':
          "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(injectClient(loading.pages[locale]));

      return;
    }

    const forwarded = forwardRequest(
      {
        hostname: '127.0.0.1',
        port: upstreamPort,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, 'accept-encoding': 'identity' },
      },
      (upstream) => {
        const headers = { ...upstream.headers };
        const html = request.method !== 'HEAD' && headers['content-type']?.includes('text/html');

        if (!html) {
          response.writeHead(upstream.statusCode, headers);
          upstream.pipe(response);

          return;
        }

        delete headers['content-length'];
        delete headers.etag;
        headers['cache-control'] = 'no-store';
        // Only HTML is buffered; preserve API bodies, cookies, CSP and status codes unchanged.
        upstream.setEncoding('utf8');
        let body = '';

        upstream.on('data', (chunk) => {
          body += chunk;
        });
        upstream.on('end', () => {
          response.writeHead(upstream.statusCode, headers);
          response.end(injectClient(body));
        });
        upstream.on('error', () => response.destroy());
      },
    );

    forwarded.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(503);
      }

      response.end();
    });
    request.on('aborted', () => forwarded.destroy());
    response.on('close', () => forwarded.destroy());
    request.pipe(forwarded);
  });

  server.on('upgrade', (request, socket, head) => {
    if (!ready || request.url?.split('?')[0] !== '/socket.io/') {
      socket.destroy();

      return;
    }

    const forwarded = forwardRequest({
      hostname: '127.0.0.1',
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    });

    socket.on('error', () => forwarded.destroy());
    socket.on('close', () => forwarded.destroy());
    forwarded.on('error', () => socket.destroy());
    forwarded.on('response', (response) => {
      response.resume();
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    forwarded.on('upgrade', (response, upstream, upstreamHead) => {
      const headers = Object.entries(response.headers).map(([name, value]) => name + ': ' + value);

      socket.write(['HTTP/1.1 101 Switching Protocols', ...headers, '', ''].join('\r\n'));
      upstream.write(head);
      socket.write(upstreamHead);
      upstream.on('error', () => socket.destroy());
      upstream.on('close', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.pipe(socket).pipe(upstream);
    });
    forwarded.end();
  });
  const heartbeat = setInterval(() => {
    for (const response of clients) {
      response.write(': heartbeat\n\n');
    }
  }, 15000);
  const spawnOptions = { cwd, env: runtime, stdio: 'inherit', detached: process.platform !== 'win32' };
  const queue = buildQueue(
    async () => {
      ready = false;
      publish();

      await stopChild(child);

      if (stopping) {
        return;
      }

      console.log('Development build started.');
      builder = spawn(
        'pnpm',
        ['nx', 'run-many', '-t', 'build', '-p', 'web-gateway', '--parallel=1', '--output-style=static'],
        spawnOptions,
      );
      const [code] = await once(builder, 'exit');

      builder = undefined;

      if (stopping) {
        return;
      }

      if (code !== 0) {
        throw new Error('development_build_failed');
      }

      const reservation = createServer();

      reservation.listen(0, '127.0.0.1');

      await once(reservation, 'listening');

      upstreamPort = reservation.address().port;

      await new Promise((done) => reservation.close(done));

      child = spawn(process.execPath, ['dist/apps/web/gateway/main.js'], {
        ...spawnOptions,
        env: { ...runtime, HOST: '127.0.0.1', PORT: String(upstreamPort) },
      });
      child.on('error', () => {
        ready = false;
        publish();
      });
      child.on('exit', () => {
        ready = false;
        publish();
      });
      for (let attempt = 0; attempt < 300 && !stopping; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error('development_gateway_failed');
        }

        try {
          const result = await fetch(`http://127.0.0.1:${upstreamPort}/api/`, { signal: AbortSignal.timeout(500) });

          await result.body?.cancel();

          if (result.ok) {
            ready = true;
            revision = randomUUID();
            publish();
            console.log('Development gateway ready.');

            return;
          }
        } catch {
          /* Wait until the executable finishes owning startup. */
        }

        await delay(100);
      }

      await stopChild(child);

      if (!stopping) {
        throw new Error('development_gateway_unavailable');
      }
    },
    () => console.error('Development build or startup failed. Waiting for the next source change.'),
  );

  function observe(path, recursive, filter = () => true) {
    if (!existsSync(path)) {
      return;
    }

    const watcher = watch(path, { recursive }, (_event, name) => {
      if (!stopping && (!name || (isSource(String(name)) && filter(String(name))))) {
        queue.request();
      }
    });

    watcher.on('error', () => {
      console.error('Development source watcher failed. Restart the development command.');
      void close();
    });
    watchers.push(watcher);
  }

  async function close() {
    if (stopping) {
      return;
    }

    stopping = true;
    clearInterval(heartbeat);
    watchers.forEach((watcher) => watcher.close());

    await Promise.all([stopChild(builder), stopChild(child)]);

    await queue.close();

    for (const response of clients) {
      response.end();
    }
    server.closeAllConnections();

    await new Promise((done) => server.close(done));
  }

  try {
    // Observe source subtrees, not the workspace root recursively: node_modules and outputs stay unwatched.
    observe(cwd, false, (name) => rootInputs.has(name));
    for (const project of projectRoots) {
      const directory = join(cwd, project);

      if (!existsSync(directory)) {
        continue;
      }

      observe(directory, false, (name) => !['README.md', 'node_modules'].includes(name));
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && isSource(entry.name) && !['tests', 'e2e', 'node_modules'].includes(entry.name)) {
          observe(join(directory, entry.name), true);
        }
      }
    }
    observe(join(cwd, 'patches'), true);
    server.listen(port, env.HOST || '127.0.0.1');

    await once(server, 'listening');

    queue.request();

    return { close, server };
  } catch (error) {
    await close();

    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (existsSync(join(root, '.env'))) {
      process.loadEnvFile(join(root, '.env'));
    }

    const development = await startDevelopment();

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => void development.close());
    }
  } catch {
    console.error('Development startup failed. Check the port, environment and build configuration.');
    process.exitCode = 1;
  }
}
