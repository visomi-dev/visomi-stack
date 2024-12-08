import bcrypt from 'bcrypt';
import { OneTimeCodeType } from '@prisma/client';

import { ses } from '../shared/aws';

import { otpQueue } from './auth.queue';

import { i18n, utils } from '~/common';
import assets from '~/api/assets';
import { db } from '~/api/shared/db';
import { logger } from '~/lib/logger';

const FIVE_MINUTES = 1000 * 60 * 5;

export async function sendTemporaryOtp({
  userId,
  email,
  nickname,
  locale,
  type: otpType,
}: {
  userId: string;
  email: string;
  nickname: string;
  locale: i18n.Locale;
  type: OneTimeCodeType;
}) {
  const templateName =
    otpType === OneTimeCodeType.SIGN_UP_CONFIRM ? 'signUp' : 'forgotPassword';

  const template =
    assets.emails.verificationCodeTemplates[locale][templateName];
  const { from, ...data } = assets.i18n.emails.signUp[locale];
  const code = utils.generateCode(6);

  const hash = await bcrypt.hash(code, 10);

  try {
    const { id } = await db.oneTimeCode.upsert({
      create: {
        userId,
        code: hash,
        type: otpType,
      },
      update: {
        code: hash,
      },
      where: {
        userAndType: {
          userId,
          type: otpType,
        },
      },
    });

    await ses.sendTemplatedEmail({
      template,
      to: email,
      from,
      data: {
        ...data,
        preview: data.preview.replace('{{name}}', nickname),
        greetings: data.greetings.replace('{{name}}', nickname),
        code,
      },
    });

    await otpQueue.add(id, { id }, { delay: FIVE_MINUTES });
  } catch (error: unknown) {
    console.error(error);

    logger.error((error as Error).message);
  }
}
