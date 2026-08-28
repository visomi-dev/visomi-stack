import {
  accountDiscoveryResponse,
  activatePendingEnrollment,
  addCredential,
  canEstablishSession,
  canRemoveAccessMethod,
  cleanupTerminalEnrollment,
  configurePassword,
  emailGate,
  enrollmentRetryAction,
  listCredentials,
  nameCredential,
  nextPasskeyAttempt,
  normalizeEmail,
  revokeCredential,
  terminatePendingEnrollment,
  useCredential,
  validateCeremony,
  viableAccessMethodIds,
  type PasskeyCredential,
  type PasswordAccess,
  type PasswordSetupInput,
  type PendingEnrollmentModel,
} from './passkey-contract';

import { accountPasskeyCredentials, accountPasskeyEnrollments, accountWebAuthnChallenges } from 'shared';

const now = new Date('2026-08-22T00:00:00Z');

function credential(overrides: Partial<PasskeyCredential> = {}): PasskeyCredential {
  return {
    accountId: 'account-1',
    createdAt: now,
    credentialId: 'credential-external-1',
    id: 'credential-stable-1',
    lastUsedAt: null,
    name: 'Laptop',
    status: 'active',
    userId: 'user-1',
    ...overrides,
  };
}

function pendingEnrollment(overrides: Partial<PendingEnrollmentModel> = {}): PendingEnrollmentModel {
  return {
    account: {
      accountId: 'account-1',
      email: 'person@example.test',
      emailVerified: false,
      status: 'pending',
      userId: 'user-1',
    },
    challenge: { challengeHash: 'verification-hash', consumedAt: null },
    credential: credential({ status: 'pending' }),
    enrollment: {
      accountId: 'account-1',
      credentialId: 'credential-external-1',
      email: 'person@example.test',
      expiresAt: new Date('2026-08-22T00:01:00Z'),
      id: 'enrollment-1',
      status: 'pending',
      userId: 'user-1',
    },
    ...overrides,
  };
}

function passwordAccess(configured: boolean, overrides: Partial<PasswordAccess> = {}): PasswordAccess {
  return { accountId: 'account-1', configured, userId: 'user-1', ...overrides };
}

