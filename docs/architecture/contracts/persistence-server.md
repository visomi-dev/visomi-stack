# Persistence server adapter and provisional decisions

Status: implemented in branch for VIS-66/VIS-67, subject to milestone acceptance.
The [ADR](../adr/persistence-saas-zk-hybrid.md) and [review](../../reviews/persistence-milestone.md)
separate implemented behavior from independent acceptance and provider operations. See also the [key/sync contract](persistence-keys-sync.md).

## Composition and authority

`createApp({ auth, persistence: productPolicy })` opts into `/persistence` routes
and their OpenAPI operations. The executable supplies auth/database resources;
importing the module opens no pool, listener, timer or network connection.
Default deployed composition does not enable this example automatically.
`syntheticHybridPolicy` is an explicitly synthetic consumer example, not Nive
configuration or a user-controlled reader-mode switch. Recovery `none` in that
fixture does not choose a recovery policy for a real product.

The API stores a hash of the parsed complete manifest at tenant creation. A
different manifest for an existing tenant returns `policy_migration_required`.
No operation silently migrates readers, storage or recovery. Rejecting harmless
manifest reordering is conservative; a later canonical manifest revision can
address that through an explicit migration.

All operations require a current verified cloud session. The access service
locks identity/session and then the tenant in the same transaction as the
operation. Session ID and auth version are matched to the stored passport
principal; client user/owner IDs never select the acting identity. Mutations
require the configured Origin and session CSRF token. JSON, params, query and
commands are strict, bounded and return static errors. No SQL input, driver error
or payload is logged at these boundaries.

Tenant membership is separate from scope grants: being a member alone grants
no scope access. The tenant owner manages membership. A resource may descend
from a group or directly from its tenant; groups descend only from a tenant.
The server verifies the complete same-tenant ancestry, never a client assertion
of parentage. Composite database foreign keys add same-tenant constraints.

Viewer grants permit read, editor grants permit read/write/delete, manager
grants add share. The nearest explicit grant wins; `blocked` deliberately
overrides an inherited grant. Revoking membership removes effective access
immediately for subsequent serialized operations; rejoining clears previous
grants instead of reviving them. Ownership transfer/last-owner removal is not
invented: attempts to change the owner return `ownership_transfer_required`.

Record visibility is an additional predicate: scope-visible or owned by the
verified actor. Scope ownership alone does not bypass a private record rule.
Sharing a record or changing its visibility also requires scope share authority.
Reads, lists, search and paged exports share this SQL predicate. Response fields
are explicitly projected; membership, owner IDs and database internals are not
returned by the SaaS record adapter. This is server-readable content protected
by ACLs, not a claim of cryptographic secrecy from the operator.

## Transactions, concurrency and quotas

The initial implementation deliberately serializes work per tenant. The simpler
lock boundary makes permission changes, CAS, idempotency and quotas consistent
across processes. Finer scope locks are a possible measured optimization, not a
current scale claim. The default Read Committed transaction plus explicit locks
means a queued operation re-reads membership/grants after the prior commit.

Every mutation uses a random operation UUID. An exact authorized retry returns
the original metadata result; a different command under that ID conflicts.
Updates/deletes use an expected revision. Conflicting revisions fail atomically;
commands are stored only after their mutation succeeds, in the same transaction.
Retries still check current membership, scope action and record visibility.

The adapter bounds each unit and checks current scope/domain row count and UTF-8
title/body bytes under the tenant lock. Payload transport size is separately
limited to 32 KiB. Paging uses random UUID ordering and a cursor, with 1–100
items per page. Export uses the same bounded pages and rechecks access on every
request; it is not an atomic whole-tenant snapshot. Search treats `%`, `_` and
backslash as literal user text, and only searches the explicitly allowed title.
ZK or unknown domains fail with `domain_adapter_incompatible`, even for admins.

## Migration, retention and recovery operations

The generated `persistence_*` schema migration is additive and was applied only
by the isolated test harness. Do not run it against live databases as part of
this implementation. RLS is not enabled and no RLS guarantee is claimed; current
isolation depends on scoped queries plus the service transaction boundary.

The policy's active retention window excludes expired records from reads/list/
search/export. Delete replaces active title/body with empty strings and retains
the next revision and deletion marker. This does not erase earlier database
backups, storage pages or copies. The explicit owner-only [maintenance adapter](persistence-retention.md) now
scrubs expired content, purges eligible rows and expires command receipts in
bounded transactions. There is no automatic scheduler. Provider backup expiry,
WAL/disk erasure and live invocation remain separate operations; filtering or
physical row deletion alone must not be advertised as complete provider erasure.

For restore, use an isolated database, apply the same migrations, validate the
manifest hash, memberships, revision/command constraints and tombstones, and run
the negative access checks before any promotion. A fresh connection test proves
state is durable across clients. An additional test performs a real SQL dump and
restore into another isolated database with matching container PostgreSQL clients,
then checks ACLs, revisions, idempotency and tombstones. This is synthetic SaaS
restore evidence, not live provider-backup recovery or a crash/restart exercise.
The two-browser integration additionally restores an older real SQL dump of the
opaque stream and verifies that a newer retained client checkpoint rejects it.
Neither exercise verifies a production provider's recovery procedures.
Never restore server-readable data into a ZK domain or lower a policy to recover
availability. Rollback disables the opt-in composition and preserves its private
tables until a reviewed retention/migration operation handles them.

## Decisions and unresolved work

| Decision                                      | Reason and alternative                                                         | Risk / evidence                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Shared tenant transaction lock                | Serialize membership/CAS/quota state; finer locks add lock-order complexity    | Coarse contention; concurrent HTTP CAS/idempotency tested, no throughput claim          |
| Membership plus explicit scoped grant         | Fail closed for a new member; inheritance supports tenant/group/resource roles | Scope grant rules are server authority only; not key possession                         |
| Paged UUID cursor                             | Existing PostgreSQL primitives, bounded deterministic traversal                | Concurrent inserts do not form a snapshot; export consumer must handle pages/revocation |
| Immutable manifest hash                       | Prevent accidental reader downgrade without building a migration engine        | Configuration reordering may require migration; no silent conversion                    |
| PostgreSQL schema in existing shared DB owner | Reuse Drizzle, migrations, testing and resource lifecycle                      | No new RLS role, pool, framework, dependency or live provisioning                       |

Key generations, rotation barriers and opaque storage are implemented separately
in the [key/sync adapter](persistence-keys-sync.md). New realtime subscriptions,
background purge and production-provider backup/restore verification remain
outside the enabled adapters. Existing auth-only realtime must not be described
as authorizing tenant ciphertext subscriptions. Independent cryptographic review
and real-product recovery/consent choices remain unresolved release gates.
