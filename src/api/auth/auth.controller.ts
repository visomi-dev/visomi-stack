import { Hono } from 'hono';

import { HonoEnv } from '../typings';

import { signUpSchema, type SignUp } from './auth.dto';
import { signUp } from './auth.service';

const auth = new Hono<HonoEnv>();

auth.post('/sign-up', async (ctx) => {
  const body = await ctx.req.json<SignUp>();

  const data = await signUp(signUpSchema.parse(body));

  return ctx.json({ message: 'SIGN_UP_COMPLETE', data }, 201);
});

export default auth;