describe('account passkey contract', () => {
  it('requires canonical email, verification, and PIN without enumerating account existence', () => {
    expect(emailGate(null, null, false)).toBe('email_required');
    expect(emailGate('person@example.test', null, false)).toBe('email_unverified');
    expect(emailGate('person@example.test', new Date(), false)).toBe('pin_required');
    expect(emailGate('person@example.test', new Date(), true)).toBe('ready');
    expect(normalizeEmail('  Person@Example.TEST ')).toBe('person@example.test');
    expect(normalizeEmail('Ｐｅｒｓｏｎ＠Ｅｘａｍｐｌｅ．ｔｅｓｔ')).toBe('person@example.test');
    expect(accountDiscoveryResponse(true)).toEqual(accountDiscoveryResponse(false));
  });

  it('atomically activates the account, enrollment, bound credential, and verification once', () => {
    expect(Object.keys(accountPasskeyEnrollments)).toEqual(
      expect.arrayContaining(['accountId', 'userId', 'email', 'credentialId', 'status', 'expiresAt']),
    );
    const result = activatePendingEnrollment(pendingEnrollment(), { challengeHash: 'verification-hash', now });

    expect(result).toMatchObject({
      ok: true,
      state: {
        account: { emailVerified: true, status: 'active' },
        credential: { credentialId: 'credential-external-1', status: 'active' },
        enrollment: { credentialId: 'credential-external-1', status: 'active' },
      },
    });
    if (!result.ok) throw new Error('Expected activation');
    expect(result.state.challenge.consumedAt).toEqual(now);
    expect(activatePendingEnrollment(result.state, { challengeHash: 'verification-hash', now })).toMatchObject({
      ok: false,
      failure: 'enrollment_terminal',
    });
    expect(canEstablishSession({ enrollmentStatus: 'active', emailVerified: true, credentialStatus: 'active' })).toBe(
      true,
    );
  });

  it('keeps the account and enrollment pending when credential activation cannot complete', () => {
    const state = pendingEnrollment({ credential: null });
    const result = activatePendingEnrollment(state, { challengeHash: 'verification-hash', now });

    expect(result).toMatchObject({ ok: false, failure: 'verification_rejected' });
    if (result.ok) throw new Error('Expected activation rollback');
    expect(result.state.account).toMatchObject({ emailVerified: false, status: 'pending' });
    expect(result.state.enrollment).toMatchObject({ status: 'mismatched', credentialId: 'credential-external-1' });
    expect(result.state.challenge.consumedAt).toBeNull();
    expect(result.state.credential).toBeNull();
  });

  it('does not leave an orphan credential or partially active enrollment after a failed binding', () => {
    const state = pendingEnrollment({
      credential: credential({ credentialId: 'different-credential', status: 'pending' }),
    });
    const result = activatePendingEnrollment(state, { challengeHash: 'verification-hash', now });

    expect(result).toMatchObject({ ok: false, failure: 'verification_rejected' });
    if (result.ok) throw new Error('Expected activation rollback');
    expect(result.state.account.status).toBe('pending');
    expect(result.state.account.emailVerified).toBe(false);
    expect(result.state.enrollment.status).toBe('mismatched');
    expect(result.state.credential).toBeNull();
    expect(result.state.challenge.consumedAt).toBeNull();
  });

  it.each(['expire', 'replay', 'mismatch', 'cancel', 'supersede'] as const)(
    'terminalizes and cleans up a %s enrollment without activating or leaking its credential',
    (event) => {
      const terminal = terminatePendingEnrollment(pendingEnrollment(), event);
      const cleaned = cleanupTerminalEnrollment(terminal);

      expect(terminal.account).toMatchObject({ emailVerified: false, status: 'pending' });
      expect(terminal.credential).toMatchObject({ status: 'unusable' });
      expect(cleaned.credential).toBeNull();
      expect(enrollmentRetryAction(cleaned.enrollment.status)).toBe('restart_enrollment');
      expect(activatePendingEnrollment(cleaned, { challengeHash: 'verification-hash', now })).toMatchObject({
        ok: false,
        failure: 'enrollment_terminal',
      });
    },
  );

  it('rejects expired, replayed, challenge-mismatched, and ownership-mismatched activation atomically', () => {
    const cases: PendingEnrollmentModel[] = [
      pendingEnrollment({ enrollment: { ...pendingEnrollment().enrollment, expiresAt: now } }),
      pendingEnrollment({ challenge: { challengeHash: 'verification-hash', consumedAt: now } }),
      pendingEnrollment(),
      pendingEnrollment({ credential: credential({ accountId: 'account-2', status: 'pending' }) }),
    ];
    const hashes = ['verification-hash', 'verification-hash', 'wrong-hash', 'verification-hash'];

    cases.forEach((state, index) => {
      const result = activatePendingEnrollment(state, { challengeHash: hashes[index], now });

      expect(result).toMatchObject({ ok: false, failure: 'verification_rejected' });
      if (result.ok) throw new Error('Expected rejection');
      expect(result.state.account).toMatchObject({ emailVerified: false, status: 'pending' });
      if (index === 3) expect(result.state.credential).toBeNull();
      else expect(result.state.credential).toMatchObject({ status: 'unusable' });
    });
  });

  it('keeps passkey default and exposes retry before explicit password fallback', () => {
    expect(nextPasskeyAttempt({})).toBe('passkey_default');
    expect(nextPasskeyAttempt({ ceremonyFailed: true })).toBe('retry_available');
    expect(nextPasskeyAttempt({ explicitPassword: true })).toBe('password_fallback');
    expect(enrollmentRetryAction('pending')).toBe('retry_verification');
  });

  it('supports add, stable-ID name, isolated list, use, and idempotent revoke for multiple passkeys', () => {
    const first = credential();
    const second = credential({ credentialId: 'credential-external-2', id: 'credential-stable-2', name: 'Phone' });
    const added = addCredential([first], second);

    expect(added).toMatchObject({ ok: true, credential: { id: 'credential-stable-2', status: 'active' } });
    if (!added.ok) throw new Error('Expected add');
    expect(addCredential(added.credentials, second)).toMatchObject({
      ok: false,
      failure: 'credential_already_exists',
    });
    expect(
      addCredential(
        added.credentials,
        credential({ credentialId: 'credential-external-3', id: 'credential-stable-2', name: 'Tablet' }),
      ),
    ).toEqual({ ok: false, failure: 'credential_already_exists', credentials: added.credentials });
    const renamed = nameCredential(
      added.credentials,
      { accountId: 'account-1', credentialId: 'credential-external-2', userId: 'user-1' },
      'Travel phone',
    );

    expect(renamed).toMatchObject({ ok: true, credential: { id: 'credential-stable-2', name: 'Travel phone' } });
    if (!renamed.ok) throw new Error('Expected rename');
    expect(
      nameCredential(
        renamed.credentials,
        { accountId: 'account-1', credentialId: 'credential-external-2', userId: 'user-1' },
        'Travel phone',
      ),
    ).toEqual(renamed);
    expect(
      nameCredential(
        renamed.credentials,
        { accountId: 'account-1', credentialId: 'credential-external-2', userId: 'user-1' },
        'Laptop',
      ),
    ).toMatchObject({ ok: false, failure: 'credential_name_conflict' });
    expect(
      listCredentials(
        [...renamed.credentials, credential({ accountId: 'account-2', id: 'other' })],
        'account-1',
        'user-1',
      ),
    ).toHaveLength(2);
    const used = useCredential(
      renamed.credentials,
      { accountId: 'account-1', credentialId: 'credential-external-2', userId: 'user-1' },
      now,
    );

    expect(used).toMatchObject({ ok: true, credential: { id: 'credential-stable-2', lastUsedAt: now } });
    if (!used.ok) throw new Error('Expected use');
    const revoked = revokeCredential(
      used.credentials,
      { accountId: 'account-1', credentialId: 'credential-external-2', userId: 'user-1' },
      passwordAccess(false),
    );

    expect(revoked).toMatchObject({ ok: true, credential: { id: 'credential-stable-2', status: 'revoked' } });
    if (!revoked.ok) throw new Error('Expected revoke');
    expect(
      revokeCredential(
        revoked.credentials,
        { accountId: 'account-1', credentialId: 'credential-external-2', userId: 'user-1' },
        passwordAccess(false),
      ),
    ).toEqual(revoked);
  });

  it('returns the same non-enumerating failure for missing and cross-account credential operations', () => {
    const credentials = [credential()];
    const missing = { accountId: 'account-1', credentialId: 'missing', userId: 'user-1' };
    const crossAccount = { accountId: 'account-2', credentialId: 'credential-external-1', userId: 'user-1' };
    const crossUser = { accountId: 'account-1', credentialId: 'credential-external-1', userId: 'user-2' };

    expect(nameCredential(credentials, missing, 'Name')).toMatchObject({ ok: false, failure: 'credential_not_found' });
    expect(nameCredential(credentials, crossAccount, 'Name')).toEqual(nameCredential(credentials, crossUser, 'Name'));
    expect(useCredential(credentials, crossAccount, now)).toMatchObject({ ok: false, failure: 'credential_not_found' });
    expect(revokeCredential(credentials, crossAccount, passwordAccess(true))).toMatchObject({
      ok: false,
      failure: 'credential_not_found',
    });
  });

  it('computes viable access from usable records and protects the last method', () => {
    const owner = { accountId: 'account-1', userId: 'user-1' };
    const credentials = [
      credential({ id: 'active' }),
      credential({ id: 'pending', credentialId: 'pending', status: 'pending' }),
      credential({ id: 'expired', credentialId: 'expired', status: 'expired' }),
      credential({ id: 'revoked', credentialId: 'revoked', status: 'revoked' }),
      credential({ id: 'unusable', credentialId: 'unusable', status: 'unusable' }),
      credential({ accountId: 'account-2', credentialId: 'foreign-account', id: 'foreign-account' }),
      credential({ credentialId: 'foreign-user', id: 'foreign-user', userId: 'user-2' }),
    ];

    expect(viableAccessMethodIds(credentials, owner, passwordAccess(false))).toEqual(['active']);
    expect(canRemoveAccessMethod(credentials, owner, passwordAccess(false), 'active')).toBe(false);
    expect(canRemoveAccessMethod(credentials, owner, passwordAccess(true), 'active')).toBe(true);
    expect(canRemoveAccessMethod([], owner, passwordAccess(true), 'password')).toBe(false);
    expect(canRemoveAccessMethod(credentials, owner, passwordAccess(true, { accountId: 'account-2' }), 'active')).toBe(
      false,
    );
    expect(
      revokeCredential(
        credentials,
        { accountId: 'account-1', credentialId: 'credential-external-1', userId: 'user-1' },
        passwordAccess(false),
      ),
    ).toMatchObject({ ok: false, failure: 'last_access_method' });
  });

  it('independently enforces every later-password security control and redacts audit output', () => {
    const base: PasswordSetupInput = {
      accountId: 'account-1',
      auditEnabled: true,
      csrfValid: true,
      passwordPolicyValid: true,
      passwordSecret: 'never-log-this-secret',
      recentlyReauthenticated: true,
      redactSecrets: true,
      sessionEffect: 'rotate_current',
      userId: 'user-1',
      withinRateLimit: true,
    };
    const failures: Array<[keyof PasswordSetupInput, PasswordSetupInput[keyof PasswordSetupInput], string]> = [
      ['recentlyReauthenticated', false, 'reauthentication'],
      ['passwordPolicyValid', false, 'password_policy'],
      ['csrfValid', false, 'csrf'],
      ['withinRateLimit', false, 'rate_limit'],
      ['sessionEffect', 'unresolved', 'session_policy'],
      ['auditEnabled', false, 'audit'],
      ['redactSecrets', false, 'redaction'],
    ];

    failures.forEach(([key, value, failedControl]) => {
      expect(configurePassword({ ...base, [key]: value })).toEqual({
        ok: false,
        failure: 'password_setup_denied',
        failedControl,
      });
    });
    const result = configurePassword(base);

    expect(result).toMatchObject({
      ok: true,
      passwordConfigured: true,
      sessionEffect: 'rotate_current',
      audit: { action: 'password_configured', redactedFields: ['password'] },
    });
    expect(JSON.stringify(result)).not.toContain(base.passwordSecret);
  });

  it('rejects missing and cross-account ceremony credentials without disclosing ownership', () => {
    const base = ceremonyInput();
    const missing = validateCeremony({ ...base, credential: null });
    const crossAccount = validateCeremony({ ...base, expectedAccountId: 'account-2' });
    const crossUser = validateCeremony({ ...base, expectedUserId: 'user-2' });

    expect(missing).toEqual({ ok: false, failure: 'credential_not_found' });
    expect(crossAccount).toEqual(missing);
    expect(crossUser).toEqual(missing);
  });

  it('rejects replay, expiry, binding failures, revoked credentials, missing UV, and counter regression', () => {
    const base = ceremonyInput();

    expect(validateCeremony({ ...base, challenge: { ...base.challenge, consumedAt: now } })).toEqual({
      ok: false,
      failure: 'challenge_replayed',
    });
    expect(validateCeremony({ ...base, now: base.challenge.expiresAt })).toEqual({
      ok: false,
      failure: 'challenge_expired',
    });
    expect(validateCeremony({ ...base, receivedChallengeHash: 'wrong' })).toEqual({
      ok: false,
      failure: 'challenge_mismatch',
    });
    expect(validateCeremony({ ...base, credential: credential({ status: 'revoked' }) })).toEqual({
      ok: false,
      failure: 'credential_revoked',
    });
    expect(validateCeremony({ ...base, receivedOrigin: 'https://evil.example.test' })).toEqual({
      ok: false,
      failure: 'origin_mismatch',
    });
    expect(validateCeremony({ ...base, receivedRpId: 'evil.example.test' })).toEqual({
      ok: false,
      failure: 'rp_id_mismatch',
    });
    expect(validateCeremony({ ...base, userVerified: false })).toEqual({
      ok: false,
      failure: 'user_verification_required',
    });
    expect(validateCeremony({ ...base, receivedSignCount: 2 })).toEqual({
      ok: false,
      failure: 'sign_count_regression',
    });
    expect(validateCeremony(base)).toEqual({ ok: true, nextSignCount: 4 });
  });

  it('keeps durable credential/challenge models free of vault and authentication secrets', () => {
    const credentialColumns = Object.keys(accountPasskeyCredentials);
    const challengeColumns = Object.keys(accountWebAuthnChallenges);

    expect(credentialColumns).toEqual(
      expect.arrayContaining(['accountId', 'credentialId', 'publicKey', 'signCount', 'revokedAt']),
    );
    expect(challengeColumns).toEqual(
      expect.arrayContaining(['challengeHash', 'expiresAt', 'consumedAt', 'origin', 'rpId']),
    );
    expect(credentialColumns).not.toEqual(expect.arrayContaining(['privateKey', 'prfOutput', 'vaultPlaintext']));
    expect(challengeColumns).not.toEqual(expect.arrayContaining(['pin', 'password', 'prfOutput']));
  });
});

function ceremonyInput() {
  return {
    challenge: {
      challengeHash: 'challenge-hash-1',
      consumedAt: null,
      expiresAt: new Date('2026-08-22T00:01:00Z'),
      origin: 'https://app.example.test',
      rpId: 'app.example.test',
      userVerification: 'required' as const,
    },
    credential: credential(),
    expectedAccountId: 'account-1',
    expectedUserId: 'user-1',
    now,
    receivedChallengeHash: 'challenge-hash-1',
    receivedCredentialId: 'credential-external-1',
    receivedOrigin: 'https://app.example.test',
    receivedRpId: 'app.example.test',
    userVerified: true,
    storedSignCount: 3,
    receivedSignCount: 4,
  };
}
