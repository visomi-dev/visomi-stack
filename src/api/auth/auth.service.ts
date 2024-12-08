import { HTTPException } from 'hono/http-exception';
import bcrypt from 'bcrypt';
import { OneTimeCodeType } from '@prisma/client';

import { SignUp } from './auth.dto';
import { sendTemporaryOtp } from './one-time-codes.service';

import { db } from '~/api/shared/db';
import { i18n } from '~/common';
import { logger } from '~/lib/logger';

export async function signUp({
  email,
  password,
  nickname,
  username,
  locale = i18n.DEFAULT_LOCALE,
}: SignUp): Promise<null> {
  const existingUser = await db.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new HTTPException(409, { message: 'USER_ALREADY_EXISTS' });
  }

  const hash = await bcrypt.hash(password, 10);

  const user = await db.user.create({
    data: {
      email,
      password: hash,
      nickname,
      username,
      preferences: {
        create: {
          locale,
        },
      },
    },
    include: {
      preferences: true,
    },
  });

  sendTemporaryOtp({
    userId: user.id,
    email: email,
    nickname: nickname!,
    locale: locale,
    type: OneTimeCodeType.SIGN_UP_CONFIRM,
  })
    .then(() => {
      logger.info(`Sent OTP to ${user.email}`);
    })
    .catch((error) => {
      logger.error(`Failed to send OTP to ${user.email}`);

      console.error(error);
    });

  return null;
}
