# Project-Scoped Synchronization Assurance Model

## Performance and quota budgets

These are first-milestone acceptance thresholds for representative fixtures;
they are budgets, not evidence that runtime implementation already exists.

| Measure              | Fixture                                    | Pass threshold                                                                   |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Independent projects | 100 registered projects, 10 active         | 100% healthy projects open despite one failed project                            |
| Long history         | 100,000 events/project                     | Snapshot bootstrap p95 <= 2 s; full replay equivalence required                  |
| Envelope             | 1 MiB maximum opaque payload               | Reject larger input before persistence                                           |
| Append/fetch         | 10,000 events, 100-event pages             | p95 append <= 250 ms; p95 page fetch <= 250 ms                                   |
| Materialization      | 10,000-event snapshot plus 1,000 events    | p95 local materialization <= 2 s                                                 |
| Notification         | 10 active projects, 1 noisy project        | authorized healthy notification p95 <= 500 ms; no cross-project frames           |
| Reconnect            | 1,000-event gap                            | bounded catch-up, <= 10 pages, no cursor loss or duplicate domain state          |
| Compaction/storage   | 100,000 events and 10 snapshots            | retain recovery window and tombstone horizon; <= 25% growth after compaction     |
| Quotas               | per-project bytes/count/rate/queue/storage | deterministic 413/429-style local decision with retry-after; no usage disclosure |

Fixtures must report versions, command, machine, sample count, p50/p95/p99,
failure isolation result, and artifact path. A missing measurement is not a
pass. PZS-009 owns execution of these budgets.

## Migration and rollback

P1 inventories the global state and append-only events into one project store or
an explicit quarantine class. It writes a backup/checksum and migration ledger,
supports dry-run/resume/idempotent rerun, and keeps a bounded compatibility
reader. Cutover activates one authority per project; post-cutover writes never
enter both global and project stores. Rollback is a controlled forward decision:
restore the verified pre-cutover backup only while writes are fenced, or resume
from the project store. Stale global replay is rejected by generation/checksum.

Existing ZK-006, SEC-001, SYNC-001, ZK-020, and ZK-022 are generic foundations
only. They do not prove project-scoped synchronization is complete.

## P0-P11 traceability

The machine-checkable inventory is
`docs/architecture/system/project-scoped-sync-plan-fidelity.json`. It records
the current Themis item IDs and statuses, explicit deferred-work gaps, and the
update-vs-create decision for every phase. The fixture is loaded by
`scripts/plan-fidelity.test.ts`; its evidence boundary must not be read as
proof that later implementation or validation items are complete.

| Phase | Work item/sub-scope                                                | Decision                                                                                  |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| P0    | PZS-001 architecture, threat, performance, compatibility contracts | Update existing generic foundations; do not relabel them complete.                        |
| P1    | PZS-002 migration                                                  | Create implementation item for reversible partitioning.                                   |
| P2    | PZS-003 local core/registry                                        | Create reusable core item.                                                                |
| P3    | PZS-004 publishers                                                 | Create MCP/direct adapter item.                                                           |
| P4    | PZS-005 opaque API                                                 | Create cloud behavior item.                                                               |
| P5    | PZS-006 realtime                                                   | Create metadata-only notification item.                                                   |
| P6    | PZS-007 client sync/materialization                                | Create runtime-neutral/Web storage item.                                                  |
| P7    | PZS-007 plus THM-OWV-005                                           | Update/rework read-model contract; retain UX and human-readable translation.              |
| P8    | THM-OWV-006                                                        | Update/rework Angular read-only UI; no mutation controls.                                 |
| P9    | PZS-008/PZS-009                                                    | Create lifecycle and performance-control items.                                           |
| P10   | PZS-010                                                            | Create independent integration/security/scale validation item.                            |
| P11   | PZS-001 contract seam; PZS-007 scope                               | Explicit future-native adapter compatibility; native UI/runtime/key storage are deferred. |

Rich UX flows, human-readable state/event translation, validation, and deferred
native scope remain observable in their owning items; they are not collapsed
into this architecture item.

The renderable trust/authority artifact is
`docs/architecture/diagrams/project-scoped-sync-trust-boundary.md`.
