# Persistence protocol v1 — provisional implementation

Status: implemented in the branch under the
[ADR](../adr/persistence-saas-zk-hybrid.md). The user authorized reversible technical
choices and branch tests, without security acceptance, merge or deployment.
Independent review remains required. Recovery fixtures do not select Nive recovery
actors, custody or consent. This unpublished profile can still change through review;
no byte compatibility with v0/Nive ciphertext is claimed.

## Cryptographic profile

| Purpose           | Implemented parameters                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Data              | AES-256-GCM, random 32-byte scope/generation DEK, fresh random 12-byte nonce, 16-byte tag appended to ciphertext                   |
| Local DEK wrapper | AES-256-GCM with independent wrapping key, contextual AAD and fresh nonce; 32-byte DEK produces 48 ciphertext/tag bytes            |
| Wrapping key      | Exactly 32-byte PRF/user-held recovery output; HKDF-SHA-256, random persisted 32-byte salt, purpose-separated info, 32-byte result |
| Recipient         | RSA-OAEP-3072, SHA-256/MGF1-SHA-256, exponent 65537, contextual UTF-8 label; SPKI public key; private key stays client-side        |
| Signatures        | ECDSA P-256/SHA-256, SPKI public key, fixed 64-byte IEEE-P1363 `r                                                                  |     | s`; native DER conversion belongs in the native adapter |
| Encoding          | Unpadded canonical base64url with exact lengths and no unused-bit aliases                                                          |
| IDs/counters      | Lowercase opaque ASCII UUIDs; positive bounded integer versions/generations/revisions; no titles or paths as routing IDs           |
| Recovery          | Explicit configured user-held random 32-byte secret; purpose-separated wrapper; no password/cloud fallback                         |

