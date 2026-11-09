import type { Server as HttpServer } from 'node:http';

import type { RealtimeRuntime } from '@visomi-stack/backend-shared';
import type { Request, RequestHandler, Response } from 'express';
import { Server } from 'socket.io';

import { attachDeviceApprovals, type DeviceApprovalAccess } from './devices/approval';
import { attachSessionChannel, type ReadSessionUser } from './session/channel';

export type RealtimeAccess = DeviceApprovalAccess & {
  origin: string;
  readSession: RequestHandler;
  readUser: ReadSessionUser;
};

export function attachRealtimeServer(server: HttpServer, access: RealtimeAccess): RealtimeRuntime {
  const origin = new URL(access.origin).origin;
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    transports: ['websocket'],
    allowRequest: (request, next) => next(null, request.headers.origin === origin),
    maxHttpBufferSize: 4096,
    connectTimeout: 5000,
  });

  io.engine.use((request, response, next) => {
    // Engine.IO handles the upgrade before Express, so apply signed-cookie session middleware here.
    access.readSession(request as Request, response as Response, next);
  });
  const notifyDeviceApproval = attachDeviceApprovals(io, access);
  const session = attachSessionChannel(io, access.readUser);

  return {
    ...session,
    notifyDeviceApproval,
    async close(): Promise<void> {
      await io.close();
    },
  };
}
