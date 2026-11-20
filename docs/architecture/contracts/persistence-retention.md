# Persistence retention and expired synchronization history

This is a provisional development contract for VIS-67/VIS-71, implemented in
`PersistenceMaintenance`. It does not schedule work or authorize live deletion.
Provider backups, WAL, disk erasure and public privacy publication require separate
operational configuration and permission.

## Explicit bounded execution

The technical development/test harness uses
`POST /example/vault/tenants/:tenantId/scopes/:scopeId/domains/:domain/maintenance`
accepts only `{ "limit": 1..100 }`. It uses the configured manifest and server
clock; caller dates, retention overrides and unknown fields are rejected. Each
phase handles at most that many rows. The caller must have a current verified
session, Origin/CSRF protection, delete authority, tenant ownership and the correct
domain authorization scope. Membership, writes, quotas and maintenance serialize
under the same tenant transaction lock. Failure rolls the whole batch back.

The response contains six counts: expired receipts, scrubbed SaaS records, purged
SaaS rows, compacted events, scrubbed encrypted tombstones and expired challenges.
It contains no record IDs, content or cryptographic material. Repeat batches until
eligible work is exhausted. No loop, scheduler, pool, listener or cleanup starts
merely by importing application code. Product operations must separately decide
when to invoke this endpoint; the implementation only invokes it in isolated tests.
Expired enrollment challenges can be removed before any key registry is initialized.
Cleanup derives only their authorized scope and never bootstraps a key to permit deletion.

## Receipt expiry without executing an old request again

SaaS mutations and opaque writes now require canonical lowercase UUIDv7 operation
IDs. They contain immutable Unix-millisecond issuance time and random bits using
the [RFC 9562 section 5.7 layout](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7).
The public RFC A.6 vector is tested. Runtime adapters supply secure randomness;
this is not an authentication token, client identity, nonce or monotonic counter.
The timestamp is already part of the opaque adapter's declared timing metadata.

The retry window is the maximum of one day, `offlineWindowDays`,
`deletionGraceDays` and `tombstoneDays`. The server rejects issuance times more
than five minutes ahead or at/before the end of that window with the static
`operation_expired` error. The ID cannot acquire a newer issuance time while
remaining the same operation. Exact authorized retries within the window retain
the existing fingerprint/result behavior. Changed bodies still conflict; current
membership, device approval, generation and signature checks still apply.

Receipts can be deleted only after their server creation time is older than the
complete retry window plus the five-minute future allowance. Thus receipt expiry
does not turn an unchanged old request into a new mutation. A retry after expiry
must not silently acquire a new ID. An explicit client/domain decision can rebase
the retained encrypted change, with a new ID, nonce, revision, head and signature.
Changing content under the old ID is never retry logic.

This refines the still-unreleased provisional v1 contract in this branch. Old
UUIDv4 mutation IDs are rejected, not silently converted. The additive migration
marks previously unclassified SaaS receipts `unclassified`, preserving them rather
than guessing a domain for deletion. Old opaque event/receipt timestamps default
to migration time, conservatively restarting their retention age. Any actual
preexisting installation would need an explicit reviewed compatibility/backfill
plan; none is migrated by this task.

## SaaS content

`activeDays` measures age from creation, consistent with the existing read/list/
search/export filters. Maintenance scrubs title/body and marks eligible records
deleted at their effective expiry. Physical row deletion follows
`deletionGraceDays`; explicit user deletion already scrubs content immediately.
Grace does not keep a readable copy of deleted content. `activeDays: null` disables
automatic active-age expiry, not explicit deletion or receipt expiry. Work is
restricted to the exact tenant/scope/domain, including owner-only records whose
retention is fixed by that product policy. Retention maintenance does not grant
the owner a content-read bypass.

The current opaque adapter rejects non-null `activeDays` at composition. A server
cannot create an authenticated encrypted expiry tombstone. Pretending otherwise
would silently violate either retention or synchronization integrity. A future
client-authored expiry policy needs its own verified lifecycle before enabling it.

## Opaque history and tombstones

Maintenance compacts only a contiguous prefix older than the maximum of the
offline, tombstone and deletion-grace windows. A fresh event stops the batch even
if later events have older timestamps. Missing cursors or predecessor mismatch
abort rather than hiding corrupted history. The stream retains a monotonic floor
cursor and the exact checkpoint at that floor, atomically with prefix deletion.
The current head, latest live encrypted units and revision sequence remain intact.

A request beyond the current head still fails `sync_rollback_detected`. A request
below the retained floor, including cursor zero, fails `sync_history_expired`.
A request exactly at the floor must present its exact checkpoint. Requests above
the floor retain normal checkpoint/order/AEAD validation. An old SQL restore
cannot be legitimized by advancing/clearing a client pin or accepting a server
snapshot. A compromised server is not a trusted source of a new anchor.

After an encrypted tombstone is both older than the horizon and covered by the
compacted floor, its ciphertext is removed. A minimal gravestone retains object
ID, revision, generation, cursor/checkpoint and deletion metadata. It still counts
against the scope unit quota. Deleting that revision fence would let stale creates
resurrect an object. A deliberately authorized later revision can represent a
domain-chosen recreation; replaying an old operation or expected revision cannot.
Gravestone metadata is retained for the scope's lifetime, not advertised as full
metadata erasure after the ciphertext retention window.

## Expired clients and recovery boundary

The browser preserves both its trusted checkpoint and the exact encrypted outbox
on history/operation expiry, including across storage reopen. It does not reset
to zero, accept an unverified snapshot, discard an outbox or claim synchronization
succeeded. Local encrypted content remains usable with its valid local key.
Localized messages explain the block.

Once history has expired, ordinary conflict rebase cannot prove omitted state.
Recovery requires independently trusted complete client state, including its
checkpoint and deletion/revision fences, or an explicitly reviewed product
migration into a new scope. The current example has no automatic expired-history
bootstrap or trusted full-replica transfer UI. This is an explicit supported-behavior
limit: do not run compaction in a product that requires fresh-device bootstrap
until that product supplies a reviewed trusted-state recovery path. Increasing
retention prevents future expiry but cannot recreate deleted history. Do not
classify untrusted server snapshot bootstrap as a routine reversible shortcut.

No Nive recovery actors, custody or consent are selected here. Independent protocol
review, physical devices/native runtimes and provider operations remain release
gates. The maintenance implementation and negative tests are development work;
those gates are not reasons to defer that code or silently weaken its checks.
