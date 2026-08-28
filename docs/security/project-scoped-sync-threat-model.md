# Project-Scoped Synchronization Threat Model

## Trust boundary

Plaintext and all domain mutation decisions stay in the local agent/skill
boundary. Cloud custody is ciphertext-only. The cloud may authorize an already
authenticated account/device/capability and expose allowlisted routing metadata,
but it is never project authority.

| Threat                                     | Required control and observable failure                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-project, tenant, or device confusion | Exact project/account/tenant/device/capability binding; deny without existence disclosure.                                                        |
| Metadata disclosure                        | Versioned allowlist; no names, labels, protected IDs, plaintext, paths, keys, or secrets in metadata/logs.                                        |
| Replay or rollback                         | Stable envelope/idempotency identity, monotonic revision/cursor, checkpoint predecessor and tombstone horizon; reject stale input.                |
| Stale cursor or missing history            | Detect gaps and prune boundaries; bounded resync from a verified snapshot and checkpoint.                                                         |
| Tombstone resurrection                     | Durable tombstone horizon; reject older snapshots/events and restore chains that predate it.                                                      |
| Malformed or malicious envelope            | Strict schema, version rejection, canonical serialization, size/quota limits, authentication-tag verification before plaintext.                   |
| Notification spoofing                      | Authenticated project subscription; metadata-only hints are advisory and never state transfer.                                                    |
| Quota abuse or denial of service           | Per-project quotas, bounded pages/queues, cancellation, retry-after, coalescing, and circuit breakers; noisy projects cannot starve healthy ones. |
| Compromised client                         | Treat unlocked clients as endpoint risk; short-lived scoped capability, local validation, safe codes, and no cloud authority escalation.          |
| Logs and telemetry                         | Structured correlation metadata only; encrypted payloads and protected fields are redacted from logs, traces, metrics, reports, and backups.      |
| Recovery compromise or failure             | Local-authority recovery, verified snapshot/checkpoint chain, explicit revocation/rotation, and no silent downgrade or split-brain cutover.       |

## Recovery invariant

On any failed verification, the client remains locked/stale/corrupt and does not
materialize plaintext. Recovery restores opaque bytes, verifies the project,
hash, predecessor, version, cursor, revision, and tombstone horizon locally,
then materializes transactionally. A project failure is isolated from every
other project.
