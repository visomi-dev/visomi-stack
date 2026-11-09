import type { Server, Socket } from 'socket.io';

import { reloadSocketSession } from './identity';

export type ReadSessionUser = (serialized: unknown) => Promise<string | null>;

export function attachSessionChannel(io: Server, readUser: ReadSessionUser) {
  const sessions = io.of('/session');

  async function identify(socket: Socket) {
    const session = await reloadSocketSession(socket);

    if (!session) {
      return null;
    }

    const userId = await readUser(session.user);

    return userId ? { sessionId: session.id, userId } : null;
  }

  async function isCurrent(socket: Socket): Promise<boolean> {
    try {
      const identity = await identify(socket);

      return Boolean(
        identity && identity.sessionId === socket.data.sessionId && identity.userId === socket.data.userId,
      );
    } catch {
      return false;
    }
  }

  sessions.use((socket, next) => {
    void identify(socket).then(
      (identity) => {
        if (!identity) {
          next(new Error('session_unavailable'));

          return;
        }

        Object.assign(socket.data, identity);
        next();
      },
      () => next(new Error('session_unavailable')),
    );
  });

  sessions.on('connection', (socket) => {
    void socket.join([`session:${socket.data.sessionId}`, `user:${socket.data.userId}`]);
    let checking = false;

    socket.on('session:check', (ack: unknown) => {
      if (checking || typeof ack !== 'function') {
        return;
      }

      checking = true;
      void isCurrent(socket).then((current) => {
        checking = false;

        if (socket.connected) {
          ack(current);

          if (!current) {
            socket.disconnect();
          }
        }
      });
    });
  });

  async function notify(room: string): Promise<void> {
    await Promise.all(
      [...(sessions.adapter.rooms.get(room) ?? [])].map(async (id) => {
        const socket = sessions.sockets.get(id);

        if (!socket) {
          return;
        }

        const current = await isCurrent(socket);

        if (socket.connected) {
          if (current) {
            socket.emit('session:changed');
          } else {
            socket.disconnect();
          }
        }
      }),
    );
  }

  return {
    notifySession: (sessionId: string) => notify(`session:${sessionId}`),
    notifyUser: (userId: string) => notify(`user:${userId}`),
  };
}
