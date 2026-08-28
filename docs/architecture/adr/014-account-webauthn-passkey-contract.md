# ADR 014: Account WebAuthn and Passkey Contract

## Status

Accepted as the contract and persistence foundation for PASSKEY-001. HTTP
ceremonies and Angular UX are delivered by later work.

## Account identity and gating

The corrected P3/P4 contract consumes PASSKEY-010 research at
`docs/product/passkey-ux-security-research.md#passkey-010-findings`,
`#passkey-010-invariants`, `#passkey-010-flows`,
`#passkey-010-state-translation`, `#passkey-010-threat-decisions`, and
`#passkey-010-blockers`, including the downstream citation map in section 9.1.
These are normative traceability references; PASSKEY-001 does not resolve the
five blockers recorded there.

Executable contract evidence is in
`apps/web/api/src/auth/passkey-contract.spec.ts`. It maps pending activation and
terminal cleanup to `#passkey-010-flows` and `#passkey-010-state-translation`,
multi-passkey lifecycle and last-method protection to `#passkey-010-journeys`,
and ownership, enumeration, password controls, audit redaction, and the
account-session/vault boundary to `#passkey-010-threat-decisions`. Session
effects remain caller-selected from an approved policy; `unresolved` fails
closed so this contract does not decide the PASSKEY-010 session-policy blocker.

An account-authentication flow always starts with a mandatory canonical email.
Canonicalization applies Unicode NFKC normalization, trimming, and invariant
lower-casing before lookup, uniqueness checks, or storage; equivalent email
representations therefore identify the same account.
The account may not register or use a passkey until the email verification PIN
has completed and `users.email_verified_at` is set. The email/PIN gate is an
account-authentication prerequisite, not a vault unlock mechanism.

WebAuthn is the default registration and sign-in method. A cancelled,
unsupported, or failed ceremony enters `retry_available`; the client must offer
retry before exposing password fallback. An explicit password choice may enter
`password_fallback` immediately. Neither path bypasses the email/PIN gate.

## Durable model

`account_passkey_enrollments` stores the canonical email, pending/terminal
status, the bound credential identity, expiry, and activation timestamps. The
bound credential is not session-eligible until mandatory email verification
atomically activates that enrollment. Expired, replayed, mismatched, cancelled,
and superseded enrollments are terminal; cleanup cannot activate their
credentials.

Activation is represented as one model operation that validates account, user,
canonical-email, credential, and verification-challenge binding before
returning the active account, consumed challenge, active enrollment, and active
credential together. A failed binding, expired or consumed verification, or a
terminal enrollment cannot produce a partially active result. Terminal cleanup
makes the bound credential unusable before removing it, and retry requires a
new enrollment.

`account_passkey_credentials` is account-scoped and references both the account
and owning user. It stores the credential ID, opaque COSE public key, RP ID,
display label, transports, backup flags, sign count, use/revocation timestamps,
and no private or PRF material. Credential IDs are unique at the RP and labels
are unique within an account. Pending enrollment binding is represented by the
enrollment's credential identity and terminal enrollment status. Revocation is represented by `revoked_at`; a
revoked credential is never accepted again, while other credentials remain
usable.

Lifecycle operations select credentials by the external credential ID plus
account and user ownership while preserving the stable internal ID. Missing,
cross-account, and cross-user selections return the same `credential_not_found`
result. Add, name, list, use, and revoke are independently modeled; repeated
revoke is idempotent. Viability is calculated from credential records rather
than a caller-provided count: only active passkeys and configured password
access count, while pending, expired, revoked, and unusable methods do not.

Later password setup fails closed unless recent reauthentication, password
policy, CSRF, distributed rate-limit, approved session effect, audit, and
redaction controls all pass independently. Its result contains only a redacted
audit event and never contains the submitted password secret. Account discovery
and cross-account credential failures use equivalent public outcomes to avoid
account or ownership enumeration.

`account_webauthn_challenges` stores a one-way challenge hash, purpose
(`registration` or `authentication`), account/user binding, expected RP ID and
origin, user-verification policy, expiry, attempt count, and `consumed_at`.
Challenges are short-lived, consumed transactionally on success, and rejected
when expired or already consumed. Raw challenge bytes are not durable data.

## Ceremony verification contract

The server creates a fresh random challenge and verifies the WebAuthn client
data type, compares the received challenge hash to the durable challenge, and
checks the exact configured origin, exact RP ID hash, and configured
user-verification requirement. Authentication selects a credential by its
stable credential ID, checks active account ownership, and rejects a revoked
credential with `credential_revoked`. A received sign count below the stored
count is `sign_count_regression` and fails closed;
equal counters are accepted for authenticators that do not increment counters,
and a larger counter is persisted. All successful ceremonies consume the
challenge and update `last_used_at`.

Failure taxonomy is explicit: `email_required`, `email_unverified`,
`pin_required`, `challenge_expired`, `challenge_replayed`,
`challenge_mismatch`, `origin_mismatch`, `rp_id_mismatch`,
`user_verification_required`, `credential_not_found`, `credential_revoked`,
`sign_count_regression`, `ceremony_cancelled`, and `platform_error`. Responses
and logs must not include credential public-key bytes, challenge values,
assertions, PINs, or passwords.

## Boundary with zero-knowledge data

An account session proves account identity and authorization only. It does not
unlock a PRF-derived vault key, expose vault plaintext, or authorize metadata
payload reads. A later, explicit local vault-unlock ceremony may use the
WebAuthn PRF adapter from ADR 013; that result remains local and is never put
in account credential rows, sessions, auth challenges, or metadata APIs.

Session claims may contain account ID, user ID, role, authentication method,
credential ID, and authentication time/assurance. They must not contain PRF
output, vault keys, vault plaintext, or encrypted metadata payloads.
