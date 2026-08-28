# Project-Scoped Synchronization Contract v1

## Purpose and authority

This is the runtime-neutral P0 contract for independently loadable Themis project
stores and independently authorized cloud streams. The local agent and its
skills remain the plaintext and mutation authority. Cloud API, database, object
storage, worker, gateway, and realtime services authenticate, authorize,
persist ciphertext, assign opaque cursor/revision metadata, and signal
availability. They never decrypt, index plaintext, merge domain state, or decide
domain conflicts.

The portable contract is implemented by `project-sync-contract.ts`. It contains
no filesystem, Node, browser, key-store, or UI dependency.

## Project stream

Every stream is bound to one opaque `projectId`; tenant, account, user, device,
and capability authorization are evaluated before a stream is read or written.
Streams are independent: cursors, quotas, retries, compaction, failures, and
materialization state never aggregate unrelated projects.

An envelope has format `themis.project-sync-envelope`, version `1`, one of
`event`, `snapshot`, or `tombstone`, a stable `envelopeId`, an idempotency key,
revision, prior cursor, entity-kind discriminator, and opaque nonce/ciphertext/
authentication tag. The cloud-visible allowlist is limited to routing and
integrity metadata explicitly represented by this schema. Raw `.themis` files,
paths, keys, secrets, protected IDs, titles, descriptions, evidence narratives,
and plaintext domain content are forbidden from transport and logs.

The projected domain is complete: project, epic, work item, dependency, sprint,
sprint revision, membership, sprint evidence, run, run evidence, review, claim,
status transition, activity, and timeline event. The encrypted payload is the
only place for their protected fields.

## Cursor and lifecycle semantics

The cloud assigns a monotonic cursor within a project stream and never rewrites
an accepted envelope. The local agent assigns domain revisions and commits
before publication. Idempotent retries return the original cursor only when the
same envelope and idempotency key are presented; a conflicting replay fails.
Clients reject stale revisions, cursor rollback, unsupported versions, bad
authentication tags, and project mismatches.

Snapshots cover a cursor and are followed by incremental events. Checkpoints
bind project, covered cursor/revision, predecessor, schema/envelope versions,
snapshot hash, and tombstone horizon. Tombstones remain durable through the
declared recovery window and may not be bypassed by an older snapshot. A
notification carries availability metadata only; clients fetch, verify, decrypt,
merge, and materialize locally.

Materialization is transactional and project-local. It stores schema version,
cursor/checkpoint, tombstone horizon, and one of `empty`, `loading`, `ready`,
`stale`, `locked`, `corrupt`, or `quota-exceeded`. A corrupt, oversized, locked,
or unavailable project does not block another project.

## Adapters and compatibility

Local publisher, direct API, MCP, realtime, and client storage adapters consume
these contracts without adding authority. Web IndexedDB is the first milestone
materializer. Native UI/runtime delivery and native-specific key storage are
P11 non-goals; future native clients may implement the same adapters.
