import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import express, { json, type Request } from 'express';
import request from 'supertest';

import { capabilityRouter, createLocalAgentProof, createWebSessionProof } from './capability-router';
import { modeNegotiationRequestSchema } from './capability-schemas';

import { deviceIdentityStore, errorHandler } from 'shared';

jest.mock('projects', () => ({
  getProject: jest.fn(async (context: { accountId: string }, projectId: string) =>
    context.accountId === 'account-a' && projectId === 'workspace-a' ? { id: projectId } : null,
  ),
}));

function createApp(accountId = 'account-a', userId = 'user-a') {
  const app = express();

  app.use(json());
  app.use((req: Request, _res, next) => {
    req.user = { id: userId, accountId, role: 'owner' } as Express.User;
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
    next();
  });
  app.use('/capabilities', capabilityRouter);
  app.use(errorHandler);

  return app;
}

function negotiation(overrides: Record<string, unknown> = {}) {
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

  const body = {
    format: 'themis.mode-negotiation-request',
    requestId: `request-${Math.random()}`,
    clientId: 'client-a',
    clientProfile: 'web-local-agent',
    supportedModes: ['local-agent', 'webcrypto'],
    supportedVersions: [1],
    requestedCapabilities: ['projection'],
    preferredMode: 'local-agent',
    allowDowngrade: false,
    claim: {
      format: 'themis.client-capability',
      version: 1,
      claimId: `claim-${Math.random()}`,
      clientId: 'client-a',
      clientProfile: 'web-local-agent',
      accountId: 'account-a',
      workspaceId: 'workspace-a',
      capabilities: ['projection'],
      issuedAt,
      expiresAt,
      authenticator: { scheme: 'web-session', keyId: 'user-a', proof: 'session-bound' },
    },
    ...overrides,
  };

  body.claim.authenticator.proof = createWebSessionProof(body.claim as never);

  return body;
}

function enrollLocalAgent(
  workspaceId = 'workspace-a',
  accountId = 'account-a',
): {
  deviceId: string;
  privateKey: KeyObject;
} {
  const owner = generateKeyPairSync('ed25519');
  const device = generateKeyPairSync('ed25519');
  const ownerIdentity = deviceIdentityStore.createIdentity(
    accountId,
    owner.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    'Owner',
    new Date(),
    workspaceId,
  );
  const identity = deviceIdentityStore.createIdentity(
    accountId,
    device.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    'Laptop',
  );

  deviceIdentityStore.approveWorkspace(accountId, workspaceId, ownerIdentity.deviceId);
  deviceIdentityStore.enrollDevice(accountId, identity.deviceId, workspaceId, ownerIdentity.deviceId, {
    associatedData: { purpose: 'workspace-key-distribution', workspace: workspaceId },
    authTag: 'tag',
    ciphertext: 'wrapped-workspace-key',
    createdAt: '2026-08-17T22:00:00.000Z',
    envelopeId: `key-${identity.deviceId}`,
    format: 'themis.encrypted-envelope',
    kind: 'sync-object',
    metadata: { recipientDeviceId: identity.deviceId },
    nonce: 'nonce',
    recordType: 'workspace-key-distribution',
    revision: 1,
    version: 1,
    workspaceId,
  });

  return { deviceId: identity.deviceId, privateKey: device.privateKey };
}

beforeEach(() => deviceIdentityStore.clear());
afterEach(() => deviceIdentityStore.clear());

