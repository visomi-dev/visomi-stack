type PasskeyFailure =
  | 'email_required'
  | 'email_unverified'
  | 'pin_required'
  | 'challenge_expired'
  | 'challenge_replayed'
  | 'challenge_mismatch'
  | 'origin_mismatch'
  | 'rp_id_mismatch'
  | 'user_verification_required'
  | 'credential_not_found'
  | 'credential_revoked'
  | 'sign_count_regression'
  | 'ceremony_cancelled'
  | 'platform_error';

type EmailGate = 'email_required' | 'email_unverified' | 'pin_required' | 'ready';
type PasskeyAttempt = 'passkey_default' | 'retry_available' | 'password_fallback' | 'authenticated';
type CredentialStatus = 'pending' | 'active' | 'revoked' | 'expired' | 'unusable';
type UserVerification = 'required' | 'preferred' | 'discouraged';
type EnrollmentStatus = 'pending' | 'active' | 'expired' | 'replayed' | 'mismatched' | 'cancelled' | 'superseded';
type TerminalEnrollmentStatus = Exclude<EnrollmentStatus, 'pending' | 'active'>;

type AccountSessionClaims = {
  accountId: string;
  authenticatedAt: Date;
  authenticationMethod: 'passkey' | 'password';
  credentialId?: string;
  userId: string;
};

type ChallengeExpectation = {
  challengeHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
  origin: string;
  rpId: string;
  userVerification: UserVerification;
};

type PasskeyCredential = {
  accountId: string;
  createdAt: Date;
  credentialId: string;
  id: string;
  lastUsedAt: Date | null;
  name: string;
  status: CredentialStatus;
  userId: string;
};
type CredentialOwner = Pick<PasskeyCredential, 'accountId' | 'userId'>;
type PasswordAccess = CredentialOwner & { configured: boolean };

type CeremonyResult = { ok: true; nextSignCount: number } | { ok: false; failure: PasskeyFailure };
type EnrollmentEvent = 'expire' | 'replay' | 'mismatch' | 'cancel' | 'supersede';
type PendingEnrollmentModel = {
  account: { accountId: string; email: string; emailVerified: boolean; status: 'pending' | 'active'; userId: string };
  challenge: { challengeHash: string; consumedAt: Date | null };
  credential: PasskeyCredential | null;
  enrollment: {
    accountId: string;
    credentialId: string;
    email: string;
    expiresAt: Date;
    id: string;
    status: EnrollmentStatus;
    userId: string;
  };
};
type ActivationResult =
  | { ok: true; state: PendingEnrollmentModel }
  | { ok: false; failure: 'enrollment_terminal' | 'verification_rejected'; state: PendingEnrollmentModel };
type CredentialLifecycleResult =
  | { ok: true; credentials: PasskeyCredential[]; credential: PasskeyCredential }
  | {
      ok: false;
      failure: 'credential_not_found' | 'credential_already_exists' | 'credential_name_conflict' | 'last_access_method';
      credentials: PasskeyCredential[];
    };
type PasswordSetupControl =
  | 'reauthentication'
  | 'password_policy'
  | 'csrf'
  | 'rate_limit'
  | 'session_policy'
  | 'audit'
  | 'redaction';
type PasswordSetupInput = {
  accountId: string;
  auditEnabled: boolean;
  csrfValid: boolean;
  passwordPolicyValid: boolean;
  passwordSecret: string;
  recentlyReauthenticated: boolean;
  redactSecrets: boolean;
  sessionEffect: 'unresolved' | 'rotate_current' | 'rotate_all' | 'preserve';
  userId: string;
  withinRateLimit: boolean;
};
type PasswordSetupResult =
  | {
      ok: true;
      passwordConfigured: true;
      sessionEffect: Exclude<PasswordSetupInput['sessionEffect'], 'unresolved'>;
      audit: { accountId: string; action: 'password_configured'; redactedFields: ['password']; userId: string };
    }
  | { ok: false; failure: 'password_setup_denied'; failedControl: PasswordSetupControl };

