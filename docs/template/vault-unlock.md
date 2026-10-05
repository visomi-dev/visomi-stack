# Browser vault custody and unlock methods

Account sign-in is not encryption-key unlock. The application binds a browser
`VaultSession` to the current user, active account and authentication version. SSR
uses a deterministic locked implementation and never receives keys, PINs, recovery
strings or browser storage. The security screen is `/app/<locale>/security/vault`.

## Key custody

`BrowserVaultSession` keeps a non-extractable AES-GCM data key and a non-extractable
in-memory capsule key through `VaultKeySession`. Raw decoded recovery bytes and
unwrapped keys are erased after import. Recovery uses the `stack1.` contract.
Unlock forces an uncached authoritative session check and validates the installed
key against any canonical DEK-encrypted PIN profile. A random replacement key
cannot open an existing profile, including a revoked profile.

Owner/account/version changes, logout, page exit, lifecycle destruction, cross-tab
lock messages and fifteen minutes of inactivity clear custody. Idle duration uses
a monotonic browser clock, not serialized dates. Trusted keyboard/pointer activity
extends the idle interval. Visible resume and a one-minute polling interval force
session/config checks; a failed check locks the vault. These checks are bounded
and do not claim instantaneous remote revocation or recall of downloaded keys.

Consumers register as borrowers and must implement `lock()` to drop borrowed
references. Long-running worker/sync operations register cancellation with
`onLock()`. Cleanup continues if another consumer throws. Generation checks prevent
late asynchronous work from restoring keys after a lock or identity change.

## PIN enrollment and revocation

PINs contain six digits and reject uniform or consecutive sequences. Each attempt
uses a fresh dedicated Argon2id worker with the fixed profile documented in
`shared-crypto/vault-pin`; PIN derivation is never performed on the API. The
worker asset retains its isolated WASM policy without relaxing page CSP.

Enrollment requires explicit action and a fresh single-use
`vault_unlock_manage` operation grant. The DEK-encrypted canonical verifier is
user/account scoped; a PIN-wrapped key stays only in the local
`visomi-vault-unlock` IndexedDB database and is never included in opaque sync.
Enrollment verifies a wrap/open/profile round trip before publishing the profile
and persisting local consent. Web Locks serialize local read/derive/write sequences.
Re-enrolling another browser must match the canonical PIN; changing that PIN uses
a new method ID and invalidates earlier browser enrollments.

The canonical profile has a membership foreign key and account/user RLS policy.
The API validates active account, membership and auth-version inside transactions.
Profile compare-and-swap rejects stale updates. Revocation sets the canonical
method inactive but retains its DEK-encrypted continuity anchor. Reauthentication
alone cannot decrypt that anchor, restore a lost DEK or silently create a new key.

Before deriving locally, the browser consumes one durable attempt through
`POST /api/vault-unlock/:scopeId/pin-attempt`. The database serializes five attempts
per ten-minute window across sessions and browsers. The sixth is rejected with 429. A client-reported success cannot reset this budget: the server intentionally
does not know the PIN or verify its plaintext. A reauthenticated canonical profile
replacement can reset it. This is an **online cooperative-client budget**, not
protection against offline attacks on stolen PIN ciphertext or hostile JavaScript.

## Recovery export

Revealing a recovery string requires explicit action and a fresh single-use
`vault_recovery_export` grant. Authorization returns no key material; export occurs
only in the unlocked browser. The screen clears sensitive fields/revealed strings
on custody-generation changes. Recovery strings are not sent to the API, logged,
stored in application state persistence, or automatically copied to the clipboard.

## PRF assertion and enrollment authority

The API supports session-bound, sixty-second UV-required assertions at
`POST /api/vault-unlock/:scopeId/assertions/{begin,complete}`. The selected active
credential must belong to the current account and user. Completion verifies the
challenge, RP/origin, credential and signature before returning either a single-use
enrollment proof or the encrypted envelope. The API rejects PRF extension output.

`GET /api/vault-unlock/:scopeId/methods` returns safe active metadata only. Enrollment
requires a fresh verified proof, matching envelope binding/input and a management
grant; revocation requires that grant and the current revision. A removed passkey
or membership invalidates access. Downloaded keys cannot be recalled.

The route-owned `PrfUnlock` service keeps output browser-local, erases it on every
exit, validates wrap/open before publishing and cancels departing-owner/locked work.
Custody checks the source method again before installation and on authority refresh.
The English/Spanish passkey panel uses shared buttons and the existing purpose-bound
confirmation UI. Enable it with `VAULT_PRF_ENABLED=true`; the default/example value
is false. The API also rejects PRF endpoints with 503 when disabled. PIN/recovery
routes remain independent. Unsupported authenticators cannot downgrade encryption.
Passkey creation negotiates capability only; it never automatically enrolls custody.

## Signed browser delivery relay

`/api/vault-unlock/:scopeId/browser-enrollments` accepts an owner/account-bound
signed recipient pairing expiring within ten minutes. It does not receive a DEK or
recovery string. The API stores only signed public pairing metadata and optional
recipient ciphertext. Inspection never reveals ciphertext. A different session
must match the fingerprint and consume a fresh management grant to approve.

