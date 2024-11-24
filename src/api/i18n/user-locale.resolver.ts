import { Injectable, ExecutionContext } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';

import { UserWithDependenciesEntity } from '../users/entities/user.entity';

@Injectable()
export class UserLocaleResolver implements I18nResolver {
  resolve(context: ExecutionContext): string | undefined {
    const user = context.switchToHttp().getRequest()
      .user as UserWithDependenciesEntity;

    return user?.preferences?.locale;
  }
}
