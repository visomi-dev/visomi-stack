/* eslint-disable @typescript-eslint/consistent-type-definitions -- Declaration merging is required. */
import 'express-session';
import 'passport';

declare module 'express-session' {
  type SessionUser = { id: string; credentialId: string; authenticatedAt: number };
  interface SessionData {
    csrf?: string;
    passport?: { user: SessionUser };
  }
}

declare global {
  namespace Express {
    interface User {
      id: string;
      credentialId: string;
      authenticatedAt: number;
    }
  }
}
