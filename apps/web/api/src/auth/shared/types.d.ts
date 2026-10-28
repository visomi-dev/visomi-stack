/* eslint-disable @typescript-eslint/consistent-type-definitions -- Declaration merging is required. */
import 'express-session';
import 'passport';
import type { Principal } from './identity';

declare module 'express-session' {
  interface SessionData {
    csrf?: string;
    passport?: { user: Express.User };
  }
}
declare global {
  namespace Express {
    interface User extends Partial<Omit<Principal, 'id' | 'authenticatedAt'>> {
      id: string;
      authenticatedAt: number;
    }
  }
}
