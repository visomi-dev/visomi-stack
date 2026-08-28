import type { Server } from 'socket.io';

import { subscribeToProjectAsyncJobEvents } from 'projects';

async function subscribeToProjectSeedEvents(io: Server) {
  await subscribeToProjectAsyncJobEvents(async (event) => {
    io.to(`user:${event.job.userId}`).emit(event.eventName, event);
  });
}

export { subscribeToProjectSeedEvents };
