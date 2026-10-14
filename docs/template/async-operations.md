# Durable asynchronous operations

The template's project-seed endpoint demonstrates reusable, database-backed
operation acceptance. It does not register Nive's financial, invitation or
inference runners, and results contain routing metadata only.

## HTTP contract

Send `POST /api/projects/{projectId}/seed` with an optional UUID
`Idempotency-Key` header. A `202` response contains the existing job projection
plus `data.operation`, with `operationId` and an ISO `expiresAt` timestamp.

The operation and its feature job commit in one transaction before the response.
Repeating a key with the same inputs in the same session returns the original
ticket. Reusing it for different inputs, or after its ten-minute expiry, returns
`409`; use a new key for an explicitly new attempt. Omitting the header requests
a new operation each time.

`GET /api/operations/{operationId}` returns `pending`, `running`, `completed` or
`failed`. Completed results contain only `jobId`; failures contain sanitized
codes. Responses use `Cache-Control: no-store`. Unknown, expired or foreign
operations return `404`, without revealing another owner's state.

## Authority and lifecycle

- Tickets bind the session, user, selected account and authentication version.
  They are not bearer credentials, and a new login cannot recover a previous
  session's ticket, even for the same user.
- Reads recheck current membership and authentication version. Realtime catch-up
  and live delivery reload persisted full-session authority, hold the session
  lease through emission, and reject account changes while waiting for the lease.
- The worker holds current session authority through feature execution and checks
  selected account, membership and routing metadata before running a handler.
  Revoked work is not executed; only system-owned failure metadata is finalized.
- Existing project progress events also recheck current session and project
  access instead of trusting a socket's historical user-room membership.

## Delivery and recovery

The database outbox is authoritative; Redis pub-sub is only a delivery hint.
Workers claim with compare-and-set leases. An abandoned lease becomes eligible
after one minute, with at most three claims. Expired and exhausted records are
finalized, and expired operation records are removed after one day.

The registered project-seed handler is bounded and idempotent. Recovery checks
the feature job's committed completion before replaying work. A transient failure
to store an already successful result leaves it recoverable rather than changing
it to a permanent failure. Future handlers must provide their own idempotent
feature writes; leases alone do not promise exactly-once execution.

Authenticated sockets may watch up to eight operation IDs with
`operation:watch`, cancel them with `operation:unwatch`, and receive
`operation:changed`. Watching after reconnect immediately reads persisted state.
Terminal watches and disconnected sockets are removed. Runtime shutdown removes
transport listeners and drains the active operation poll.

Angular consumers can use `AsyncOperations.wait(ticket, abortSignal)` in
`apps/web/app/src/app/shared/realtime/async-operations.ts`. It combines live hints
with bounded HTTP catch-up, validates responses using Zod Mini, and cancels
requests, timers and watches on abort, logout, account change or application
destruction. The template has no product-specific seed page; feature routes can
consume this helper without adding hidden bootstrap components.

## Runtime modes and deployment

Production uses PostgreSQL persistence and the separately spawned worker.
Apply `drizzle/20261003190000_durable_operations/migration.sql` through the normal
deployment migration process. Account RLS protects operation rows; HTTP code also
filters by the session-bound owner. Outbox discovery and finalization require the
trusted infrastructure database role, not a tenant-restricted client connection.
Never expose that role or raw operation rows to browser clients.

The composed `memory` gateway shares one process-local PGlite database across its
bundles and runs the operation poll in process. Its pub-sub also stays in process,
so this fixture does not require Redis for operation delivery. Memory mode is
ephemeral: restarting the gateway loses its database and sessions. Separate
standalone memory API/worker processes do not share state; use PostgreSQL for
multi-process development and persistence.

The local verification exercises PGlite migrations, non-owner-role RLS, HTTP,
native sockets, reconnect and revocation. It does not certify real PostgreSQL
failover, production deployment, provider recovery or arbitrary long-running
handlers.
