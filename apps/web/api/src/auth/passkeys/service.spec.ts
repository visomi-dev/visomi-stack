import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '@visomi-stack/backend-shared';
import { AuthHttpError } from '@visomi-stack/web-backend-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authService } from '../../../tests/support/injection';
import { authConfig } from '../shared/config';

import { Passkeys } from './service';

const webAuthn = vi.hoisted(() => ({ registration: vi.fn(), authentication: vi.fn() }));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: webAuthn.registration,
  generateAuthenticationOptions: webAuthn.authentication,
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const config = authConfig({
  origin: 'http://localhost',
  rpId: 'localhost',
  secret: 'synthetic-session-secret-with-32-bytes',
});
const challenge = 'synthetic_options_challenge';

beforeEach(() => {
  vi.clearAllMocks();
  webAuthn.registration.mockResolvedValue({ challenge });
  webAuthn.authentication.mockResolvedValue({ challenge });
});

// Only the options' persistence boundary is stubbed; real SQL and verification live in integration.
function optionsFixture() {
  const sessionLock = vi.fn().mockResolvedValue([{ sid: 'synthetic-session' }]);
  const persist = vi.fn().mockResolvedValue(undefined);
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: sessionLock }) }) }),
    delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
    insert: () => ({ values: persist }),
  };
  const owned = vi.fn().mockResolvedValue([]);
  const database = {
    transaction: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)),
    select: () => ({ from: () => ({ where: owned }) }),
  };

  return {
    database,
    owned,
    sessionLock,
    persist,
    passkeys: authService(Passkeys, database as unknown as Database, config),
  };
}

describe('passkey capability authorization', () => {
  it('requires fresh passkey authentication before offering enrollment or changing credentials', async () => {
    const database = { transaction: vi.fn(), select: vi.fn(), update: vi.fn() } as unknown as Database;
    const passkeys = authService(Passkeys, database, config);
    const stale = { id: 'synthetic-user', credentialId: 'synthetic-credential', authenticatedAt: Date.now() - 600000 };

    await expect(passkeys.registrationOptions('synthetic-session', stale)).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    await expect(passkeys.registrationOptions('synthetic-session', stale)).rejects.toBeInstanceOf(AuthHttpError);
    await expect(passkeys.rename('synthetic-session', stale, 'credential', 'label')).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    await expect(passkeys.revoke('synthetic-session', stale, 'credential')).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.select).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });

  it('allocates the signup identity on the server and persists only an expiring challenge hash', async () => {
    const fixture = optionsFixture();
    const before = Date.now();
    const result = await fixture.passkeys.registrationOptions('synthetic-session');
    const options = webAuthn.registration.mock.calls[0][0];
    const stored = fixture.persist.mock.calls[0][0];

    expect(options.userName).toMatch(/^[a-f0-9-]{36}$/);
    expect(options.userID.toString()).toBe(options.userName);
    expect(options).toMatchObject({
      rpID: config.rpId,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: [],
    });
    expect(stored).toMatchObject({
      id: result.challengeId,
      sessionId: 'synthetic-session',
      purpose: 'signup',
      subjectId: options.userName,
      challengeHash: createHash('sha256').update(challenge).digest('hex'),
    });
    expect(stored.challengeHash).not.toBe(challenge);
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(before + config.challengeMaxAge);
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + config.challengeMaxAge);
    expect(result.options).toEqual({ challenge });
  });

  it('binds fresh enrollment to the authenticated user and delegates credential exclusion', async () => {
    const fixture = optionsFixture();
    const user = { id: randomUUID(), credentialId: randomUUID(), authenticatedAt: Date.now() };

    fixture.owned.mockResolvedValue([{ credentialId: 'synthetic_existing_key', transports: ['internal'] }]);
    await fixture.passkeys.registrationOptions('synthetic-session', user);
    expect(webAuthn.registration).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: user.id,
        userID: Buffer.from(user.id),
        excludeCredentials: [{ id: 'synthetic_existing_key', transports: ['internal'] }],
      }),
    );
    expect(fixture.persist).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'enrollment', subjectId: user.id }),
    );
  });

  it('delegates discoverable login options and binds the challenge to its session without an identity', async () => {
    const fixture = optionsFixture();
    const result = await fixture.passkeys.authenticationOptions('synthetic-session');

    expect(webAuthn.authentication).toHaveBeenCalledExactlyOnceWith({
      rpID: config.rpId,
      userVerification: 'required',
    });
    expect(fixture.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'synthetic-session',
        purpose: 'authentication',
        subjectId: undefined,
        id: result.challengeId,
      }),
    );
    expect(result.options).toEqual({ challenge });
  });

  it('does not persist options when the session is no longer active', async () => {
    const fixture = optionsFixture();

    fixture.sessionLock.mockResolvedValue([]);
    await expect(fixture.passkeys.authenticationOptions('expired-session')).rejects.toMatchObject({
      code: 'session_expired',
      status: 401,
    });
    expect(fixture.persist).not.toHaveBeenCalled();
  });

  it('does not create pending state when option generation fails', async () => {
    const fixture = optionsFixture();

    webAuthn.registration.mockRejectedValueOnce(new Error('synthetic_options_failure'));
    await expect(fixture.passkeys.registrationOptions('synthetic-session')).rejects.toThrow(
      'synthetic_options_failure',
    );
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
});

it('rejects an enrollment grant revoked after assertion verification starts', async () => {
  const { storage, config: trusted, user, session, flow } = await import('../../../tests/support/auth-state');
  const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

  vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
    verified: true,
    authenticationInfo: { credentialDeviceType: 'singleDevice', newCounter: 1, credentialBackedUp: false },
  } as never);
  const candidate = {
    id: 'synthetic-key',
    userId: user.id,
    credentialId: 'synthetic-key',
    rpId: trusted.rpId,
    publicKey: 'synthetic',
    counter: 0,
    backupEligible: false,
    pendingGrantId: flow.id,
  };
  const pending = { ...flow, subjectId: user.id, purpose: 'authentication', challengeHash: 'synthetic' };
  const f = storage([[session], [pending], [candidate], [user], [session], [candidate], [], []]);
  const enrollment = {
    ...user,
    id: user.id,
    method: 'passkey' as const,
    methodId: candidate.id,
    credentialId: candidate.id,
    authenticatedAt: Date.now(),
    version: 1,
    level: 'enrollment' as const,
    emailVerified: true,
    grantId: flow.id,
  };

  await expect(
    authService(Passkeys, f.db, trusted).authenticate(
      session.sid,
      flow.id,
      { id: candidate.credentialId, response: {} } as never,
      enrollment,
    ),
  ).rejects.toMatchObject({ code: 'challenge_invalid' });
});
