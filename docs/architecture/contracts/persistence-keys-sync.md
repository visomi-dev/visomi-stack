# Device authority and opaque synchronization v1

Status: provisional branch implementation. This document records reversible
technical choices, not independent protocol approval or production acceptance.
See [the ADR](../adr/persistence-saas-zk-hybrid.md),
[crypto bytes](persistence-v1.md), and [executed evidence](../../reviews/persistence-milestone.md).

## Authority and enrollment

Cloud identity, current membership, inherited scope grants, and possession of a
client key are distinct requirements. A verified session may request a five-minute
challenge, read authorized ciphertext and public device metadata. It cannot obtain
plaintext or silently enroll a recipient into an existing key scope.

Enrollment binds product, domain, tenant/group/resource key scope, generation,
owner, device, request, fresh 256-bit challenge, expiration, P-256 signing SPKI and
RSA-3072 encryption SPKI. ECDSA uses SHA-256 and a fixed 64-byte IEEE-P1363 `r || s`
signature, not ASN.1 DER. RSA uses exponent 65537, OAEP SHA-256/MGF1-SHA-256 and a
contextual UTF-8 label. Public keys use SPKI DER. See the shared contract's exact
array encodings; JSON object property order is not the signed enrollment message.

The challenge is consumed in a committed transaction before verification. A failed
attempt requires a fresh challenge. Only the tenant owner may bootstrap an absent
key scope, using possession proof. Bootstrap is permanently unavailable once that
registry exists, even after all devices are lost. Existing scopes require a
current authorized device's signature, current sharing authority, recipient
membership/grant, and an individually contextualized encrypted delivery. The
server validates proof and binding but never constructs or unwraps that delivery.

Actions sign product/domain/key scope/generation, signer device, random operation
ID, current roster epoch, controlled action, and SHA-256 of the strictly parsed
request body without its authorization field. Clients must construct schema-normalized
DTOs before hashing. `deviceActionMessage` is the signed array encoding. Enrollment
approvals hash `{proof, delivery}` or, for an explicit historical grant,
`{proof, delivery, history}` in that field order. Revocation hashes `{deviceId}`, rotation hashes
`{deliveries}`, and sync hashes `{protocol, operationId, expectedRevision, head, envelope}`
in that field order. Epoch/generation mismatches reject replay; membership is read
again under the same tenant lock as the mutation.

Recipient fingerprints cover the full enrollment message, not a friendly device
label. A trustworthy client must pin/compare the existing device's public key using
its established enrollment/approval channel; a cloud-supplied roster alone is not
protection against a malicious server substituting a recipient. The delivery endpoint retains a signed enrollment/rotation witness.
`WebCryptoDevices.accept` and `DeviceCustody.open` require an independently trusted
signing pin, verify that witness before OAEP decryption and reject server-created
replacement keys. The initial example bootstraps a new local authority; it does not
provide a complete remote-recipient approval UI. Human verification of pins and
first-use trust remain part of the independent threat review.

### Enrollment after rotation

A new device starts at cursor zero and must authenticate retained events, including
obsolete revisions and tombstones. Receiving only the current DEK is insufficient
after rotation. The optional `history` array is an explicit grant of up to 64
earlier-generation recipient deliveries, sorted by strictly increasing generation.
The current authorized sharing device signs the entire normalized approval body;
the server never creates historical keys or infers consent to distribute them.
The same recipient, challenge/fingerprint, product, domain and key scope must bind
every delivery. Duplicate/current/future or substituted contexts fail with
`device_history_invalid`. Omitting a generation needed by retained replay fails
with `device_history_required` before enrollment commits. A failed attempt still
consumes its challenge. HTTP body limits also apply to the complete request.

The client verifies the complete witness and separately trusted signer before
opening either the current delivery or a selected historical member.
`BrowserVault.deliverHistory` prepares a grant only from an already locally held,
PRF-wrapped historical key in the same scope. `DeviceCustody.open` takes an explicit
historical generation while its expected binding remains the current recipient
binding. After verification, `BrowserVault.installHistory` wraps that key under
the recipient's own PRF context with its local encryption budget exhausted.
It preserves the selected current writing generation. Historical decryption
unwraps the retained local key transiently, checks AEAD under that exact generation,
and clears temporary key/plaintext bytes on success, failure and lock races.
The historical PRF context uses the same owner/device/credential/origin binding;
different wrapping credentials are not guessed or recovered automatically.

Historical grants disclose the retained ciphertext history protected by those
scope keys, including older revisions; they cannot restrict an old DEK to selected
records. A product that forbids that disclosure needs a separately authenticated
complete-state bootstrap instead. This branch deliberately retains full AEAD
replay and introduces no server-trusted snapshot or historical-key derivation from
the current DEK. Re-encryption, deleting history or skipping AEAD is not a fallback.
Revoked recipients receive no future generation. Old keys cannot decrypt new data;
previously copied history cannot be cryptographically revoked retroactively.

`SyncReplica` requires the known `KeyDomain` generation and accepts a minimum
roster epoch in addition to its durable pin. New recipients use their verified
current approval's generation and authorization epoch plus one. The example also
retains its known current vault binding as a generation floor. Old control state is rejected even
when old event AEAD can now be verified. Pins, revisions and pending writes still
commit through the existing atomic IndexedDB rules. Missing local historical keys
raise `recovery-required` without advancing the pin or clearing the outbox.

Active binding selection also checks locally retained key-wrapper metadata through
`IndexedDbVaultStorage.getCurrentKey`. The example rejects a cloud request to open
an older generation when a higher wrapper is already present in that same local
key scope. Explicit archival reads continue to use their selected historical key.
This requires no local schema migration and does not claim detection after trusted
local state is erased or lost.

