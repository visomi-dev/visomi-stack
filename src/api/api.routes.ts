import { Hono } from 'hono';

import { HonoEnv } from './typings';
import auth from './auth/auth.controller';

export const routes = Object.freeze<
  {
    path: string;
    module: Hono<HonoEnv>;
  }[]
>([
  {
    path: '/api/auth',
    module: auth,
  },
]);
