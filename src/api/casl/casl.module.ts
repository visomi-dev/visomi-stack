import { Global, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UsersModule } from '../users/users.module';

import { CaslAbilityFactory } from './casl-ability.factory';
import { PoliciesGuard } from './policies.guard';

@Global()
@Module({
  providers: [CaslAbilityFactory, PoliciesGuard, Reflector],
  exports: [CaslAbilityFactory, PoliciesGuard],
  imports: [UsersModule],
})
export class CaslModule {}
