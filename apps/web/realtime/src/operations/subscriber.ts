import type { Server, Socket } from 'socket.io';

import { withCurrentSocketOwner } from '../shared/socket-authority';

import { operationChannel, operationIdInput, readOperation, subscribeToJson } from 'shared';

export async function subscribeToOperations(io: Server): Promise<void> {
  const watchers = new Map<Socket, Set<string>>();
  const deliver = async (socket: Socket, operationId: string) => {
    try {
      await withCurrentSocketOwner(socket, async (owner) => {
        const event = await readOperation(operationId, owner);

        if (!socket.connected || !watchers.get(socket)?.has(operationId)) return;
        if (!event) {
          socket.emit('operation:changed', { operationId, status: 'failed' });
          watchers.get(socket)?.delete(operationId);

          return;
        }
        socket.emit('operation:changed', event);
        if (event.status === 'completed' || event.status === 'failed') watchers.get(socket)?.delete(operationId);
      });
    } catch {
      socket.disconnect(true);
    }
  };

  io.on('connection', (socket) => {
    watchers.set(socket, new Set());
    socket.on('operation:watch', (input: unknown) => {
      const parsed = operationIdInput.safeParse(input);
      const ids = watchers.get(socket);

      if (!parsed.success || !ids || (ids.size >= 8 && !ids.has(parsed.data.operationId))) return;
      ids.add(parsed.data.operationId);
      void deliver(socket, parsed.data.operationId);
    });
    socket.on('operation:unwatch', (input: unknown) => {
      const parsed = operationIdInput.safeParse(input);

      if (parsed.success) watchers.get(socket)?.delete(parsed.data.operationId);
    });
    socket.on('disconnect', () => watchers.delete(socket));
  });
  const unsubscribe = await subscribeToJson<unknown>(operationChannel, async (input) => {
    const parsed = operationIdInput.safeParse(input);

    if (!parsed.success) return;
    await Promise.all(
      [...watchers]
        .filter(([, ids]) => ids.has(parsed.data.operationId))
        .map(([socket]) => deliver(socket, parsed.data.operationId)),
    );
  });

  io.httpServer.once('close', () => {
    unsubscribe();
    watchers.clear();
  });
}