function terminalizeEnrollment(
  state: PendingEnrollmentModel,
  status: TerminalEnrollmentStatus,
): PendingEnrollmentModel {
  if (state.enrollment.status !== 'pending') return state;

  return {
    ...state,
    credential: state.credential ? { ...state.credential, status: 'unusable' } : null,
    enrollment: { ...state.enrollment, status },
  };
}

function activatePendingEnrollment(
  state: PendingEnrollmentModel,
  input: { challengeHash: string; now: Date },
): ActivationResult {
  if (state.enrollment.status !== 'pending') return { ok: false, failure: 'enrollment_terminal', state };
  if (input.now >= state.enrollment.expiresAt)
    return { ok: false, failure: 'verification_rejected', state: terminalizeEnrollment(state, 'expired') };
  if (state.challenge.consumedAt)
    return { ok: false, failure: 'verification_rejected', state: terminalizeEnrollment(state, 'replayed') };

  const credential = state.credential;
  const bindingMatches =
    credential?.credentialId === state.enrollment.credentialId &&
    credential.accountId === state.enrollment.accountId &&
    credential.userId === state.enrollment.userId &&
    credential.status === 'pending' &&
    state.account.accountId === state.enrollment.accountId &&
    state.account.userId === state.enrollment.userId &&
    normalizeEmail(state.account.email) === normalizeEmail(state.enrollment.email);

  if (!bindingMatches)
    return {
      ok: false,
      failure: 'verification_rejected',
      state: { ...state, credential: null, enrollment: { ...state.enrollment, status: 'mismatched' } },
    };
  if (input.challengeHash !== state.challenge.challengeHash)
    return { ok: false, failure: 'verification_rejected', state: terminalizeEnrollment(state, 'mismatched') };

  return {
    ok: true,
    state: {
      account: { ...state.account, emailVerified: true, status: 'active' },
      challenge: { ...state.challenge, consumedAt: input.now },
      credential: { ...credential, status: 'active' },
      enrollment: { ...state.enrollment, status: 'active' },
    },
  };
}

function terminatePendingEnrollment(state: PendingEnrollmentModel, event: EnrollmentEvent): PendingEnrollmentModel {
  const statusByEvent: Record<EnrollmentEvent, TerminalEnrollmentStatus> = {
    expire: 'expired',
    replay: 'replayed',
    mismatch: 'mismatched',
    cancel: 'cancelled',
    supersede: 'superseded',
  };

  return terminalizeEnrollment(state, statusByEvent[event]);
}

function cleanupTerminalEnrollment(state: PendingEnrollmentModel): PendingEnrollmentModel {
  if (state.enrollment.status === 'pending' || state.enrollment.status === 'active') return state;

  return { ...state, credential: null };
}

function enrollmentRetryAction(status: EnrollmentStatus): 'retry_verification' | 'restart_enrollment' | 'none' {
  if (status === 'pending') return 'retry_verification';
  if (status === 'active') return 'none';

  return 'restart_enrollment';
}

function canEstablishSession(input: {
  enrollmentStatus: EnrollmentStatus;
  emailVerified: boolean;
  credentialStatus: CredentialStatus;
}): boolean {
  return input.enrollmentStatus === 'active' && input.emailVerified && input.credentialStatus === 'active';
}

function selectOwnedCredential(
  credentials: PasskeyCredential[],
  selector: { accountId: string; credentialId: string; userId: string },
): PasskeyCredential | null {
  return (
    credentials.find(
      (credential) =>
        credential.credentialId === selector.credentialId &&
        credential.accountId === selector.accountId &&
        credential.userId === selector.userId,
    ) ?? null
  );
}

