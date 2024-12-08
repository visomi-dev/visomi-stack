import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';

import { auth } from '~/common';
import { HonoEnv } from '~/api/typings';
import { db } from '~/api/shared/db';
import { logger } from '~/lib/logger';

if (!process.env['JWT_ACCESS_SECRET']) {
  throw new Error('JWT_ACCESS_SECRET is required');
}

export const userAuth = ({ roles }: { roles: auth.Role[] }) =>
  createMiddleware<HonoEnv>(async function authMiddleware(ctx, next) {
    logger.debug('Checking authorization...');

    const authorization = ctx.req.header('Authorization');

    if (!authorization) {
      logger.debug('Unauthorized: No Authorization header found.');

      return ctx.json({ message: 'Unauthorized' }, 401);
    }

    const [, token] = authorization.split(' ');

    let claims: Record<string, unknown>;

    try {
      logger.debug('Verifying JWT...');

      claims = await verify(token, process.env['JWT_ACCESS_SECRET']!);
    } catch (error) {
      logger.debug('Unauthorized: Invalid JWT.');

      console.error(error);

      return ctx.json({ message: 'Unauthorized' }, 401);
    }

    logger.debug('JWT verified. Getting user...');

    const user = await db.user.findUnique({
      where: { id: claims['sub'] as string },
      include: {
        preferences: true,
      },
    });

    if (!user) {
      logger.debug('Unauthorized: User not found.');

      return ctx.json({ message: 'Unauthorized' }, 401);
    }

    if (user.role === null) {
      user.role = auth.CUSTOMER_ROLE;
    }

    if (!roles.includes(user.role)) {
      logger.debug('Unauthorized: User role does not match.');

      return ctx.json({ message: 'Forbidden bad auth' }, 403);
    }

    ctx.set('user', user as HonoEnv['Variables']['user']);

    logger.debug('User found. Authorized.');

    return await next();
  });
