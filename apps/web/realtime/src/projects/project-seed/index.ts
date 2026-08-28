import type { Server } from 'socket.io';

import { subscribeToProjectSeedEvents } from './subscriber';

async function startRealtime(io: Server) {
  await subscribeToProjectSeedEvents(io);
}

export { startRealtime };
