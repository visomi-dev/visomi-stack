# Persistence acceptance follow-up

Baseline: main `6c7cc6104c85f1c2fb5ad405ac073fffcc26772b` after PR #26. This
engineering review uses the existing [protocol](../architecture/contracts/persistence-v1.md),
[device and sync contract](../architecture/contracts/persistence-keys-sync.md),
[retention contract](../architecture/contracts/persistence-retention.md) and
[prior execution record](persistence-milestone.md).

## VIS-68 and VIS-73 — account for invocations before encryption

The outbox retries identical ciphertext. Rebase invokes encryption again.
The WebCrypto adapter imports a 256-bit AES key and generates a 96-bit random IV
for each data encryption. AAD binds key scope, generation, object and operation
context. IV uniqueness is a separate property. Wrapping derives a KEK using
HKDF-SHA-256 with a new 256-bit salt and contextual info. The offline PIN wrapper
has its own [contract](../architecture/contracts/offline-pin.md).

`BrowserVault` commits a reservation before invoking WebCrypto. The IndexedDB
key row is scoped to owner, key domain and generation within a storage database.
Independent connections to that database share the counter. Abort after
reservation, encryption failure and failed unit CAS spend that reservation.
Restore by the supported encrypted backup or user-held recovery path exhausts
the restored generation's budget. Signing, reads and retries of existing
ciphertext do not consume encryption reservations.

Holding at most 64 approved devices and allowing at most 2^20 encryptions per
local budget would yield at most 2^26 invocations if each device had one
non-resettable budget. For independent uniform random 96-bit IVs, the union bound
would then be less than 2^-45. The implementation cannot establish this premise
across duplicated device custody, independent browser profiles, rolled-back
storage or repeated import paths. The active roster and server admission counts
cannot count joins, discarded local encryptions and offline work across copies.
A server-side check after encryption cannot restore confidentiality after IV reuse.
[NIST SP 800-38D, sections 8 and 8.3](https://csrc.nist.gov/pubs/sp/800/38/d/final).

| Candidate for review                                                    | Tradeoff and required evidence                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Irrevocable grants of bounded, disjoint IV ranges under a generation    | Clear allocation accounting. Offline writes require a prior lease. Copied or rolled-back client state could reuse a range and counter. A reviewed restore/copy authority must prevent further writing with an old lease.                                             |
| Per-writer subkeys with authenticated writer epochs and per-key budgets | Compartmentalizes collisions across writers while retaining a scope DEK. Requires a versioned HKDF and AAD contract, accepted writer provenance and a rule for distinct epochs after state loss. A fork with the same copied writer state still has to be addressed. |
| Require rekeying or an online operation after trusted state loss        | Bounds the circumstances that permit writes. Changes offline availability and recovery UX. Prove behavior under concurrent writers, restarts and restoration of any older state.                                                                                     |

Review the invocation policy and wire compatibility together before choosing a
protocol. Validate vectors for normal and malformed envelopes, interrupted
reservation, retry versus rebase, concurrent writer, copy/restore, revoked
writer and cross-generation cases. The existing Node/WebCrypto check and a
Chromium test of the IndexedDB counter are implementation evidence. The browser regression also exhausts the two-reservation fixture across IndexedDB reopen after a stale CAS and verifies the prior ciphertext is preserved. An
independent reviewer still owns the cryptographic/threat-model assessment.
Swift, Kotlin and desktop adapters need their own conformance evidence.

## VIS-70 — recovery and devices

`KeyDevices` already implements scoped challenge, possession, approval, roster,
delivery, revocation and rotation. The example client has local device custody,
explicit unlock and first-device enrollment. Sign-in device approval and password
reset recover authentication. Restoring an encrypted resource key does not grant
device-signing authority. Retained-generation grants disclose that history to
the recipient, and revocation cannot recall keys the device has copied.

The missing administration view can reuse the registry and signed operations.
The expected states are awaiting approval, active, revoked with rotation
required, and ready after atomic rotation. Enrollment acknowledgement needs
to distinguish new access from access that includes historical generations.
The authorization and possession checks remain server enforced during each
mutation. Integration fixtures already exercise consumed challenges, signed
delivery, wrong context and interrupted rotation.

Michael needs to select the product behavior after total signing-device loss.
With no recovery authority, that loss can make both access and administrative
continuity irreversible. A user-held encrypted custody backup preserves a
signing identity if the user can restore it, with the copy/rollback and nonce
implications above. A designated recovery actor or quorum introduces a new
authority, consent and custody policy for independent review. Keep the example
and product integration explicit about the selected policy.

## VIS-71 — authenticate state before enabling compaction for new devices

Maintenance keeps the exact compacted floor checkpoint and revision fences.
An expired client keeps its pin and encrypted outbox and returns
`sync_history_expired`. This applies to a fresh replica starting at cursor zero.
The device registry operation named bootstrap initializes an empty key scope.
It does not supply a complete authenticated sync replica after compaction.

A candidate for review is transfer from an authorized device that verified the
complete state before the floor advanced. A complete transfer must bind the
stream, key context, roster epoch, chosen head, unit commitments, and deletion
and revision fences. The receiver needs an independently trusted current
commitment, verifies the full transfer and any suffix, and imports it atomically
without dropping a surviving pin or outbox. A valid old signed snapshot does
not establish freshness. If no current trusted state survives, require explicit
recovery and an independently approved trust source or local export/migration
policy. A server-supplied checkpoint alone would not supply that assurance.

Acceptance needs two-device tests after compaction, missing-unit and
tombstone-resurrection cases, stale signed snapshots, interrupted import,
and a surviving outbox that must be rebased explicitly. The current fail-closed
behavior allows the protocol to be reviewed without changing existing formats.

## VIS-74 — retention, backup evidence and privacy wording

The product template already distinguishes cloud-readable account data from
client-encrypted content, lists visible metadata and describes loss of access.
The maintenance transport validates scope and limits, uses the server clock,
and can scrub expiry-eligible content or compact opaque history. A retention
change in a product still requires approval of the active/grace/offline
windows, invocation schedule, backup/WAL expiry and application recovery terms.

For a disposable restore rehearsal, use synthetic SaaS content and encrypted
units with an existing revision fence, and keep a separate surviving client
pin. Record the expected scope and head, delete/maintain in the isolated
environment, restore an older backup into an isolated database, and verify
access boundaries, stale pin rejection and tombstone behavior before bringing
the restore forward. Record results as operation counts and states. Provider
backup inventory and observed expiry are separate evidence from restoring a
synthetic SQL snapshot. Product privacy wording should name the actual approved
windows, operators, export channels and recovery choice before publication.
