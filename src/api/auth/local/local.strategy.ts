import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Strategy } from 'passport-local';

import { UserWithDependencies } from '../../users/entities/user.entity';
import { AuthService } from '../auth.service';
import { ErrorCodesEnum } from '../../../common/auth';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      usernameField: 'username',
      passwordField: 'password',
    });
  }

  async validate(
    username: string,
    password: string,
  ): Promise<UserWithDependencies | null> {
    const user = await this.authService.verifyCredentials(username, password);

    if (!user) {
      throw new UnauthorizedException(ErrorCodesEnum.INVALID_CREDENTIALS);
    }

    return user;
  }
}
