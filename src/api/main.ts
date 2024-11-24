import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Express } from 'express';

import { AppModule } from './app.module';
import { config } from './app.config';

export default async function bootstrap(express: Express) {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(express));

  await config(app);

  await app.init();

  return express;
}
