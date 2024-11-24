import { Injectable, NotFoundException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { JWT_SECRET } from '../auth.constants';
import { UserWithDependencies } from '../../users/entities/user.entity';
import { INVALID_USER } from '../../../common/auth';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: { sub: string }): Promise<UserWithDependencies> {
    const user = await this.usersService.findOne({
      id: payload.sub,
    });

    if (!user) {
      throw new NotFoundException(INVALID_USER);
    }

    return user;
  }
}
