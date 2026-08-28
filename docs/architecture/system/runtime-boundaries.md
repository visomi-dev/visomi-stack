# ADR: Split Worker And Realtime Runtimes

## Status

Accepted

## Context

Themis currently keeps project async work and realtime delivery too close to the API and gateway runtimes:

- BullMQ queue, worker bootstrap, and processor logic live under `apps/web/api`
- Socket.IO delivery lives under `apps/web/server`
- cross-runtime events rely on an in-process event emitter

That shape conflicts with the repository direction:

- feature-first backend architecture
- dedicated runtimes for HTTP, background work, and realtime delivery
- KISS boundaries that avoid generic global `jobs`, `queues`, and `workers`

It also prevents the worker and realtime processes from scaling or running independently.

## Decision

Adopt four runtime boundaries:

- `apps/web/api` owns HTTP endpoints only
- `apps/worker` owns BullMQ worker bootstraps and processors only
- `apps/web/realtime` owns Socket.IO auth, subscriptions, and room fanout only
- `apps/web/server` owns gateway and reverse proxy behavior only

Preserve `/socket.io` as the public websocket path on the same HTTP server used by `/api`, `/app`, and `/`.

Replace the in-process realtime event bus with Redis pub/sub.

Keep true cross-cutting runtime code in `libs/shared`:

- `db/`
- `redis/`
- `session/`
- `env.ts`
- `logger.ts`

Move projects-domain shared code into `libs/projects`:

- project async-work contracts
- project seed queue contracts
- project job record access
- shared project seed domain services

## Consequences

Benefits:

- each runtime has one clear responsibility
- API instances no longer consume BullMQ work accidentally
- realtime delivery no longer depends on API process memory
- shared feature code has a stable home in `libs/projects`

Tradeoffs:

- local, test, and production environments must all use shared DB-backed sessions
- Redis becomes required for cross-process event delivery
- the public server must attach Socket.IO to the shared HTTP server for `/socket.io`

## Naming Rules

For async and realtime feature code:

- `queue.ts` for queue configuration and producer helpers
- `processor.ts` for BullMQ job logic
- `worker.ts` for BullMQ worker bootstrap
- `subscriber.ts` for realtime subscriptions and fanout
- `contract.ts` for shared feature contracts

## Library Rule

New backend and shared Node libraries must be generated with:

```bash
pnpm nx g @nx/node:lib libs/<thing> --linter=eslint --unitTestRunner=jest
```
