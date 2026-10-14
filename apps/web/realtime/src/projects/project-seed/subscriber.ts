import type { Server } from 'socket.io';

import { withCurrentSocketOwner } from '../../shared/socket-authority';

import { getProject, subscribeToProjectAsyncJobEvents } from 'projects';

async function subscribeToProjectSeedEvents(io: Server) {
  const unsubscribe = await subscribeToProjectAsyncJobEvents(async (event) => {
    await Promise.all(
      [...io.sockets.sockets.values()]
        .filter((socket) => socket.data.userId === event.job.userId)
        .map(async (socket) => {
          try {
            await withCurrentSocketOwner(socket, async (owner) => {
              if (!socket.connected || owner.userId !== event.job.userId || !event.job.projectId) return;
              if (await getProject(owner, event.job.projectId)) socket.emit(event.eventName, event);
            });
          } catch {
            socket.disconnect(true);
          }
        }),
    );
  });

  io.httpServer.once('close', () => {
    unsubscribe();
  });
}

export { subscribeToProjectSeedEvents };
