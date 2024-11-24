import { PoliciesGuard } from './policies.guard';

describe('PoliciesGuard', () => {
  it('should be defined', () => {
    expect(new PoliciesGuard({} as never, {} as never)).toBeDefined();
  });
});
