import { Test, TestingModule } from '@nestjs/testing';

import { OneTimeCodesService } from './one-time-codes.service';

describe('OneTimeCodesService', () => {
  let service: OneTimeCodesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OneTimeCodesService],
    }).compile();

    service = module.get<OneTimeCodesService>(OneTimeCodesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