This pre-release extension preserves existing current-only signed bytes where no
historical grant is needed. A client without historical-grant support must reject
such a witness; strict parsing and `device_history_required` are not bypassed for
compatibility. The example still has no complete recipient approval/rotation UI.
Install an enrollment grant before its delivery is superseded by a later rotation;
the API retains one current delivery, not an unlimited delivery archive. A missed
grant requires a fresh authorized enrollment flow, not trust in a cloud roster.
Compacted/expired history continues to return `sync_history_expired`; receiving old
keys does not reconstruct removed events or authorize resetting a surviving pin.

## Revocation and rotation

Revoking a device removes its delivery and enters `rotating`. Writes stop until a
single transaction validates a new generation's delivery for every remaining active
device and installs all of them. A partial/failed request leaves the barrier in
place. Old-generation writes and stale roster signatures fail. An interrupted
rotation can be retried against the unchanged state with an authorized device.
The last device can be revoked, but that can irreversibly eliminate signing/key
authority when the configured product has no explicit recovery flow.

Membership resets/revocations and changed grants conservatively revoke that user's
devices across the tenant and require rotation for affected key scopes. Rejoining
does not reactivate old device keys or grants. This is deliberately more restrictive
than attempting to infer whether a nested role change preserved every permission.

Revocation cannot erase plaintext, old ciphertext or keys already copied by a
client. Remaining authorized clients can retain old generations to decrypt history;
new writes use the current generation. Historical re-encryption is a client domain
operation, never server decryption. Generation/epoch counters are bounded, fail
closed on exhaustion, and require a separately reviewed migration before reset.

## Client custody

`WebCryptoDevices` supplies possession and recipient-delivery operations.
`provisionDeviceIdentity` exposes provisioning bytes only to a trusted local
encryption callback, imports nonextractable operational private keys, validates
key-pair consistency on restoration, and clears temporary byte copies. A consumer
must encrypt this material under a device-local PRF-controlled custody key separate
from any shared resource DEK. It must not persist raw private keys, use a shared
resource DEK to protect device signing authority, or send provisioning material to
the API. The Angular development composition uses this independent custody vault and binds
its lifecycle to account cancellation and explicit lock. Physical device guarantees
still require platform evidence.

PRF assertions and derived output remain local. Managed runtimes can retain
temporary copies: byte clearing and dropping references are best effort. Native
secure stores require separate adapters and executed vectors. Browser execution
does not establish hardware-backed custody on every platform.

## Transport and conflict behavior

The first storage adapter uses private PostgreSQL JSONB ciphertext, without public
object URLs or an external bucket. Each authorized target resource has an independent
cursor/checkpoint stream, even when its key is inherited from a tenant or group.
The server implements explicit v1 negotiation, bounded units, encrypted records,
events, snapshots and tombstones. Domain merge is client-owned.

Writes require current write/delete authority and a current device signature.
The transaction checks expected object revision, stream cursor, prior checkpoint,
target/key context, current generation, quotas and idempotency. Duplicate identical
requests return the original cursor/checkpoint. Changed bytes under an operation ID
conflict. Role or generation changes can intentionally reject an old retry instead
of making its former authority permanent.

Checkpoints hash the exact `syncCheckpointMessage` bytes. AEAD authenticates the
previous checkpoint and object context; an unkeyed hash alone is not authenticity.
The web replica verifies contiguous order, contextual AEAD, hashes and its locally
pinned generation/epoch/head before committing ciphertext units and the new pin in
one IndexedDB transaction. Old pins, invalid revisions and concurrent tab updates
fail atomically. Reopening preserves pins and starts without plaintext/key unlock.

The outbox holds a bounded pending encrypted change per stream. Offline/network
failure preserves it. Retries use identical bytes. The entry is deleted only after
the exact envelope appears in authenticated committed history. Conflicts and
rotation keep the pending copy for an explicit domain rebase with an unlocked key;
there is no blind overwrite or cloud merge. The explicit `resolve` port can rebase
a chosen local version against the current authenticated head/revision, or discard
that exact pending operation. It rejects stale/wrong-operation decisions. The
example exposes both choices after a conflict and does not choose automatically. Each scope has its own replica/lock
lifecycle; corruption of one stream does not authorize discarding others.

Locally pinned checkpoints detect rollback relative to that surviving state. Total
loss of all trusted client state cannot prove server freshness. A restored server
may be behind a surviving client and is rejected until explicit recovery/reconciliation.
No transparency log, remote attestation or universal rollback protection is claimed.

Current history consumes the configured byte quota along with current ciphertext.
Writes append events; explicit owner-only [maintenance](persistence-retention.md)
compacts aged prefixes while retaining a checkpoint floor and minimal revision
gravestones. Expired clients fail closed with their pin/outbox preserved. There is
no automatic expired-history bootstrap or provider backup expiry. Products that
require fresh-device bootstrap after compaction need a trusted-state recovery path
before enabling that operation. Notifications/realtime and external object-storage
adapters remain disabled; polling reads apply current authorization every time.
Enabling an adapter later requires the same access checks and metadata capture policy.

Encrypted backup imports remain locked and exhaust the restored local encryption
counter. User-held recovery does the same. Reads can recover historical content;
new writes require a fresh generation. No provider backup expiry, physical purge
or automatic history compaction is implied by these local restore operations.

Recovery of a data key does not itself grant cloud device-administration authority.
If every authorized signing identity is lost, a surviving independently encrypted
custody backup or a product-defined, reviewed recovery authority is required. The
current synthetic profile chooses neither implicitly. Do not promise full cloud
write/enrollment recovery from a resource recovery wrapper alone.
