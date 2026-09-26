import type { Request } from 'express';

export async function saveSession(req: Pick<Request, 'session'>): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

export async function regenerateSession(req: Pick<Request, 'session'>): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}
