import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { routes } from './api.routes';

const api = new Hono();

api.use(cors());
api.use(logger());

routes.forEach(({ path, module }) => {
  api.route(path, module);
});

api.onError((error, ctx) => {
  if (error instanceof z.ZodError) {
    console.log('ZOD_ERROR');
    console.error(error);

    return ctx.json({ message: error.message, cause: error.errors }, 400);
  }

  if (error instanceof HTTPException) {
    console.log('HTTP_EXCEPTION');
    console.error(error);

    return error.getResponse();
  }

  console.log('UNEXPECTED_ERROR');
  console.error(error);

  return ctx.json({ message: 'An unexpected error occurred' }, 500);
});

export { api };
