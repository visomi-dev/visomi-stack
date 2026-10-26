import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { authSchema, createDatabase, createSmtp } from '@visomi-stack/backend-shared';
import { testPostgres } from '@visomi-stack/dev-testing/postgres';
import { SMTPServer } from 'smtp-server';
import { beforeAll, afterAll, beforeEach, expect } from 'vitest';

import { createApp, createAuthentication, authConfig } from '../../../src/app';

export const password = 'Synthetic password 42!';
export function authenticationFixture() {
  let postgres: Awaited<ReturnType<typeof testPostgres>>;
  let resource: ReturnType<typeof createDatabase>;
  let server: Server;
  let smtp: SMTPServer;
  let transport: ReturnType<typeof createSmtp>;
  let runtime: ReturnType<typeof createAuthentication>;
  let origin: string;
  const messages: { to: string; raw: string }[] = [];
  let failMail = false;

  beforeAll(async () => {
    const result1 = await testPostgres();

    postgres = result1;
    resource = createDatabase(postgres.url);
    smtp = new SMTPServer({
      disabledCommands: ['AUTH', 'STARTTLS'],
      logger: false,
      onData(stream, session, callback) {
        let raw = '';

        stream.on('data', (chunk) => {
          raw += String(chunk);
        });
        stream.on('end', () => {
          if (failMail) {
            callback(new Error('synthetic_delivery_failure'));

            return;
          }

          messages.push({ to: session.envelope.rcptTo[0].address, raw });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    const port = ((smtp as unknown as { server: Server }).server.address() as AddressInfo).port;

    transport = createSmtp({
      host: '127.0.0.1',
      port,
      secure: false,
      allowInsecureLocal: true,
      from: 'Visomi <auth@example.test>',
    });
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = authConfig({
      origin,
      rpId: '127.0.0.1',
      secret: 'synthetic-session-secret-more-than-32-bytes',
      googleClientId: 'synthetic-client.apps.googleusercontent.com',
      totpKey: Buffer.alloc(32, 7).toString('base64url'),
    });

    runtime = createAuthentication({ database: resource.db, pool: resource.pool, config, mail: transport });
    server.on('request', createApp({ auth: runtime }));
  }, 120000);
  beforeEach(async () => {
    await resource.db.delete(authSchema.rateLimits);
    failMail = false;
  });
  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    transport?.close();
    if (smtp) {
      await new Promise<void>((resolve) => smtp.close(resolve));
    }

    await resource?.close();
    await postgres?.stop();
  });
  const lastCode = (email: string) => {
    const sent = messages.filter((message) => message.to === email).slice(-1)[0];
    const code = sent?.raw.match(/\b\d{6}\b/)?.[0];

    expect(code, 'a synthetic SMTP message must contain the expected code').toBeDefined();

    return code!;
  };
  const client = async () => {
    let cookie = '';
    let csrf = '';
    const call = async (method: string, path: string, input?: unknown, headers?: Record<string, string>) => {
      const response = await fetch(`${origin}/auth${path}`, {
        method,
        headers: {
          cookie,
          origin,
          'x-csrf-token': csrf,
          ...(input === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      const setCookie = response.headers.get('set-cookie');

      if (setCookie) {
        cookie = setCookie.split(';')[0];
      }

      let data;

      if (response.status !== 204) {
        const received = await response.json();

        data = received;
      }

      if (data?.csrfToken) {
        csrf = data.csrfToken;
      }

      return { status: response.status, data, response };
    };
    const first = await call('GET', '/session');

    expect(first.status).toBe(200);

    return {
      call,
      get cookie() {
        return cookie;
      },
      get csrf() {
        return csrf;
      },
    };
  };
  const signup = async (email = `${randomUUID()}@example.test`) => {
    const browser = await client();
    const created = await browser.call('POST', '/password/sign-up', { email, password });

    expect(created.status).toBe(201);
    expect(created.data.access).toBe('unverified');
    const verified = await browser.call('POST', '/email/verify', {
      flowId: created.data.flowId,
      code: lastCode(email),
    });

    expect(verified.status).toBe(200);
    expect(verified.data.access).toBe('full');

    return { browser, email, userId: verified.data.user.id as string };
  };

  return {
    client,
    signup,
    lastCode,
    messages,
    get runtime() {
      return runtime;
    },
    get db() {
      return resource.db;
    },
    get pool() {
      return resource.pool;
    },
    get origin() {
      return origin;
    },
    failDelivery(fail = true) {
      failMail = fail;
    },
  };
}
