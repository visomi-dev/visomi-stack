import type { Server, Socket } from 'socket.io';

import { withCurrentSocketOwner } from '../shared/socket-authority';

import { notificationChannel, notificationHint, subscribeToJson } from 'shared';
import type { OperationOwner } from 'shared';

type Watch = { owner: OperationOwner | null; delivering: boolean };

function sameOwner(left: OperationOwner, right: OperationOwner): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.userId === right.userId &&
    left.accountId === right.accountId &&
    left.authVersion === right.authVersion
  );
}

/** One bounded, session-bound invalidation watch per socket; clients fetch authorized HTTP state. */
export async function subscribeToNotifications(io: Server): Promise<void> {
  const watchers = new Map<Socket, Watch>();
  const deliver = async (socket: Socket, watch: Watch) => {
    if (watch.delivering) return;
    watch.delivering = true;
    try {
      await withCurrentSocketOwner(socket, async (owner) => {
        if (!socket.connected || watchers.get(socket) !== watch) return;
        if (watch.owner && !sameOwner(watch.owner, owner)) throw new Error('Notification watch scope changed.');
        watch.owner = owner;
        socket.emit('notifications:changed', {});
      });
    } catch {
      watchers.delete(socket);
      socket.disconnect(true);
    } finally {
      watch.delivering = false;
    }
  };

  io.on('connection', (socket) => {
    socket.on('notifications:watch', () => {
      if (watchers.has(socket)) return;
      const watch: Watch = { owner: null, delivering: false };

      watchers.set(socket, watch);
      void deliver(socket, watch);
    });
    socket.on('notifications:unwatch', () => watchers.delete(socket));
    socket.on('disconnect', () => watchers.delete(socket));
  });
  const unsubscribe = await subscribeToJson<unknown>(notificationChannel, async (input) => {
    const hint = notificationHint.safeParse(input);

    if (!hint.success) return;
    await Promise.all(
      [...watchers]
        .filter(([, { owner }]) => owner?.accountId === hint.data.accountId && owner.userId === hint.data.userId)
        .map(([socket, watch]) => deliver(socket, watch)),
    );
  });

  io.httpServer.once('close', () => {
    unsubscribe();
    watchers.clear();
  });
}