describe('capability discovery and negotiation API', () => {
  it('discovers profiles only after workspace authorization', async () => {
    const response = await request(createApp()).get('/capabilities/workspace-a');

    expect(response.status).toBe(200);
    expect(response.body.data.profiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ profile: 'web-webcrypto' })]),
    );
    expect(JSON.stringify(response.body)).not.toContain('plaintext');
  });

  it('negotiates a compatible mode and rejects replay', async () => {
    const body = negotiation();
    const app = createApp();
    const response = await request(app).post('/capabilities/workspace-a').send(body);

    expect(response.status).toBe(200);
    expect(response.body.data.selectedMode).toBe('local-agent');

    const replay = await request(app).post('/capabilities/workspace-a').send(body);

    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({
      code: 'capability_unavailable',
      message: 'The capability negotiation request was rejected.',
    });
  });

  it('negotiates over HTTP with a real enrolled Ed25519 device identity', async () => {
    const device = enrollLocalAgent();
    const body = negotiation({
      clientId: device.deviceId,
      claim: {
        ...negotiation().claim,
        clientId: device.deviceId,
        authenticator: { scheme: 'local-agent-signature', keyId: device.deviceId, proof: 'ed25519:pending' },
      },
    });

    body.claim.authenticator.proof = createLocalAgentProof(body.claim as never, device.privateKey);

    const response = await request(createApp()).post('/capabilities/workspace-a').send(body);

    expect(response.status).toBe(200);
    expect(response.body.data.selectedMode).toBe('local-agent');
  });

  it('rejects a tampered Ed25519 signature and never falls back to a valid grant', async () => {
    const device = enrollLocalAgent();
    const body = negotiation({
      clientId: device.deviceId,
      claim: {
        ...negotiation().claim,
        clientId: device.deviceId,
        authenticator: { scheme: 'local-agent-signature', keyId: device.deviceId, proof: 'ed25519:pending' },
      },
    });
    const proof = createLocalAgentProof(body.claim as never, device.privateKey);

    const encoded = proof.slice('ed25519:'.length);
    const base64UrlAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const lastCharacter = encoded[encoded.length - 1];
    const lastCharacterIndex = base64UrlAlphabet.indexOf(lastCharacter);
    const alternateTrailingBits = base64UrlAlphabet[lastCharacterIndex ^ 1];

    // Ed25519 signatures are 64 bytes, so the final base64url character has
    // unused low bits. Before canonical decoding, toggling those bits leaves
    // the decoded signature unchanged and could incorrectly preserve a grant.
    body.claim.authenticator.proof = `ed25519:${encoded.slice(0, -1)}${alternateTrailingBits}`;

    const response = await request(createApp()).post('/capabilities/workspace-a').send(body);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      code: 'capability_unauthenticated',
      message: 'The capability negotiation request was rejected.',
    });
  });

  it('rejects scalar JSON bodies instead of treating them as negotiation requests', async () => {
    const response = await request(createApp())
      .post('/capabilities/workspace-a')
      .set('Content-Type', 'application/json')
      .send('0');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'invalid_request',
      message: 'The request payload is invalid.',
    });
    expect(modeNegotiationRequestSchema.safeParse(0).success).toBe(false);
  });

  it('rejects unknown request fields instead of stripping them', async () => {
    const response = await request(createApp())
      .post('/capabilities/workspace-a')
      .send({ ...negotiation(), unexpected: true });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_request');
    expect(response.body.message).toContain('Unrecognized key');
  });

  it.each([
    [
      'cross-workspace claim',
      { claim: { ...negotiation().claim, workspaceId: 'other-workspace' } },
      'capability_ambiguous-identity',
    ],
    ['unsupported version', { supportedVersions: [2] }, 'capability_unsupported-version'],
    [
      'invalid authenticator',
      { claim: { ...negotiation().claim, authenticator: { scheme: 'web-session', keyId: 'other-user', proof: 'x' } } },
      'capability_unauthenticated',
    ],
    [
      'unsafe downgrade',
      { supportedModes: ['webcrypto'], preferredMode: 'local-agent', allowDowngrade: false },
      'capability_unsafe-downgrade',
    ],
  ] as const)('fails closed for %s', async (_name, overrides, code) => {
    const response = await request(createApp()).post('/capabilities/workspace-a').send(negotiation(overrides));

    expect(response.status).toBe(code === 'capability_unauthenticated' ? 401 : 409);
    expect(response.body).toEqual({ code, message: 'The capability negotiation request was rejected.' });
  });

  it('rejects a tampered authenticator proof', async () => {
    const body = negotiation();

    body.claim.authenticator.proof = 'hmac-sha256:tampered';

    const response = await request(createApp()).post('/capabilities/workspace-a').send(body);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('capability_unauthenticated');
  });

  it('does not disclose whether another account owns a workspace', async () => {
    const response = await request(createApp('account-b')).get('/capabilities/workspace-a');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'workspace_not_found',
      message: 'The workspace could not be found.',
    });
  });

  it('rejects a real enrolled device after revocation through the HTTP route', async () => {
    const device = enrollLocalAgent();
    const body = negotiation({
      clientId: device.deviceId,
      claim: {
        ...negotiation().claim,
        clientId: device.deviceId,
        authenticator: { scheme: 'local-agent-signature', keyId: device.deviceId, proof: 'ed25519:pending' },
      },
    });

    body.claim.authenticator.proof = createLocalAgentProof(body.claim as never, device.privateKey);
    deviceIdentityStore.revokeDevice('account-a', device.deviceId, new Date(), 'workspace-a');

    const response = await request(createApp()).post('/capabilities/workspace-a').send(body);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      code: 'capability_unauthenticated',
      message: 'The capability negotiation request was rejected.',
    });
  });

  it('isolates an enrolled device from another account and workspace', async () => {
    const otherAccountDevice = enrollLocalAgent('workspace-a', 'account-b');
    const crossAccount = negotiation({
      clientId: otherAccountDevice.deviceId,
      claim: {
        ...negotiation().claim,
        accountId: 'account-a',
        clientId: otherAccountDevice.deviceId,
        authenticator: {
          scheme: 'local-agent-signature',
          keyId: otherAccountDevice.deviceId,
          proof: 'ed25519:pending',
        },
      },
    });

    crossAccount.claim.authenticator.proof = createLocalAgentProof(
      crossAccount.claim as never,
      otherAccountDevice.privateKey,
    );

    const crossAccountResponse = await request(createApp()).post('/capabilities/workspace-a').send(crossAccount);

    expect(crossAccountResponse.status).toBe(401);

    deviceIdentityStore.clear();
    const otherWorkspaceDevice = enrollLocalAgent('workspace-b');
    const crossWorkspace = negotiation({
      clientId: otherWorkspaceDevice.deviceId,
      claim: {
        ...negotiation().claim,
        clientId: otherWorkspaceDevice.deviceId,
        authenticator: {
          scheme: 'local-agent-signature',
          keyId: otherWorkspaceDevice.deviceId,
          proof: 'ed25519:pending',
        },
      },
    });

    crossWorkspace.claim.authenticator.proof = createLocalAgentProof(
      crossWorkspace.claim as never,
      otherWorkspaceDevice.privateKey,
    );

    const crossWorkspaceResponse = await request(createApp()).post('/capabilities/workspace-a').send(crossWorkspace);

    expect(crossWorkspaceResponse.status).toBe(401);
  });
});
