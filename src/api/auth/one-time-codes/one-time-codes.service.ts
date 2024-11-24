import { Queue, Worker, Job } from 'bullmq';
import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OneTimeCodeType } from '@prisma/client';

import { TEMPORARY_ONE_TIME_CODES_QUEUE } from '../auth.constants';
import { redisConnection } from '../../redis/environment';
import { PrismaService } from '../../prisma/prisma.service';
import { BcryptService } from '../bcrypt/bcrypt.service';
import { generateCode } from '../../../common/utils';
import { ErrorCodesEnum } from '../../../common/auth';

type JobData = {
  oneTimeCode: string;
};

@Injectable()
export class OneTimeCodesService implements OnModuleInit, OnModuleDestroy {
  queue = new Queue<JobData>(TEMPORARY_ONE_TIME_CODES_QUEUE, {
    connection: redisConnection,
  });
  worker = new Worker<JobData>(
    TEMPORARY_ONE_TIME_CODES_QUEUE,
    this.deleteTemporaryCode.bind(this),
    {
      connection: redisConnection,
    },
  );

  timeOut = 1000 * 60 * 5;

  constructor(
    private readonly bcryptService: BcryptService,
    private readonly prismaService: PrismaService,
  ) {}

  async getTemporaryCode(type: OneTimeCodeType, user: string): Promise<string> {
    const code = generateCode(5);

    const encryptedCode = await this.bcryptService.hash(code);

    const oneTimeCode = await this.prismaService.oneTimeCode.upsert({
      where: { userAndType: { type, userId: user } },
      update: {
        code: encryptedCode,
      },
      create: {
        type,
        code: encryptedCode,
        userId: user,
      },
    });

    await this.queue.add(
      type,
      { oneTimeCode: oneTimeCode.id },
      { delay: this.timeOut },
    );

    return code;
  }

  async verify(
    oneTimeCode: string,
    code: string,
    encryptedCode: string,
  ): Promise<void> {
    const verified = await this.bcryptService.compare(code, encryptedCode);

    if (!verified) {
      throw new ForbiddenException(ErrorCodesEnum.INVALID_CODE);
    }

    await this.prismaService.oneTimeCode.delete({
      where: { id: oneTimeCode },
    });
  }

  async deleteTemporaryCode(job: Job<JobData>): Promise<void> {
    await this.prismaService.oneTimeCode.delete({
      where: { id: job.data.oneTimeCode },
    });
  }

  async onModuleInit() {
    await this.prismaService.oneTimeCode.deleteMany();
  }

  async onModuleDestroy() {
    await this.prismaService.oneTimeCode.deleteMany();
  }
}
