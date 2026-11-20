import type { Session } from 'express-session';
import type { Socket } from 'socket.io';

type SocketSession = Session & { passport?: { user?: unknown }; csrf?: string };

export async function reloadSocketSession(socket: Pick<Socket, 'request'>) {
  const request = socket.request as Socket['request'] & { session?: SocketSession; sessionID?: string };

  if (!request.session || !request.sessionID) {
    return null;
  }

  await new Promise<void>((resolve, reject) =>
    request.session.reload((error: unknown) => (error ? reject(error) : resolve())),
  );

  return { id: request.sessionID, user: request.session.passport?.user, csrf: request.session.csrf };
}
