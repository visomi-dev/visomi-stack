import { createDocument } from 'zod-openapi';

import {
  accountPaths,
  emailChangeSchema,
  emailVerifySchema,
  leaveWorkspaceSchema,
  profileUpdateSchema,
  transferOwnershipSchema,
} from './account-schemas';

describe('account profile contracts', () => {
  it('allows only display name and supported preferences', () => {
    expect(profileUpdateSchema.parse({ displayName: ' Ada ', preferences: { locale: 'es', theme: 'system' } })).toEqual(
      { displayName: 'Ada', preferences: { locale: 'es', theme: 'system' } },
    );
    expect(
      profileUpdateSchema.safeParse({ displayName: 'Ada', preferences: { locale: 'fr', theme: 'dark' } }).success,
    ).toBe(false);
    expect(
      profileUpdateSchema.safeParse({
        displayName: 'Ada',
        preferences: { locale: 'en', theme: 'dark' },
        email: 'unverified@example.test',
      }).success,
    ).toBe(false);
    expect(
      profileUpdateSchema.safeParse({ displayName: 'x'.repeat(101), preferences: { locale: 'en', theme: 'dark' } })
        .success,
    ).toBe(false);
  });

  it('requires sensitive-operation grants and rejects caller-controlled tenant selection', () => {
    expect(
      profileUpdateSchema.safeParse({
        displayName: 'Ada',
        preferences: { locale: 'en', theme: 'system' },
        preferencesConfigured: false,
      }).success,
    ).toBe(false);
    expect(emailChangeSchema.safeParse({ email: 'new@example.test' }).success).toBe(false);
    expect(leaveWorkspaceSchema.safeParse({ grantId: 'grant', accountId: 'someone-else' }).success).toBe(false);
    expect(transferOwnershipSchema.safeParse({ grantId: 'grant', targetUserId: '' }).success).toBe(false);
    expect(emailChangeSchema.parse({ grantId: 'grant', email: 'NEW@EXAMPLE.TEST' }).email).toBe('new@example.test');
  });

  it('requires a six-digit proof and a valid flow identifier', () => {
    expect(emailVerifySchema.safeParse({ flowId: 'bad-id', pin: '123456' }).success).toBe(false);
    expect(emailVerifySchema.safeParse({ flowId: 'c9b3a83a-084f-4fb8-a03e-d3428a046a26', pin: 'abcdef' }).success).toBe(
      false,
    );
    expect(emailVerifySchema.safeParse({ flowId: 'c9b3a83a-084f-4fb8-a03e-d3428a046a26', pin: '123456' }).success).toBe(
      true,
    );
  });

  it('documents metadata export and selected-workspace departure without a global deletion endpoint', () => {
    const document = createDocument({
      openapi: '3.1.0',
      info: { title: 'Account', version: '1' },
      paths: accountPaths,
    });

    expect(document.paths?.['/account/export']?.get?.description).toContain('No credentials');
    expect(document.paths?.['/account/workspace/leave']?.post).toBeDefined();
    expect(Object.values(document.paths ?? {}).some((path) => path?.delete)).toBe(false);
  });
});
