import { Router } from 'express';

import { listPrototypes } from './index';

export function manifestRouter(): Router {
  const router = Router();

  router.get('/prototypes', async (_req, res) => {
    const prototypes = await listPrototypes();

    res.json({ prototypes });
  });

  return router;
}