function addCredential(credentials: PasskeyCredential[], credential: PasskeyCredential): CredentialLifecycleResult {
  if (
    credentials.some(
      (candidate) => candidate.id === credential.id || candidate.credentialId === credential.credentialId,
    )
  )
    return { ok: false, failure: 'credential_already_exists', credentials };
  if (
    credentials.some((candidate) => candidate.accountId === credential.accountId && candidate.name === credential.name)
  )
    return { ok: false, failure: 'credential_name_conflict', credentials };
  const added = { ...credential, status: 'active' as const };

  return { ok: true, credential: added, credentials: [...credentials, added] };
}

function nameCredential(
  credentials: PasskeyCredential[],
  selector: { accountId: string; credentialId: string; userId: string },
  name: string,
): CredentialLifecycleResult {
  const selected = selectOwnedCredential(credentials, selector);

  if (!selected) return { ok: false, failure: 'credential_not_found', credentials };
  if (
    credentials.some(
      (candidate) =>
        candidate.id !== selected.id && candidate.accountId === selector.accountId && candidate.name === name,
    )
  )
    return { ok: false, failure: 'credential_name_conflict', credentials };
  const renamed = { ...selected, name };

  return {
    ok: true,
    credential: renamed,
    credentials: credentials.map((credential) => (credential.id === selected.id ? renamed : credential)),
  };
}

function listCredentials(credentials: PasskeyCredential[], accountId: string, userId: string): PasskeyCredential[] {
  return credentials.filter((credential) => credential.accountId === accountId && credential.userId === userId);
}

function useCredential(
  credentials: PasskeyCredential[],
  selector: { accountId: string; credentialId: string; userId: string },
  usedAt: Date,
): CredentialLifecycleResult {
  const selected = selectOwnedCredential(credentials, selector);

  if (!selected || selected.status !== 'active') return { ok: false, failure: 'credential_not_found', credentials };
  const used = { ...selected, lastUsedAt: usedAt };

  return {
    ok: true,
    credential: used,
    credentials: credentials.map((credential) => (credential.id === selected.id ? used : credential)),
  };
}

function viableAccessMethodIds(
  credentials: PasskeyCredential[],
  owner: CredentialOwner,
  passwordAccess: PasswordAccess,
): string[] {
  const ids = credentials
    .filter(
      (credential) =>
        credential.accountId === owner.accountId &&
        credential.userId === owner.userId &&
        credential.status === 'active',
    )
    .map((credential) => credential.id);
  const ownerHasPassword =
    passwordAccess.accountId === owner.accountId && passwordAccess.userId === owner.userId && passwordAccess.configured;

  return ownerHasPassword ? [...ids, 'password'] : ids;
}

function canRemoveAccessMethod(
  credentials: PasskeyCredential[],
  owner: CredentialOwner,
  passwordAccess: PasswordAccess,
  methodId: string,
): boolean {
  return viableAccessMethodIds(credentials, owner, passwordAccess).some((id) => id !== methodId);
}

function revokeCredential(
  credentials: PasskeyCredential[],
  selector: { accountId: string; credentialId: string; userId: string },
  passwordAccess: PasswordAccess,
): CredentialLifecycleResult {
  const selected = selectOwnedCredential(credentials, selector);

  if (!selected) return { ok: false, failure: 'credential_not_found', credentials };
  if (selected.status === 'revoked') return { ok: true, credential: selected, credentials };
  if (!canRemoveAccessMethod(credentials, selector, passwordAccess, selected.id))
    return { ok: false, failure: 'last_access_method', credentials };
  const revoked = { ...selected, status: 'revoked' as const };

  return {
    ok: true,
    credential: revoked,
    credentials: credentials.map((credential) => (credential.id === selected.id ? revoked : credential)),
  };
}

