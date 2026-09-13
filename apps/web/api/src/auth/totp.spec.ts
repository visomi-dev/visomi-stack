import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpCode } from './totp';

jest.mock('otplib', () => ({
  generateSecret(): string {
    return 'TESTSECRET';
  },
  verify(): Promise<{ valid: boolean }> {
    return Promise.resolve({ valid: true });
  },
}));

describe('TOTP protection', () => {
  it('round-trips encrypted secrets without exposing plaintext storage', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted, 1)).toBe(secret);
  });

  it('accepts a code through the otplib adapter', async () => {
    const secret = generateTotpSecret();

    await expect(verifyTotpCode(secret, '123456')).resolves.toBe(true);
  });
});
