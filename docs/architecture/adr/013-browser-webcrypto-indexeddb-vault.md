# ADR 013: Browser WebCrypto and IndexedDB Vault

## Status

Accepted for the browser adapter boundary; Angular projection and agent bridge remain outside ZK-019.

## Decision

The browser client stores only canonical serialized encrypted envelopes and
wrapped workspace-key metadata in IndexedDB. WebCrypto performs HKDF
domain-separated workspace-key wrapping and AES-256-GCM record encryption. The
unlock authenticator remains injected. ZK-019 supplies a WebAuthn/Passkey
ceremony adapter with PRF detection and a deterministic PRF-derived unwrap key.
If PRF is unavailable, only an explicitly enabled local-only PBKDF2 fallback
with a user secret is permitted; there is no server-readable fallback. Recovery
material is generated locally, stored only as a digest, requires confirmation,
is single-use, and can be revoked.

The cloud and themis-agent are not dependencies of this local boundary. A
locked vault drops its in-memory workspace key and rejects reads and writes.
Reloading opens the IndexedDB database locked; an authenticator must explicitly
unlock it. Closing also locks before closing the database connection.
Recovery material is generated locally, stored only as a digest, requires
explicit user confirmation both to enroll and to use, is single-use, and can
be revoked. Authenticator replacement and lost-device conditions remain
recovery-required until the approved recovery path is completed.

## Storage boundary

IndexedDB contains the vault schema version, workspace routing identifier, HKDF
salt, wrapped workspace key, wrapping nonce, and canonical envelope strings.
Plaintext records, raw VMK material, and unwrapped workspace keys are not
persisted. The browser origin remains the security boundary; IndexedDB is not
treated as a secret store by itself. Ceremony adapters bind to the current
browser origin; origin-mismatched fixtures and RP substitutions fail closed
before fallback selection.

Malformed, unsupported-version, non-canonical, tampered, and failed-decryption
records fail closed without returning plaintext. IndexedDB errors are surfaced
as storage failures so callers can distinguish quota/transaction problems from
cryptographic integrity failures.

## Consequences

The implementation is usable offline and has no network or agent bridge. The
adapter reports locked, ready, unavailable, cancelled, lockout, wrong
credential, recovery-required, revoked, authenticator-replaced, lost-device,
origin-mismatch, platform-error, and unsafe-fallback states. It does not
integrate Angular, synchronization, or conflict resolution.
