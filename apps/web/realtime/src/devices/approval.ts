import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { reloadSocketSession } from '../session/identity';

export type DeviceApprovalAccess = {
  watchExpiration(sessionId: string, requestId: string): Promise<number>;
};

const requestIdSchema = z.uuid();

export function attachDeviceApprovals(io: Server, access: DeviceApprovalAccess) {
  async function watchExpiration(socket: Socket, requestId: string): Promise<number> {
    const session = await reloadSocketSession(socket);

    return session ? access.watchExpiration(session.id, requestId) : 0;
  }

  io.use((socket, next) => {
    const requestId = requestIdSchema.safeParse(socket.handshake.auth['requestId']);

    if (!requestId.success) {
      next(new Error('subscription_unavailable'));

      return;
    }

    void watchExpiration(socket, requestId.data).then(
      (expiresAt) => {
        if (expiresAt <= Date.now()) {
          next(new Error('subscription_unavailable'));

          return;
        }

        socket.data.requestId = requestId.data;
        socket.data.expiresAt = expiresAt;
        next();
      },
      () => next(new Error('subscription_unavailable')),
    );
  });

  io.on('connection', (socket) => {
    void socket.join(socket.data.requestId);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now()));

    socket.once('disconnect', () => clearTimeout(expiry));
  });

  return async function notifyDeviceApproval(requestId: string): Promise<void> {
    await Promise.all(
      [...(io.sockets.adapter.rooms.get(requestId) ?? [])].map(async (socketId) => {
        const socket = io.sockets.sockets.get(socketId);

        if (!socket) {
          return;
        }

        try {
          const expiresAt = await watchExpiration(socket, requestId);

          if (expiresAt > Date.now() && socket.connected) {
            socket.emit('device-approval:changed');

            return;
          }
        } catch {
          // A revoked or unavailable session cannot receive the notice.
        }

        socket.disconnect(true);
      }),
    );
  };
}
