import { OAuth2Client } from 'google-auth-library';
import { describe, expect, it, vi } from 'vitest';

import { config, current, flow, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { Flows } from '../shared/flows';

import { Google } from './service';

describe('Google configuration and proof races', () => {
  it('disables provider operations without a configured audience', async () => {
    const f = storage();
    const google = authService(Google, f.db, config, [{ provide: Flows, useValue: {} as Flows }]);

    await expect(google.start(session.sid, 'login')).rejects.toMatchObject({ code: 'google_disabled' });

    await expect(google.complete(session.sid, flow.id, 'synthetic')).rejects.toMatchObject({ code: 'google_disabled' });
  });
  it('rejects non-Google flows and unbound nonces before cryptographic work', async () => {
    for (const pending of [flow, { ...flow, purpose: 'google_login', data: {} }]) {
      const f = storage();
      const proofs = { reserve: vi.fn().mockResolvedValue(pending) } as unknown as Flows;

      await expect(
        authService(Google, f.db, { ...config, googleClientId: 'synthetic' }, [
          { provide: Flows, useValue: proofs },
        ]).complete(session.sid, flow.id, 'synthetic'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
  });
  it('rejects a nonce consumed by another request', async () => {
    const pending = { ...flow, purpose: 'google_login', data: { nonce: 'synthetic' } };
    const proofs = {
      reserve: vi.fn().mockResolvedValue(pending),
      locked: vi.fn().mockResolvedValue({ ...pending, data: { nonce: 'consumed' } }),
    } as unknown as Flows;
    const verify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        nonce: 'synthetic',
        sub: 'subject',
        email: 'synthetic@gmail.com',
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    } as never);

    try {
      await expect(
        authService(Google, storage().db, { ...config, googleClientId: 'synthetic' }, [
          { provide: Flows, useValue: proofs },
        ]).complete(session.sid, flow.id, 'synthetic'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    } finally {
      verify.mockRestore();
    }
  });
  it('refuses invalid Google completion records and unlinked reauthentication', async () => {
    const proofs = {
      reserve: vi.fn().mockResolvedValue(flow),
      code: vi.fn(),
      locked: vi.fn().mockResolvedValue(flow),
    } as unknown as Flows;

    for (const candidate of [undefined, flow]) {
      const f = storage([candidate ? [candidate] : []]);

      await expect(
        authService(Google, f.db, { ...config, googleClientId: 'synthetic' }, [
          { provide: Flows, useValue: proofs },
        ]).emailComplete(session.sid, flow.id, '123456'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
    }
    const candidate = {
      ...flow,
      purpose: 'google_reauth',
      data: { issuer: 'https://accounts.google.com', subject: 'subject', providerEmail: user.email },
    };
    const f = storage([[candidate], [], [], [], [user], [session]]);

    await expect(
      authService(Google, f.db, { ...config, googleClientId: 'synthetic' }, [
        { provide: Flows, useValue: proofs },
      ]).emailComplete(session.sid, flow.id, '123456', current),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

it('does not let a provider result skip an SMTP proof attached concurrently', async () => {
  const pending = { ...flow, purpose: 'google_login', data: { nonce: 'synthetic' } };
  const candidate = {
    ...flow,
    purpose: 'google_login',
    codeHash: 'requires-email',
    data: { issuer: 'https://accounts.google.com', subject: 'subject', providerEmail: user.email },
  };
  const proofs = {
    reserve: vi.fn().mockResolvedValue(pending),
    locked: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(candidate),
  } as unknown as Flows;
  const f = storage([[], [candidate], [], [], [], [user], [session]]);
  const verify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
    getPayload: () => ({
      iss: 'https://accounts.google.com',
      nonce: 'synthetic',
      sub: 'subject',
      email: 'synthetic@gmail.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  } as never);

  try {
    await expect(
      authService(Google, f.db, { ...config, googleClientId: 'synthetic' }, [
        { provide: Flows, useValue: proofs },
      ]).complete(session.sid, flow.id, 'synthetic'),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  } finally {
    verify.mockRestore();
  }
});
