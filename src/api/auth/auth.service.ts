import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { UserWithDependencies } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

import { AuthResult } from './entities/auth.entity';
import { BcryptService } from './bcrypt/bcrypt.service';

import { auth } from '~/common';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly bcryptService: BcryptService,
    private readonly usersService: UsersService,
  ) {}

  async verifyCredentials(username: string, password: string) {
    const user = await this.usersService.findOne({
      username,
    });

    if (!user) {
      throw new NotFoundException(auth.INVALID_USER);
    }

    const isPasswordValid = await this.bcryptService.compare(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new NotFoundException(auth.INVALID_USER);
    }

    return user;
  }

  async signIn(user: UserWithDependencies): Promise<AuthResult> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
    });

    return {
      user,
      session: {
        accessToken,
      },
    };
  }

  refreshAccessToken(user: UserWithDependencies) {
    return this.jwtService.sign({
      sub: user.id,
    });
  }
}
