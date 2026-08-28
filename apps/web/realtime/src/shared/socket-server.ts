import { createServer, type Server as HttpServer } from 'node:http';

import express from 'express';
import { Server } from 'socket.io';

import { bindSocketSession } from './socket-auth';

import { env, logger } from 'shared';

async function attachRealtimeServer(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      credentials: true,
      origin: env.APP_BASE_URL,
    },
    path: env.REALTIME_PATH,
  });

  bindSocketSession(io.engine);

  io.use((socket, next) => {
    const request = socket.request as typeof socket.request & {
      session?: { passport?: { user?: { id?: string } } };
    };

    const userId = request.session?.passport?.user?.id;

    if (!userId) {
      next(new Error('Unauthorized'));

      return;
    }

    socket.data.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
  });

  logger.info({ path: env.REALTIME_PATH }, 'Realtime runtime ready');

  return io;
}

async function createRealtimeServer() {
  const app = express();

  const server = createServer(app);

  const io = await attachRealtimeServer(server);

  app.get('/health', (_req, res) => {
    res.send({ status: 'ok' });
  });

  return { app, io, server };
}

export { attachRealtimeServer, createRealtimeServer };
