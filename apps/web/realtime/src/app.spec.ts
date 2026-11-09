import { once } from 'node:events';
import { createServer } from 'node:http';

import express from 'express';
import session, { MemoryStore } from 'express-session';
import { io, type Socket } from 'socket.io-client';

import { attachRealtimeServer } from './app';

const origin = 'https://app.example.test';
const requestId = '9aef148d-8d52-4e4d-aace-18eabaeec543';

async function setup() {
  const app = express();
  const store = new MemoryStore();
  const readSession = session({ secret: 'synthetic-test-secret', store, resave: false, saveUninitialized: false });
  const server = createServer(app);
  const sockets: Socket[] = [];
  let owner: string | undefined;

  app.get('/fixture-session', readSession, (request, response) => {
    Object.assign(request.session, { fixture: true, passport: { user: request.query['user'] } });
    response.json({ sessionId: request.sessionID });
  });
  const realtime = attachRealtimeServer(server, {
    origin,
    readSession,
    readUser: async (user) => (typeof user === 'string' ? user : null),
    watchExpiration: async (sid, id) => (owner === sid && id === requestId ? Date.now() + 60_000 : 0),
  });

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('fixture_address_unavailable');
  }

  const url = 'http://127.0.0.1:' + address.port;

  return {
    ...realtime,
    async newSession(ownsRequest: boolean, user?: string) {
      const path = new URL('/fixture-session', url);

      if (user) {
        path.searchParams.set('user', user);
      }

      const response = await fetch(path);
      const data: { sessionId: string } = await response.json();

      if (ownsRequest) {
        owner = data.sessionId;
      }

      return { id: data.sessionId, cookie: response.headers.getSetCookie()[0].split(';')[0] };
    },
    connect(cookie?: string, from = origin, namespace = '/') {
      const socket = io(url + namespace, {
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
        extraHeaders: { origin: from, ...(cookie ? { cookie } : {}) },
        auth: { requestId, userId: 'forged-user', sessionId: 'forged-session' },
      });

      sockets.push(socket);

      return socket;
    },
    revoke(id = owner!) {
      return new Promise<void>((resolve) => store.destroy(id, () => resolve()));
    },
    async close() {
      await realtime.close();

      expect(server.listening).toBe(false);

      for (const socket of sockets) {
        socket.disconnect();
      }
    },
  };
}

it('sends a payload-free hint to the owning anonymous session and disconnects it after revocation', async () => {
  const fixture = await setup();

  try {
    const { cookie } = await fixture.newSession(true);
    const socket = fixture.connect(cookie);

    await new Promise<void>((resolve) => socket.once('connect', resolve).connect());

    const hint = new Promise<unknown[]>((resolve) =>
      socket.once('device-approval:changed', (...args: unknown[]) => resolve(args)),
    );

    await fixture.notifyDeviceApproval(requestId);

    await expect(hint).resolves.toEqual([]);

    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));

    await fixture.revoke();

    await fixture.notifyDeviceApproval(requestId);

    await expect(disconnected).resolves.toBe('io server disconnect');
  } finally {
    await fixture.close();
  }
});

it('rejects the same request ID from a different session, an unsigned client or another origin', async () => {
  const fixture = await setup();

  try {
    const { cookie } = await fixture.newSession(true);
    const other = await fixture.newSession(false);
    const sockets = [
      fixture.connect(other.cookie),
      fixture.connect(),
      fixture.connect(cookie, 'https://other.example.test'),
    ];

    for (const socket of sockets) {
      const rejected = new Promise<Error>((resolve) => socket.once('connect_error', resolve));

      socket.connect();

      await expect(rejected).resolves.toBeInstanceOf(Error);

      expect(socket.connected).toBe(false);
    }
  } finally {
    await fixture.close();
  }
});

it('routes session and user notices separately and rechecks the persisted session before replying', async () => {
  const fixture = await setup();

  try {
    const first = await fixture.newSession(false, 'synthetic-user');
    const second = await fixture.newSession(false, 'synthetic-user');
    const other = await fixture.newSession(false, 'other-user');
    const received = [vi.fn(), vi.fn(), vi.fn()];
    const sockets = [first, second, other].map(({ cookie }, index) => {
      const socket = fixture.connect(cookie, origin, '/session');

      socket.on('session:changed', received[index]);

      return socket;
    });

    await Promise.all(
      sockets.map((socket) => new Promise<void>((resolve) => socket.once('connect', resolve).connect())),
    );

    await fixture.notifySession(first.id);

    await Promise.all(
      sockets.map((socket) => expect(socket.timeout(1000).emitWithAck('session:check')).resolves.toBe(true)),
    );

    expect(received.map((listener) => listener.mock.calls.length)).toEqual([1, 0, 0]);

    await fixture.notifyUser('synthetic-user');

    await Promise.all(
      sockets.map((socket) => expect(socket.timeout(1000).emitWithAck('session:check')).resolves.toBe(true)),
    );

    expect(received.map((listener) => listener.mock.calls.length)).toEqual([2, 1, 0]);
    expect(received[0].mock.calls).toEqual([[], []]);

    await fixture.revoke(first.id);

    await expect(sockets[0].timeout(1000).emitWithAck('session:check')).resolves.toBe(false);

    const disconnected = new Promise<string>((resolve) => sockets[1].once('disconnect', resolve));

    await fixture.revoke(second.id);

    await fixture.notifyUser('synthetic-user');

    await expect(disconnected).resolves.toBe('io server disconnect');

    expect(received[1]).toHaveBeenCalledOnce();
  } finally {
    await fixture.close();
  }
});

it('rejects an anonymous session on the authenticated namespace even with forged IDs', async () => {
  const fixture = await setup();

  try {
    const { cookie } = await fixture.newSession(false);
    const socket = fixture.connect(cookie, origin, '/session');
    const rejected = new Promise<Error>((resolve) => socket.once('connect_error', resolve));

    socket.connect();

    await expect(rejected).resolves.toMatchObject({ message: 'session_unavailable' });
  } finally {
    await fixture.close();
  }
});
