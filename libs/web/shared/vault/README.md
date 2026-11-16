# Web vault and ciphertext sync adapters

Provisional browser implementation of the platform-neutral contracts in
`@visomi-stack/shared-persistence`: contextual AES-256-GCM/HKDF, RSA-OAEP/P-256,
PRF-only unlock, ciphertext IndexedDB, independent device custody and opaque sync.
Cloud login never unwraps a key. Unsupported PRF blocks instead of enabling a
server-readable fallback. Operational keys are nonextractable; cleanup in managed
runtimes is best effort.

`BrowserVault` owns one independently lockable key scope/generation. `seal` commits
an encrypted local unit; `encrypt` prepares ciphertext for an atomic sync outbox.
`DeviceCustody` keeps private device identity in an independent local PRF vault,
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
pnpm nx run-many -t test,lint,typecheck,typecheck-tests,vectors-check -p web-shared-vault,shared-persistence
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
