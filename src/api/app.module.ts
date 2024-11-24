import { resolve } from 'path';

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { I18nModule } from 'nestjs-i18n';
import { GoogleRecaptchaModule } from '@nestlab/google-recaptcha';

import { UserLocaleResolver } from './i18n/user-locale.resolver';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CaslModule } from './casl/casl.module';
import { redisConnection } from './redis/environment';
import { PrismaModule } from './prisma/prisma.module';
import { AppLoggerMiddleware } from './app-logger.middleware';

const isProduction = process.env['NODE_ENV'] === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      connection: redisConnection,
    }),
    EventEmitterModule.forRoot(),
    I18nModule.forRoot({
      fallbackLanguage: 'es-419',
      loaderOptions: {
        path: resolve(process.cwd(), 'dist/src/assets/i18n/'),
        watch: !isProduction,
      },
      typesOutputPath: resolve(
        process.cwd(),
        'src/api/generated/i18n.generated.ts',
      ),
      resolvers: [UserLocaleResolver],
    }),
    GoogleRecaptchaModule.forRoot({
      global: true,
      secretKey: process.env['GOOGLE_RECAPTCHA_SECRET_KEY'],
      response: (req) => req.headers.recaptcha,
      skipIf: () => !isProduction,
    }),

    PrismaModule,
    UsersModule,
    AuthModule,
    CaslModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AppLoggerMiddleware).forRoutes('*');
  }
}