function configurePassword(input: PasswordSetupInput): PasswordSetupResult {
  const controls: Array<[PasswordSetupControl, boolean]> = [
    ['reauthentication', input.recentlyReauthenticated],
    ['password_policy', input.passwordPolicyValid],
    ['csrf', input.csrfValid],
    ['rate_limit', input.withinRateLimit],
    ['session_policy', input.sessionEffect !== 'unresolved'],
    ['audit', input.auditEnabled],
    ['redaction', input.redactSecrets],
  ];
  const failed = controls.find(([, passed]) => !passed);

  if (failed) return { ok: false, failure: 'password_setup_denied', failedControl: failed[0] };

  const sessionEffect = input.sessionEffect as Exclude<PasswordSetupInput['sessionEffect'], 'unresolved'>;

  return {
    ok: true,
    passwordConfigured: true,
    sessionEffect,
    audit: {
      accountId: input.accountId,
      action: 'password_configured',
      redactedFields: ['password'],
      userId: input.userId,
    },
  };
}

function accountDiscoveryResponse(_accountExists: boolean): { next: 'check_email'; message: string } {
  return { next: 'check_email', message: 'If the account can continue, check the email for the next step.' };
}

function emailGate(email: string | null, verifiedAt: Date | null, pinVerified: boolean): EmailGate {
  if (!email || !normalizeEmail(email)) return 'email_required';
  if (!verifiedAt) return 'email_unverified';
  if (!pinVerified) return 'pin_required';

  return 'ready';
}

function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function nextPasskeyAttempt(input: {
  ceremonyFailed?: boolean;
  explicitPassword?: boolean;
  retryRequested?: boolean;
}): PasskeyAttempt {
  if (input.explicitPassword) return 'password_fallback';
  if (input.retryRequested || input.ceremonyFailed) return 'retry_available';

  return 'passkey_default';
}

function validateCeremony(input: {
  challenge: ChallengeExpectation;
  credential: PasskeyCredential | null;
  expectedAccountId: string;
  expectedUserId: string;
  now: Date;
  receivedChallengeHash: string;
  receivedCredentialId: string;
  receivedOrigin: string;
  receivedRpId: string;
  userVerified: boolean;
  storedSignCount: number;
  receivedSignCount: number;
}): CeremonyResult {
  if (
    !input.credential ||
    input.credential.credentialId !== input.receivedCredentialId ||
    input.credential.accountId !== input.expectedAccountId ||
    input.credential.userId !== input.expectedUserId ||
    (input.credential.status !== 'active' && input.credential.status !== 'revoked')
  )
    return { ok: false, failure: 'credential_not_found' };
  if (input.challenge.consumedAt) return { ok: false, failure: 'challenge_replayed' };
  if (input.now >= input.challenge.expiresAt) return { ok: false, failure: 'challenge_expired' };
  if (input.receivedChallengeHash !== input.challenge.challengeHash)
    return { ok: false, failure: 'challenge_mismatch' };
  if (input.receivedOrigin !== input.challenge.origin) return { ok: false, failure: 'origin_mismatch' };
  if (input.receivedRpId !== input.challenge.rpId) return { ok: false, failure: 'rp_id_mismatch' };
  if (input.credential.status === 'revoked') return { ok: false, failure: 'credential_revoked' };
  if (input.challenge.userVerification === 'required' && !input.userVerified)
    return { ok: false, failure: 'user_verification_required' };
  if (input.receivedSignCount < input.storedSignCount) return { ok: false, failure: 'sign_count_regression' };

  return { ok: true, nextSignCount: input.receivedSignCount };
}

export {
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
  selectOwnedCredential,
  terminatePendingEnrollment,
  useCredential,
  validateCeremony,
  viableAccessMethodIds,
  type AccountSessionClaims,
  type ActivationResult,
  type CeremonyResult,
  type ChallengeExpectation,
  type CredentialLifecycleResult,
  type CredentialOwner,
  type EmailGate,
  type EnrollmentEvent,
  type EnrollmentStatus,
  type PasskeyAttempt,
  type PasskeyCredential,
  type PasskeyFailure,
  type PasswordSetupInput,
  type PasswordSetupResult,
  type PasswordAccess,
  type PendingEnrollmentModel,
  type UserVerification,
};
