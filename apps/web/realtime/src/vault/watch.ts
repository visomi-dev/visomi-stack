import type { Server, Socket } from 'socket.io';

import { reloadSocketSession } from '../session/identity';

export type VaultWatch = (session: { id: string; user: unknown; csrf?: string }, proof: unknown) => Promise<string>;

export function attachVaultWatch(io: Server, verify: VaultWatch) {
  const vault = io.of('/vault');

  async function scope(socket: Socket): Promise<string | undefined> {
    const session = await reloadSocketSession(socket);

    if (session) {
      return verify(session, socket.handshake.auth['proof']);
    }

    return undefined;
  }

  vault.use((socket, next) => {
    void scope(socket).then(
      (id) => {
        if (!id) {
          next(new Error('subscription_unavailable'));

          return;
        }

        socket.data.scopeId = id;
        next();
      },
      () => next(new Error('subscription_unavailable')),
    );
  });

  vault.on('connection', (socket) => void socket.join(socket.data.scopeId));

  return async (scopeId: string, cursor: number): Promise<void> => {
    await Promise.all(
      [...(vault.adapter.rooms.get(scopeId) ?? [])].map(async (id) => {
        const socket = vault.sockets.get(id);

        if (!socket) {
          return;
        }

        try {
          const current = await scope(socket);

          if (current === scopeId && socket.connected) {
            socket.emit('vault:changed', cursor);

            return;
          }
        } catch {
          // Current scope and device authority is required for every delivery.
        }

        socket.disconnect(false);
      }),
    );
  };
}
