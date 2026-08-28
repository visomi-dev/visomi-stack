import { credentialMutationSchema, credentialRenameSchema } from './passkey-schemas';

describe('passkey management schemas', () => {
  it('accepts recognizable labels and trims surrounding whitespace', () => {
    expect(credentialRenameSchema.parse({ label: '  Home laptop  ' })).toEqual({ label: 'Home laptop' });
  });

  it('rejects secrets and control characters in labels', () => {
    expect(credentialRenameSchema.safeParse({ label: 'Home\nlaptop' }).success).toBe(false);
    expect(credentialRenameSchema.safeParse({ label: 'PIN: 1234' }).success).toBe(false);
    expect(credentialMutationSchema.safeParse({ action: 'revoke' }).success).toBe(true);
  });
});
