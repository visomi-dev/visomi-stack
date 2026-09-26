import { generate } from 'otplib';

import { verifyTotpCode } from './totp';

describe('TOTP replay timestep binding', () => {
  it('validates only the exact timestep persisted for replay protection', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const timeStep = 60_000_000;
    const code = await generate({ secret, epoch: timeStep * 30 });

    await expect(verifyTotpCode(secret, code, timeStep)).resolves.toBe(true);
    await expect(verifyTotpCode(secret, code, timeStep + 1)).resolves.toBe(false);
    await expect(verifyTotpCode(secret, code, timeStep - 1)).resolves.toBe(false);
  });
});
