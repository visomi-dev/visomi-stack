import { APP_GUARD, Reflector } from '@nestjs/core';
import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';

import { UsersModule } from '../users/users.module';
import { EmailsModule } from '../emails/emails.module';

import { JWT_SECRET, TEMPORARY_ONE_TIME_CODES_QUEUE } from './auth.constants';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './local/local.strategy';
import { JwtStrategy } from './jwt/jwt.strategy';
import { JwtAuthGuard } from './jwt/jwt-auth.guard';
import { BcryptService } from './bcrypt/bcrypt.service';
import { OneTimeCodesService } from './one-time-codes/one-time-codes.service';

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
    BullModule.registerQueue({
      name: TEMPORARY_ONE_TIME_CODES_QUEUE,
    }),
    UsersModule,
    EmailsModule,
  ],
  providers: [
    BcryptService,
    AuthService,
    LocalStrategy,
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    OneTimeCodesService,
    Reflector,
  ],
  controllers: [AuthController],
  exports: [JwtModule, AuthService, LocalStrategy, JwtStrategy],
})
export class AuthModule {}
