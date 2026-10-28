import { generate } from 'otplib';
import { expect, it } from 'vitest';

import { config, current, factor, flow, session, storage, user } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { digest } from '../shared/secrets';
import { decryptSecret } from '../totp/secrets';
import { Factors } from '../totp/service';

it('requires an active factor and its dedicated encryption key', async () => {
  const missing = storage([[]]);

  await expect(
    authService(Factors, missing.db, config).verify(missing.tx, user, { kind: 'totp', code: '123456' }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
  const absentKey = { ...config, totpKey: undefined };
  const f = storage([[factor]]);

  await expect(
    authService(Factors, f.db, absentKey).verify(f.tx, user, { kind: 'totp', code: '123456' }),
  ).rejects.toMatchObject({ code: 'totp_unavailable' });
  await expect(authService(Factors, f.db, absentKey).setup(session.sid, current)).rejects.toMatchObject({
    code: 'totp_unavailable',
  });
});
it('rejects an invalid pending TOTP proof and a backup consumed by another request', async () => {
  const f = storage([
    [user],
    [session],
    [{ ...factor, authVersion: 1, sessionId: session.sid, expiresAt: flow.expiresAt }],
  ]);

  await expect(
    authService(Factors, f.db, config).confirm(session.sid, current, flow.id, 'invalid'),
  ).rejects.toMatchObject({
    code: 'verification_failed',
  });
  const code = 'SYNTHETIC';
  const race = storage([[factor], [{ id: 'backup', codeHash: digest(config.secret, `backup:${user.id}`, code) }], []]);

  await expect(
    authService(Factors, race.db, config).verify(race.tx, user, { kind: 'recovery_code', code }),
  ).rejects.toMatchObject({ code: 'verification_failed' });
});
it('accepts a fresh TOTP proof and advances its replay barrier', async () => {
  const secret = decryptSecret(factor.encryptedSecret, config.totpKey!);
  const code = await generate({ secret });
  const f = storage([[factor], []]);

  await expect(authService(Factors, f.db, config).verify(f.tx, user, { kind: 'totp', code })).resolves.toBeUndefined();
});
