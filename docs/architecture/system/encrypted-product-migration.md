# Encrypted Product Context and Activity Migration

## Inventory at the transition boundary

The starter path is server-readable and is therefore not the target authority:

| Source                                                  | Protected fields                           | Readers/writers                                                   | Retention/deletion                                                                                        | Transition action                                                                                   |
| ------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `projects.summary`                                      | project summary                            | `projects-service` create/update/read; project detail API         | retained with `projects`; deleted by project cascade                                                      | freeze as routing/display metadata only; no protected narrative writes                              |
| `project_documents.content_markdown`                    | seeded document body and narrative context | `createDocument`, seed worker, project detail API                 | retained with `project_documents`; deleted by project cascade                                             | stop using for protected context; migrate through local agent, then tombstone/delete after approval |
| `async_jobs.input_json`, `result_json`, `error_message` | seed inputs/results and worker errors      | seed queue, job records, project detail/jobs API, realtime events | retained with `async_jobs`; deleted by project cascade                                                    | permit identifiers/status only; never place context/activity plaintext in job payloads or messages  |
| opaque sync envelopes                                   | ciphertext plus approved routing metadata  | local agent produces/consumes; API stores/relays                  | bounded opaque retention (currently store default is 30 days); deletion policy and tombstones remain open | canonical target transport; deduplicate by envelope identity and revision                           |

The account/project-scoped inventory runs with
`node --experimental-strip-types scripts/zk008-zero-plaintext-inventory.ts`.
It reports counts only and refuses to run without `ZK008_ACCOUNT_ID` and
`ZK008_PROJECT_ID`. It covers PostgreSQL tables, queues, realtime, logs,
synthetic fixtures, and backups; unavailable optional infrastructure is
reported as `unverified`, never as zero. The synthetic review fixture is
`fixtures/zk008/synthetic-envelope.json` and contains ciphertext-shaped data
only.

The current project and document readers are intentionally identified here so a
future product read cannot accidentally treat the starter API as plaintext
authority. The product UI must obtain protected content from an approved local
agent-mediated read and receive only an approved projection.

## Bounded transition

1. Freeze protected legacy writers. New context/activity writes require the local
   agent to produce a version-1 `themis.encrypted-envelope` sync object.
2. Read legacy rows in account/project scope, without logging or returning their
   contents. A local agent encrypts the complete context/activity pair and returns
   the envelope; the server only validates, stores, and routes it.
3. Mark each legacy row migrated by an opaque migration identity. The migration
   ledger must be backed by the repository's durable persistence boundary (the
   helper accepts `MigrationLedgerPersistence` for that adapter); an in-memory
   ledger is test-only and must not be used across process restarts. Identical
   retries are successful no-ops; conflicting reuse is rejected. Unavailable rows
   remain deferred, malformed rows are quarantined, and partial rows are not
   combined or exposed.
4. After an approved verification window, remove or tombstone protected legacy
   bodies. Until then they are containment-only and cannot be the end-state read
   path. Deletion must be account/project scoped and preserve no plaintext in
   logs, queue messages, error responses, or realtime payloads.

The migration helper in `libs/shared/src/lib/crypto/encrypted-project-migration.ts`
enforces the representative decision boundary. It deliberately accepts an agent
encryption callback rather than selecting an algorithm or holding keys.

The project seed worker now reports metadata-only progress and never creates a
protected legacy document. The legacy project, document, and job service mappers now return metadata-only
projections. Protected summary/document bodies and job input/result/error fields
are neither returned by the API nor accepted as new server-authoritative writes;
attempts to write project or document protected content are rejected with
`encrypted_context_required`.

## Failure, rollback, and recovery limits

- Unavailable: defer and retry with bounded backoff; do not fall back to a
  plaintext API response.
- Malformed: reject before encryption/decryption and retain only an opaque failure
  code and row identity.
- Duplicate: accept an identical envelope as idempotent; reject a conflicting
  envelope identity as a replay/conflict.
- Partial: defer until the agent has both context and activity; never synthesize a
  missing side.
- Rollback can restore opaque envelopes or resume the legacy freeze window. It
  cannot restore plaintext deleted before an approved backup exists, and a lost
  local key makes encrypted content unrecoverable.
- Cloud retention, tombstones, compaction, and recovery quorum are unresolved;
  they require decisions from ZK-001, ZK-003, and ZK-006 before historical
  deletion is enabled.

Migration `20260819220000_encrypted_context_tombstones` drops legacy plaintext
columns instead of copying them to cloud storage. It adds scoped ciphertext
metadata, a durable migration ledger, and tombstones. Tombstoned sources are
rejected on retry, including device recovery, so synchronization cannot
resurrect deleted state.

## Unresolved visibility decisions

The team still needs to approve which project name, timestamps, status, sizes,
and activity counts may remain cloud-readable. No protected narrative, document
body, job result, error detail, or activity payload is approved for server/API
visibility after this boundary. Product visibility is therefore local-agent
mediated until a minimal metadata projection is explicitly approved.