Primitive references: [WebCrypto](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/),
[HKDF RFC 5869](https://www.rfc-editor.org/rfc/rfc5869), and
[WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension).
They do not certify this composition or every authenticator/browser.

## Exact bytes and boundaries

AAD uses compact UTF-8 JSON arrays. Envelopes are strict objects with field order
from the exported schemas. `serializeDataEnvelope` emits that order;
`deserializeDataEnvelope` rejects alternate bytes, duplicate fields and whitespace.
Opaque plaintext bytes are not rewritten or interpreted by the server.

```text
["visomi.data",1,"A256GCM",product,domain,keyScopeTuple,targetScopeTuple,
 generation,objectId,schemaVersion,revision,kind,previousCheckpointOrNull]
```

A scope tuple is `[kind,tenantId,groupIdOrNull,resourceIdOrNull]`. The key scope must
contain the target. Key granularity stays tenant/group/resource, distinct from a
record or snapshot unit and its additional authorization conditions.

Wrapping AAD begins with `visomi.wrap`, version, AES/KDF names and binds product,
domain, key scope/generation, owner/device, method/method ID and origin. Recovery
uses its own explicit method/context rather than treating a digest or password
reset as a decryption capability. Device messages use `visomi.device-enrollment`,
`visomi.device-key`, and `visomi.device-action`. Checkpoint input uses
`visomi.sync-checkpoint`. See [key/sync framing](persistence-keys-sync.md) and the
shared functions for the exact arrays and schema-normalized action body order.

`visomi.approved-device-key` carries recipient ciphertext, the original authorized
action and its enrollment/rotation witness. A client verifies the complete signed
body using a separately trusted signing pin before OAEP decryption/key installation.
A fetched cloud roster is not a trusted pin. Cloud-generated replacement keys,
missing signatures, altered witness members and generation/context substitutions
are rejected, even if the replacement OAEP ciphertext is mathematically valid.

## Executed vectors and runtime evidence

Public synthetic fixtures:

- `libs/shared/persistence/fixtures/crypto-v1.json`: AES-GCM data/wrapping and HKDF.
- `libs/shared/persistence/fixtures/devices-v1.json`: ECDSA/P1363, RSA-OAEP label/
  decryption and signed approval bytes. Private fixture keys are deliberately public
  synthetic values and must never be used for real data.
- `libs/shared/persistence/fixtures/devices-history-v1.json`: a generation-two
  enrollment approval explicitly grants generation one as well. It includes both
  contextual OAEP labels, distinct expected DEKs and exact signed body bytes;
  `devices-v1.json` supplies its deliberately public synthetic key material.

The separate Node cipher/KDF/signature generators do not import the WebCrypto
implementation. Tests run WebCrypto against those bytes and Node verification/
decryption against newly generated WebCrypto outputs. RSA/ECDSA output remains
randomized in production; determinism is confined to fixed decode/signature fixtures.
Both APIs may share an underlying provider. This is executed API comparison, not
independent review or Swift/Kotlin interoperability.

Actual Chromium tests exercise native PRF ceremonies, non-PRF blocking, contextual
AEAD, ciphertext IndexedDB, atomic CAS/pins, two-tab locking, explicit account
cancellation, encrypted recovery/backup and device custody. A two-browser test uses
real authenticated HTTP/PostgreSQL for signed recipient approval, bidirectional
sync, conflict retention and older SQL restore rejection.

## Key lifecycle and nonce accounting

Cloud login never implies private unlock. Initialization is an explicit operation
for an empty scope. Existing scopes require an authorized device's possession/
approval or configured recovery. Challenges are five minutes, server-generated and
consumed before verification. Every lifecycle mutation rechecks current membership,
key scope, generation and roster epoch under the tenant transaction lock.

Device signing/decryption material is encrypted under a separate local
`device-custody` PRF vault. It is not protected by a shared resource DEK. Operational
private keys are nonextractable. Byte clearing/dropped references are best effort
in managed runtimes; malicious served code can invoke unlocked keys.

Revocation clears a delivery and enters a write barrier. Rotation validates a
complete set of generation `g+1` recipient deliveries and commits atomically.
Partial/interrupted rotations leave the barrier. Old writes/signatures fail.
Historical re-encryption is client-owned; revocation cannot erase old copied keys
or plaintext. Recovery configuration is explicit; total key loss without a recovery
method can be irreversible. Password reset recovers identity only.

The local store reserves at most 2^20 encryptions per scope/generation. Reservation
commits before encryption. The server bounds active devices at 64 and requires
rotation after revocation. These constraints are not a claim of an unlimited or
cryptographically enforceable global random-nonce budget. The independent review
must settle cross-device/copy/restore accounting and collision bounds before release.
A duplicate check after encryption cannot undo reuse already observed by a server.

Encrypted backup batches contain a wrapper and at most 100 encrypted units/16 MiB.
Restore is empty-destination-only and atomic, stays locked, validates owner/origin/
context and a supplied trusted generation floor, and exhausts the restored local
write counter. User-held recovery also installs a read-only wrapper until rotation;
it does not reset the old generation's budget. Deleting a local wrapper drops local
access but cannot recall another client's copies.

## Opaque sync, conflicts and retention

Private PostgreSQL stores bounded encrypted records/events/snapshots/tombstones,
current units and append-only event/checkpoint history. Streams are independent per
authorized target/domain even when keys are inherited from a broader scope. Writes
bind expected revision/cursor/predecessor, operation ID, generation and current device
signature. Exact retries return their original receipt; changed payloads conflict.
No server decryption or domain merge occurs.

The web replica verifies contextual AEAD, predecessor/hash order and surviving
local pins, then commits ciphertext/revisions/pins atomically. Its encrypted outbox
survives offline/conflict/ack loss and is removed only after the exact envelope
appears in authenticated history. Explicit client/user conflict resolution can
rebase into a fresh nonce/revision/head or discard that exact pending operation;
retry logic never chooses automatically.

Snapshot payload meaning/coverage is domain-owned. This generic adapter does not
silently replace a history with an unverified snapshot. An explicit owner-only [maintenance adapter](persistence-retention.md) compacts
aged prefixes and removes eligible tombstone ciphertext while retaining revision
fences and a checkpoint floor. Expired clients fail closed; automatic
expired-horizon bootstrap remains unsupported. Metadata/time retention declarations do not perform provider
backup deletion. These limits must remain visible in product integration/release
review, rather than promising completed physical retention enforcement.

A surviving newer checkpoint rejects an older restored server. Total rollback of
server and every trusted client anchor cannot be detected by AEAD alone. First-use
trust, unavailable devices and historical generation custody remain explicit parts
of the consumer threat model. Storage metadata is never automatically loggable.

## Compatibility and migration

The server/current web adapter accept explicit v1 and reject unsupported framing.
The example consumer supports note schema v1 and requires its configured readers;
an unavailable client capability never switches a domain to server-readable mode.
Policy hashes reject silent manifest changes. Reader/key scope/recovery/schema/
envelope changes require an explicit reviewed migration and rollback plan.

Shared contracts contain no platform runtime types. Native clients implement their
own crypto, secure custody and transport, match canonical bytes and vectors, and
execute lifecycle/two-client tests on real runtimes. Swift, Kotlin and desktop
applications do not exist in this repository and remain unimplemented/unverified.
No new native applications are implicitly included in the web port.

Recovery of a data key does not itself grant cloud device-administration authority.
If every authorized signing identity is lost, a surviving independently encrypted
custody backup or a product-defined, reviewed recovery authority is required. The
current synthetic profile chooses neither implicitly. Do not promise full cloud
write/enrollment recovery from a resource recovery wrapper alone.
