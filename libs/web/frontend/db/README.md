# Browser database and vault adapters

Provisional browser implementation of the platform-neutral contracts in
`@visomi-stack/shared-db`: contextual AES-256-GCM/HKDF, RSA-OAEP/P-256,
explicit PRF/PIN unlock, ciphertext IndexedDB, independent device custody and opaque sync.
The explicitly selected `PinUnlock` adapter supports offline short-PIN unlock
with a fixed Argon2id profile and disclosed offline guessing limitations; see the
[PIN contract](../../../../docs/architecture/contracts/offline-pin.md).
Cloud login never unwraps a key. Unsupported PRF blocks instead of enabling a
server-readable fallback. Operational keys are nonextractable; cleanup in managed
runtimes is best effort.

`BrowserVault` owns one independently lockable key scope/generation. `seal` commits
an encrypted local unit; `encrypt` prepares ciphertext for an atomic sync outbox.
`DeviceCustody` keeps private device identity in an independent local unlock vault,
never under a shared resource DEK. Recipient installation requires a signed witness
and an explicitly trusted signing pin. Do not obtain that pin solely from a cloud
roster. Low-level OAEP decryption is not an enrollment approval workflow.

`SyncReplica` checks contextual AEAD through its consumer callback, verifies
predecessor/checkpoints and commits ciphertext/pins atomically. The callback must
validate domain schema/kind and clear decrypted bytes. Conflicts/offline failures
retain an encrypted pending copy. Only exact authenticated history acknowledges it;
`resolve` is an explicit domain/user rebase or discard decision, never retry logic.
Consumers own cloud-session/lock cancellation and historical-generation key access.
The Angular adapter demonstrates those boundaries in the development example.
`@visomi-stack/web-frontend-db/storage` is a separate entrypoint, dynamically loaded
by the Angular `ClientDatabase` service only in a valid browser/account context.
The primary crypto entrypoint does not eagerly import Dexie.
The IndexedDB adapters use typed Dexie transactions with optimistic caching and
implicit reopening disabled. Native version-one schemas, keys and ciphertext remain
unchanged. Dynamic opening validates existing formats without automatic schema
patching; unsupported formats fail closed. Crypto and HTTP stay outside database
transactions. The Angular lazy database facade handles browser/account/context
checks; consumers own connection cleanup. See the consumer guide for route reuse,
late responses, canceled navigation and encrypted-outbox preservation.

Encrypted exports are bounded batches; restore is atomic into an empty destination
and remains locked. Restored/user-recovered wrappers exhaust the old generation's
local write budget and require rotation before new writes. Recovery requires an
explicit product policy and disposable user-held secret. It is not a password-reset
or cloud custody capability and does not choose Nive recovery actors.

Public synthetic vectors use independent Node cipher/KDF/signature APIs and fixed
RSA decode fixtures. Deliberately public private fixture keys must never protect
real data. Both APIs can share an underlying provider. Executed Node/Chromium
comparisons are not independent security review, native interoperability or hardware
attestation.

```sh
pnpm nx run-many -t test,lint,typecheck,typecheck-tests,vectors-check -p web-frontend-db,shared-db
```

`vectors-check` verifies the fixed public fixtures. Explicit generator flags rewrite
fixtures for a reviewed protocol edit; production APIs never expose deterministic
randomness. Actual browser tests use the existing installed Playwright/Vite tooling
and synthetic local resources, without enabling external capture.

Read the [consumer guide](../../../../docs/persistence.md),
[protocol](../../../../docs/architecture/contracts/persistence-v1.md),
[key/sync contract](../../../../docs/architecture/contracts/persistence-keys-sync.md)
and [executed evidence](../../../../docs/reviews/persistence-milestone.md).
Server retention now has an explicit bounded maintenance adapter; expired-history
and operation errors preserve local pins/outboxes. Automatic expired-history
bootstrap remains unsupported. Global nonce accounting, independent crypto review,
provider operations and additional runtimes remain release work; no production
acceptance is claimed.

Angular consumers share their session/database services and vault components in
`apps/web/app/src/app/shared/db`; the authenticated layout owns route-specific
composition. This SDK retains browser primitives without an Angular dependency.
