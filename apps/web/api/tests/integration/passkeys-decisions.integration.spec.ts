import { randomUUID } from 'node:crypto';

import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { decodeAttestationObject, isoCBOR } from '@simplewebauthn/server/helpers';
import { authSchema, createDatabase } from '@visomi-stack/backend-shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticator } from '@visomi-stack/dev-testing';
import { testPostgres } from '@visomi-stack/dev-testing/postgres';

import { authService, sessionStore } from '../support/injection';
import { authConfig } from '../../src/auth/shared/config';
import { Passkeys } from '../../src/auth/passkeys/service';

vi.mock('@simplewebauthn/server', async (original) => {
  const actual = await original<typeof import('@simplewebauthn/server')>();

  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse),
    verifyAuthenticationResponse: vi.fn(actual.verifyAuthenticationResponse),
  };
});

const { credentials, challenges } = authSchema;
const config = authConfig({
  origin: 'http://localhost',
  rpId: 'localhost',
  secret: 'synthetic-session-secret-with-32-bytes',
});
let postgres: Awaited<ReturnType<typeof testPostgres>>;
let resource: ReturnType<typeof createDatabase>;
let passkeys: Passkeys;

beforeAll(async () => {
  const isolated = await testPostgres();

  postgres = isolated;
  resource = createDatabase(postgres.url);
  passkeys = authService(Passkeys, resource.db, config);
}, 120000);

afterAll(async () => {
  await resource?.close();

  await postgres?.stop();
}, 120000);

async function session() {
  const sid = randomUUID();
  const store = sessionStore(resource.pool);

  await new Promise<void>((resolve, reject) =>
    store.set(sid, { cookie: { maxAge: 60000 } } as never, (error) => (error ? reject(error) : resolve())),
  );

  return sid;
}

async function registered() {
  const sid = await session();
  const device = authenticator();
  const pending = await passkeys.registrationOptions(sid);
  const response = device.register(pending.options.challenge, config.origin, config.rpId);

  delete response.response.transports;
  const user = await passkeys.register(sid, pending.challengeId, response, 'Synthetic first passkey');

  return { sid, device, user };
}

