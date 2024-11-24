import { Module } from '@nestjs/common';

import { AuthEmailsService } from './auth/auth.service';

@Module({
  providers: [AuthEmailsService],
  exports: [AuthEmailsService],
})
export class EmailsModule {}
