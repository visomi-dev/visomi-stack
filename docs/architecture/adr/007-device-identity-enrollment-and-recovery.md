# ADR 007: Device Identity, Enrollment, Revocation, and Recovery

## Decision

Devices create an opaque identity locally and publish only a public key and its
fingerprint. An existing active device approves enrollment by sending an opaque
`themis.encrypted-envelope` of type `workspace-key-distribution`, addressed to
the new device. The cloud stores and routes that envelope; it never receives a
VMK, private key, or workspace plaintext.

The approved cloud boundary exposes device create/list, workspace-scoped
approval, enrollment, revocation, recovery, and audit operations. Enrollment
requires an explicit approval grant for the target workspace; an active device
in the same account is not sufficient by itself. Sync append and retrieval
carry the device identity and enrollment version and authorize at the same
boundary before using the opaque sync store.

Each workspace grant has an enrollment version. Authorization requires an active
device, an existing grant, and the current version. Revocation immediately
removes grants and rejects new sync/use requests; offline clients must fail
closed when they next contact the orchestrator. Audit events are visible only
through the authorized workspace audit operation and contain only account,
device, workspace, kind, and timestamp metadata.

Lost or compromised devices are permanently revoked. Recovery requires the
local agent to create and attest a replacement identity first, then an active
approving device with workspace-scoped approval distributes a fresh opaque
workspace-key envelope through the recovery operation. Re-enrolling a revoked
identity is not allowed; replacing a device without a new identity is rejected.

## Proof and durability boundary

The current implementation is a bounded in-memory proof. The API process-global
store loses identities, workspace authorizations, grants, revocations, versions,
and metadata-only audit events on restart or across multiple API replicas. The
HTTP routes therefore must not be treated as durable production lifecycle or
audit storage. A supported persistence/audit seam is intentionally deferred to
the durable security work; until then, this item proves authorization and
revocation behavior only within one process lifetime. No secret material is
written to audit events or error responses.