Consumption requires the original requesting session and a recipient signature
covering pairing, timestamp and nonce. Delivery is single-use. Cancellation,
consumption and expired-request cleanup erase ciphertext; cleanup commits even
when an expired operation is rejected. Five active requests per account/user are
allowed. Pairing verification validates P-256 signatures and 3072-bit RSA encryption
keys; OAEP context labels prevent delivery substitution across requests or owners.
Trusted memory-session callbacks and durable PostgreSQL triggers erase temporary
relay ciphertext and pending assertions on session revocation, deletion or authority
scope changes. User auth-version changes erase old-version temporary custody;
membership removal cascades. Ordinary logout does not delete durable PRF methods.
The English/Spanish settings panel now owns explicit request, code comparison,
reauthenticated approval, receipt and cancellation. Recipient signing/encryption keys
are non-extractable and route-owned; cancellation, expiry, owner changes and route
destruction drop them. Raw DEK bytes remain inside the capsule delivery callback and
are erased after recipient encryption. Delivery installation validates the retained
PIN continuity anchor and forces authoritative session lookup.

Enable browser delivery with `VAULT_BROWSER_ENABLED=true`. The default/example value
is false; disabled relay endpoints return 503 independently of PIN, recovery and PRF.

## Encrypted workspace consumers

The route-owned `VaultSync` borrower attaches an existing enrolled workspace/device
through the opaque gateway endpoint. Attachment validates workspace membership and
device enrollment before publishing cached plaintext. It does not create a device,
approve enrollment, or treat account authentication as vault unlock.

Portable work/planning/progress changes are AES-GCM encrypted with a non-extractable
borrowed key. AAD authenticates every routing/ordering field, including revision,
timestamp, account/user scope and tombstone metadata. The API never receives the
decrypted change. `visomi-encrypted-projections` stores only envelopes, partitioned
by user/account/workspace. Batch application commits atomically, rejects same-revision
substitution, deduplicates exact replay and caps each partition at 10,000 envelopes.
Quota/cancellation failures do not acknowledge a cursor. Decryption/integrity checks
and durable archive application precede pull acknowledgement.

Lock, owner-version changes and view destruction abort transport, drop borrowed keys
and clear in-memory projections. Authoritative session/device rejection detaches the
consumer; transient network failures retain the encrypted queue. Adapters are recreated
after reattachment rather than reusing a departing session's authorization.

The localized settings panel connects already-enrolled IDs, shows projection counts
and pending/blocked/conflicting revisions, and permits explicit exact-revision discard
of rejected uploads. Discard stops only that upload; it retains the local encrypted
projection and does not silently select a cloud winner or delete another revision.
Feature consumers can stage changes through `VaultSync.stage`; no Nive finance or
household editor is imported. Historical archive compaction and provider failover
need a separate checkpoint/retention design when the bounded archive fills.

## Verification and remaining integration

The native Chromium scenario uses a real gateway, virtual verified WebAuthn
authenticator, dedicated Argon2 worker, IndexedDB and reauthentication grants. It
covers enrollment, incorrect/correct PINs, reload locking, recovery continuity,
revocation, recovery after revocation, Spanish rendering and an AXE audit. No PIN
derivation or vault HTTP request is mocked in that scenario.

Run after loading Node with `fnm` and exporting `NX_DAEMON=false`:

```sh
pnpm nx run app:vite:test --run vault shared/realtime
pnpm nx run shared-crypto:test --runInBand --testPathPatterns=vault-pin
DATABASE_DRIVER=memory pnpm nx run api:test --runInBand --testPathPatterns=vault-unlock
pnpm nx run app-e2e:e2e --grep='enrolls a local PIN with real Argon2'
pnpm nx run app-e2e:e2e --grep='native PRF vault unlock|native passkey without PRF'
pnpm nx run app-e2e:e2e --grep='connects isolated authenticated browsers|restores encrypted projections'
```

Use the isolated gateway/Redis/local-agent configuration from
`docs/agents/e2e.md` when default ports are occupied. The new PIN migration must be
applied through the normal production migration process, not from this browser test.

The PIN, PRF assertion and relay suites also support disposable PostgreSQL
verification. Set `DATABASE_DRIVER=pg`, `DATABASE_SSL=false` and identical explicit
`DATABASE_URL`/`VAULT_UNLOCK_TEST_DATABASE_URL` values naming a loopback
`themis_api_e2e` database. Use `--skip-nx-cache`. Do not point these tests at shared
or production data. PRF WebAuthn verification is mocked in that API suite; browser
relay signatures and encryption are real. PostgreSQL transactions/cascades are
verified, but non-superuser RLS certification remains separate.

Native PRF verification uses Chromium's virtual CTAP2.1 authenticator against the
real gateway: no PRF evaluation or assertion HTTP is mocked. It checks continuity,
reload locking, purpose-bound enrollment/revocation, unsupported authenticators,
Spanish rendering and AXE. It does not certify physical authenticator vendors.

Native browser relay verification uses two isolated real sessions, signed pairing,
recipient encryption and gateway approval/consumption without mocked relay HTTP.
The synthetic authenticator credential is cloned only to establish the second test
session; production credentials are never exported. Incorrect codes, single-use
delivery, key continuity, cancellation, reload locking, Spanish rendering and AXE
are covered. A separate native sync scenario checks actual device authorization,
ciphertext-only persistence, reload restoration, lock cleanup and device revocation.
Browser delivery and PRF remain explicit deployment opt-ins. Whole-port strict
tooling refactors and final clean-copy verification are still outstanding.
