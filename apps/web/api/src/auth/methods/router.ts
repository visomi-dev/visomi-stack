import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import { getMethods } from './controller';

export function createMethodRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.get('/methods', (request, response) => getMethods(auth, request, response));

  return router;
}