describe('passkey persistence decisions with real PostgreSQL', () => {
  it('persists registration metadata separately from a custom passkey name', async () => {
    const sid = await session();
    const device = authenticator();
    const pending = await passkeys.registrationOptions(sid);
    const response = device.register(pending.options.challenge, config.origin, config.rpId);
    const aaguid = 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4';
    const attestation = decodeAttestationObject(Buffer.from(response.response.attestationObject, 'base64url'));
    const authData = attestation.get('authData');

    authData.set(Buffer.from(aaguid.replace(/-/g, ''), 'hex'), 37);
    const payload = new Map<string, Parameters<typeof isoCBOR.encode>[0]>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]);

    response.response.attestationObject = Buffer.from(isoCBOR.encode(payload)).toString('base64url');

    const user = await passkeys.register(sid, pending.challengeId, response, undefined);
    const [stored] = await resource.db.select().from(credentials).where(eq(credentials.id, user.credentialId));

    expect(stored.aaguid).toBe(aaguid);
    expect(stored.label).toBe('Passkey');
    expect(stored.labelIsCustom).toBe(false);
    const original = await passkeys.list(user);

    expect(original).toEqual([expect.objectContaining({ label: 'Passkey', providerName: 'Google Password Manager' })]);

    await passkeys.rename(sid, user, user.credentialId, 'Travel key');

    const [listed] = await passkeys.list(user);

    expect(listed.label).toBe('Travel key');
    expect(listed.providerName).toBe('Google Password Manager');
    expect(listed.labelIsCustom).toBe(true);
    expect(listed).not.toHaveProperty('aaguid');
    expect(listed).not.toHaveProperty('credentialId');
    expect(listed).not.toHaveProperty('publicKey');

    await resource.db
      .update(credentials)
      .set({ aaguid: null, labelIsCustom: null })
      .where(eq(credentials.id, user.credentialId));

    const legacy = await passkeys.list(user);

    expect(legacy).toEqual([expect.objectContaining({ label: 'Travel key', labelIsCustom: null, providerName: null })]);

    await passkeys.rename(sid, user, user.credentialId, 'Passkey');

    const explicitlyNamed = await passkeys.list(user);

    expect(explicitlyNamed[0]).toMatchObject({ label: 'Passkey', labelIsCustom: true });
  });

  it('lists only public credential metadata and renames an owned active credential', async () => {
    const f = await registered();

    await passkeys.rename(f.sid, f.user, f.user.credentialId, 'Synthetic renamed passkey');

    const listed = await passkeys.list(f.user);

    expect(listed).toEqual([
      {
        id: f.user.credentialId,
        label: 'Synthetic renamed passkey',
        labelIsCustom: true,
        providerName: null,
        createdAt: expect.any(Date),
        lastUsedAt: null,
        backupEligible: false,
        backupState: false,
      },
    ]);
    const [stored] = await resource.db.select().from(credentials).where(eq(credentials.id, f.user.credentialId));

    expect(stored.transports).toEqual([]);
    expect(stored.label).toBe('Synthetic renamed passkey');
  });

  it('rejects missing and foreign credentials and preserves the final active credential', async () => {
    const first = await registered();
    const other = await registered();

    for (const id of [randomUUID(), other.user.credentialId]) {
      await expect(passkeys.rename(first.sid, first.user, id, 'Denied')).rejects.toMatchObject({
        status: 404,
        code: 'credential_not_found',
      });

      await expect(passkeys.revoke(first.sid, first.user, id)).rejects.toMatchObject({
        status: 404,
        code: 'credential_not_found',
      });
    }

    await expect(passkeys.revoke(first.sid, first.user, first.user.credentialId)).rejects.toMatchObject({
      status: 409,
      code: 'last_access_method',
    });

    const [unchanged] = await resource.db.select().from(credentials).where(eq(credentials.id, other.user.credentialId));

    expect(unchanged.label).toBe('Synthetic first passkey');
    expect(unchanged.revokedAt).toBeNull();
  });

  it('rejects mutations authenticated with a credential that was revoked after the session loaded', async () => {
    const f = await registered();

    await resource.db.update(credentials).set({ revokedAt: new Date() }).where(eq(credentials.id, f.user.credentialId));

    await expect(passkeys.rename(f.sid, f.user, f.user.credentialId, 'Denied')).rejects.toMatchObject({
      status: 401,
      code: 'authentication_required',
    });
  });

  it('consumes an enrollment challenge but rejects a different authenticated subject', async () => {
    const first = await registered();
    const other = await registered();
    const pending = await passkeys.registrationOptions(first.sid, first.user);
    const device = authenticator();

    await expect(
      passkeys.register(
        first.sid,
        pending.challengeId,
        device.register(pending.options.challenge, config.origin, config.rpId),
        'Denied',
        other.user,
      ),
    ).rejects.toMatchObject({ code: 'challenge_invalid' });

    const remaining = await resource.db.select().from(challenges).where(eq(challenges.id, pending.challengeId));

    expect(remaining).toHaveLength(0);
  });

  it('authenticates a valid discoverable assertion without an optional user handle', async () => {
    const f = await registered();
    const pending = await passkeys.authenticationOptions(f.sid);
    const response = f.device.authenticate(pending.options.challenge, config.origin, config.rpId);
    const user = await passkeys.authenticate(f.sid, pending.challengeId, response);

    expect(user).toMatchObject({ id: f.user.id, credentialId: f.user.credentialId });
  });

  it('rejects a credential persisted for another relying party', async () => {
    const f = await registered();
    const pending = await passkeys.authenticationOptions(f.sid);

    await resource.db
      .update(credentials)
      .set({ rpId: 'other.example.test' })
      .where(eq(credentials.id, f.user.credentialId));

    await expect(
      passkeys.authenticate(
        f.sid,
        pending.challengeId,
        f.device.authenticate(pending.options.challenge, config.origin, config.rpId, f.user.id),
      ),
    ).rejects.toMatchObject({ code: 'passkey_invalid' });
  });

  // Only these two verifier outcomes are mocked; transaction and challenge consumption remain real.
  it('fails closed when the registration verifier returns an explicit negative result', async () => {
    const sid = await session();
    const pending = await passkeys.registrationOptions(sid);
    const device = authenticator();

    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({ verified: false });

    await expect(
      passkeys.register(
        sid,
        pending.challengeId,
        device.register(pending.options.challenge, config.origin, config.rpId),
        'Denied',
      ),
    ).rejects.toMatchObject({ code: 'passkey_invalid' });

    const remaining = await resource.db.select().from(challenges).where(eq(challenges.id, pending.challengeId));

    expect(remaining).toHaveLength(0);
  });

  it('does not advance the persisted counter when the authentication verifier returns false', async () => {
    const f = await registered();
    const pending = await passkeys.authenticationOptions(f.sid);

    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({ verified: false } as never);

    await expect(
      passkeys.authenticate(
        f.sid,
        pending.challengeId,
        f.device.authenticate(pending.options.challenge, config.origin, config.rpId, f.user.id),
      ),
    ).rejects.toMatchObject({ code: 'passkey_invalid' });

    const [unchanged] = await resource.db.select().from(credentials).where(eq(credentials.id, f.user.credentialId));

    expect(unchanged.counter).toBe(0);
    expect(unchanged.lastUsedAt).toBeNull();
  });
});
