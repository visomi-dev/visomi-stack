import {
  decryptAead,
  deriveWorkspaceKey,
  encryptAead,
  assertCryptoProofVersion,
  NonceReuseGuard,
  unwrapWorkspaceKey,
  wrapWorkspaceKey,
} from './crypto-proof-harness';

const key = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
const nonce = Buffer.from('000000000000000000000000', 'hex');
const plaintext = Buffer.from('Hello, Themis.', 'utf8');
const aad = 'themis.encrypted-envelope:v1:project-context';

describe('cryptographic proof harness', () => {
  it('matches the deterministic AES-256-GCM known-answer vector', () => {
    const encrypted = encryptAead(key, nonce, plaintext, aad);

    expect(encrypted).toEqual({
      ciphertext: '86c22c51224c4b3a6f2ba8bac9dd',
      authTag: '37af4941e0a4699a193564cedfb4fa53',
    });
    expect(decryptAead(key, nonce, encrypted, aad)).toEqual(plaintext);
  });

  it('authenticates associated data and rejects tampering or a wrong key', () => {
    const encrypted = encryptAead(key, nonce, plaintext, aad);
    const tampered = { ...encrypted, ciphertext: `00${encrypted.ciphertext.slice(2)}` };
    const wrongKey = Buffer.alloc(32, 1);

    expect(() => decryptAead(key, nonce, encrypted, `${aad}:tampered`)).toThrow();
    expect(() => decryptAead(key, nonce, tampered, aad)).toThrow();
    expect(() => decryptAead(wrongKey, nonce, encrypted, aad)).toThrow();
  });

  it('derives and wraps a workspace key without putting key material in the fixture', () => {
    const vmk = Buffer.alloc(32, 7);
    const salt = Buffer.alloc(16, 3);
    const workspaceKey = deriveWorkspaceKey(vmk, 'workspace-001', salt);
    const wrapped = wrapWorkspaceKey(vmk, workspaceKey, nonce, 'workspace-001');

    expect(workspaceKey.toString('hex')).toBe('2b2ba7443a7bf67a0915b453420321b6e3a66b84c885b532fc5a1e1f517db54a');
    expect(wrapped).toEqual({
      nonce: '000000000000000000000000',
      ciphertext: '4af303f6c1e9fd92e8123b3786786a185e49c27dbb591e69ea4f9ed71e94af2c',
      authTag: 'a97e6fd81d01696acb967e1948d74658',
    });
    expect(unwrapWorkspaceKey(vmk, wrapped, 'workspace-001')).toEqual(workspaceKey);
    expect(() => unwrapWorkspaceKey(vmk, wrapped, 'workspace-002')).toThrow();
  });

  it.each([
    ['invalid key material', () => encryptAead(Buffer.alloc(31), nonce, plaintext, aad)],
    ['invalid nonce material', () => encryptAead(key, Buffer.alloc(11), plaintext, aad)],
    [
      'corrupted ciphertext',
      () => decryptAead(key, nonce, { ...encryptAead(key, nonce, plaintext, aad), ciphertext: '00' }, aad),
    ],
  ])('rejects %s', (_case, operation) => {
    expect(operation).toThrow();
  });

  it('makes nonce-reuse handling explicit and rejects version-domain mismatch', () => {
    const guard = new NonceReuseGuard();

    guard.accept(key, nonce);

    expect(() => guard.accept(key, nonce)).toThrow(/already used/);

    const encrypted = encryptAead(key, nonce, plaintext, 'themis.encrypted-envelope:v2:project-context');

    expect(() => decryptAead(key, nonce, encrypted, aad)).toThrow();
    expect(() => assertCryptoProofVersion(2)).toThrow(/Unsupported/);
    expect(() => assertCryptoProofVersion(1)).not.toThrow();
  });
});
