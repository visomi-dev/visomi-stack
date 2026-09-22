import { managedSessionFixture } from '../testing/managed-session-fixture';

import { clearWebAuthnMetadata, webAuthnRouter } from './webauthn-router';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});

jest.mock('projects', () => ({
  getProject: jest.fn(async (context: { accountId: string }, projectId: string) =>
    context.accountId === 'account-a' && projectId === 'workspace-a' ? { id: projectId } : null,
  ),
}));

const authenticatedAgent = managedSessionFixture();

function createApp(accountId = 'account-a') {
  return authenticatedAgent('/webauthn', webAuthnRouter, accountId, `${accountId}-user`);
}

const credential = {
  credentialId: 'AQIDBA',
  rpId: 'example.test',
  origin: 'https://example.test',
  prfSupported: true,
  transports: ['internal'],
};

beforeEach(() => clearWebAuthnMetadata());
afterEach(() => clearWebAuthnMetadata());

describe('authenticated WebAuthn metadata API', () => {
  it('registers, queries, and revokes credential metadata without secret material', async () => {
    const app = await createApp();
    const registered = await app.post('/webauthn/workspace-a/credentials').send(credential);

    expect(registered.status).toBe(201);
    expect(registered.body.data).toEqual(expect.objectContaining({ ...credential, status: 'active' }));
    expect(JSON.stringify(registered.body)).not.toContain('privateKey');
    expect(JSON.stringify(registered.body)).not.toContain('prf-output');

    const listed = await app.get('/webauthn/workspace-a/credentials');

    expect(listed.status).toBe(200);
    expect(listed.body.data.credentials).toHaveLength(1);

    const revoked = await app.delete('/webauthn/workspace-a/credentials/AQIDBA');

    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('revoked');
  });

  it('isolates tenants and rejects malformed credential identifiers', async () => {
    const app = await createApp();
    const malformed = await app
      .post('/webauthn/workspace-a/credentials')
      .send({ ...credential, credentialId: 'not canonical!' });

    expect(malformed.status).toBe(400);

    const otherTenant = await (await createApp('account-b')).get('/webauthn/workspace-a/credentials');

    expect(otherTenant.status).toBe(404);
    expect(otherTenant.body).toEqual({ code: 'workspace_not_found', message: 'The workspace could not be found.' });
  });

  it('makes recovery metadata single-use and revocable without accepting recovery material', async () => {
    const app = await createApp();
    const enrolled = await app.post('/webauthn/workspace-a/recovery').send({ requestId: 'enroll-1', confirmed: true });

    expect(enrolled.status).toBe(201);
    expect(enrolled.body.data).not.toHaveProperty('material');

    const recoveryId = enrolled.body.data.recoveryId as string;
    const used = await app
      .post(`/webauthn/workspace-a/recovery/${recoveryId}/use`)
      .send({ requestId: 'use-1', confirmed: true });

    expect(used.status).toBe(200);
    expect(used.body.data.status).toBe('used');

    const replay = await app
      .post(`/webauthn/workspace-a/recovery/${recoveryId}/use`)
      .send({ requestId: 'use-2', confirmed: true });

    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({
      code: 'webauthn_recovery_unavailable',
      message: 'The recovery operation is unavailable.',
    });

    const second = await app.post('/webauthn/workspace-a/recovery').send({ requestId: 'enroll-2', confirmed: true });
    const revoked = await app.delete(`/webauthn/workspace-a/recovery/${second.body.data.recoveryId}`);

    expect(revoked.body.data.status).toBe('revoked');
  });
});
