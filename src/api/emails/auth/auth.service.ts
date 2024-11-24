import { readFileSync } from 'fs';
import { resolve } from 'path';

import Handlebars from 'handlebars';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { OneTimeCodeType } from '@prisma/client';

import { I18nTranslations } from '../../generated/i18n.generated';
import { UserWithDependenciesEntity } from '../../users/entities/user.entity';
import { DEFAULT_LOCALE } from '../../../common/i18n';
import { INVALID_CODE_TYPE } from '../../../common/auth';

@Injectable()
export class AuthEmailsService {
  private signInCodeTemplate = Handlebars.compile(
    readFileSync(
      resolve(process.cwd(), 'dist/src/assets/emails/password-recovery.hbs'),
      'utf8',
    ),
  );

  constructor(private readonly i18nService: I18nService<I18nTranslations>) {}

  async sendVerificationCode({
    user,
    code,
    type,
  }: {
    user: UserWithDependenciesEntity;
    code: string;
    type: OneTimeCodeType;
  }) {
    let translation: {
      from: string;
      subject: string;
      title: string;
      preview: string;
      greetings: string;
      instructions: string;
    };

    const i18nOptions = {
      lang: user?.preferences?.locale.toLowerCase() ?? DEFAULT_LOCALE,
      args: {
        domain: process.env['APP_DOMAIN'],
        name: user.name,
      },
    };

    switch (type) {
      case 'PASSWORD_RECOVERY':
        translation = this.i18nService.translate(
          'auth-emails.passwordRecovery',
          i18nOptions,
        );

        break;
      default:
        throw new BadRequestException(INVALID_CODE_TYPE);
    }

    const mail = {
      to: user.email,
      from: translation.from,
      subject: translation.subject,
      html: this.signInCodeTemplate({
        title: translation.title,
        preview: translation.preview,
        greetings: translation.greetings,
        instructions: translation.instructions,
        code,
      }),
    };

    Logger.debug({
      to: user.email,
      from: translation.from,
      subject: translation.subject,
    });

    // TODO: implement email sending

    console.log(mail);
  }
}
