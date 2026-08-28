# Themis Architecture Review and Refactor Recommendations

**Date:** 2026-05-07

**Scope:** Architecture-only review of the current Themis repository. This document records what I would change, improve, or refactor after exploring the repo. No source code changes were made as part of the review.

**Repository state reviewed:**

- Branch: `feat/webapp-activation-projects`
- Main runtime shape: Nx monorepo with Astro site, Angular app, Express API, gateway server, Socket.IO realtime runtime, BullMQ worker, `libs/shared`, and `libs/projects`.

---

## High-level verdict

The current architecture is directionally strong for this stage of Themis.

The monolith-friendly Nx shape is a good fit because it keeps the project simple while preserving explicit runtime boundaries:

- `apps/web/site` — Astro public/marketing surface
- `apps/web/app` — Angular product app
- `apps/web/api` — Express API
- `apps/web/server` — public gateway/composition server
- `apps/web/realtime` — Socket.IO realtime runtime
- `apps/worker` — BullMQ background worker runtime
- `libs/shared` — cross-runtime platform/runtime utilities
- `libs/projects` — project-domain code shared by API, worker, and realtime

I would not introduce a heavier architecture right now. Specifically, I would avoid:

- NestJS migration
- microservices
- CQRS/event-sourcing
- a global event bus framework
- NgRx or another frontend state framework
- a generic `platform` mega-library
- an early plugin system

The best next architecture work is to tighten the existing boundaries rather than add new abstractions.

---

## P0: Implement real tenant safety and RLS

### Current state

The data model is already moving in the right direction. Tenant-owned tables carry `account_id`, and `withAccountContext()` sets database session variables:

- `app.current_account_id`
- `app.current_user_id`

Relevant files:

- `libs/shared/src/lib/db/schema.ts`
- `libs/shared/src/lib/db/account-context.ts`
- `drizzle/20260426010156_curved_madame_hydra/migration.sql`
- `docs/architecture/system/multi-tenant.md`

Tenant-owned tables currently include:

- `api_keys`
- `user_activation_milestones`
- `projects`
- `project_documents`
- `async_jobs`

### Gap

The docs describe Postgres RLS as part of the tenant safety model, but the migrations reviewed do not currently enable row-level security or create policies.

That means `withAccountContext()` is useful groundwork, but the database is not yet enforcing the tenant boundary.

### Recommendation

Add a migration that enables RLS for tenant-owned tables and creates policies based on `app.current_account_id`.

Recommended tables:

- `api_keys`
- `user_activation_milestones`
- `projects`
- `project_documents`
- `async_jobs`

Add tenant-focused indexes:

- `projects(account_id, slug)`
- `projects(account_id, created_at)`
- `project_documents(account_id, project_id)`
- `async_jobs(account_id, project_id, created_at)`
- `api_keys(account_id, revoked_at)`

Add this unique constraint:

- `projects(account_id, slug)`

Also tighten tenant-owned lookups so they query by `account_id` and id together, rather than querying by id and checking account ownership afterward.

Example to revisit:

- `apps/web/api/src/activation/activation-service.ts:154-168`

Current shape queries an API key by `id`, then checks `existingKey.accountId !== accountId` in app code. It is safe because the check exists, but it should still be queried as `account_id + id` for consistency and future RLS alignment.

### Why first

This is the most important architectural improvement because Themis is explicitly multi-tenant. More product surface should not be built on top of tenant isolation that exists only at the application layer.

---

## P1: Clarify project seed ownership and naming

### Current state

The async project seed flow is good enough and already follows the intended runtime separation:

1. API creates the async job and enqueues BullMQ work.
2. Worker processes the job.
3. Project-domain code updates records and publishes Redis events.
4. Realtime runtime subscribes and fans out Socket.IO events.
5. Angular app listens and updates UI state.

Relevant files:

- `apps/web/api/src/projects/projects-router.ts`
- `apps/web/api/src/projects/project-seed-queue.ts`
- `libs/projects/src/lib/seed/queue.ts`
- `libs/projects/src/lib/seed/service.ts`
- `libs/projects/src/lib/seed/events.ts`
- `apps/worker/src/projects/project-seed/worker.ts`
- `apps/web/realtime/src/projects/project-seed/subscriber.ts`
- `apps/web/app/src/app/shared/jobs/project-seed.ts`

### Gap

The ownership and naming are a little confusing:

- `apps/web/api/src/projects/project-seed-queue.ts` owns important domain orchestration: create async job, enqueue BullMQ job, publish queued event.
- `libs/projects/src/lib/seed/service.ts` exposes `queueProjectSeed()`, but that function only validates/returns a project. It is not the actual queue path.
- `libs/projects/src/index.ts` exports broad internals, which makes accidental cross-runtime imports easier.

### Recommendation

Make one obvious project seed entrypoint.

Preferred direction:

- Move project seed orchestration into `libs/projects/src/lib/seed/service.ts`.
- Keep the API route as a thin HTTP adapter.
- Rename functions so they describe what they actually do.

Possible naming:

- `enqueueProjectSeedJob()` — creates async job, enqueues BullMQ job, publishes queued event.
- `assertProjectSeedable()` — validates that a project exists and can be seeded.
- `processProjectSeedJob()` — worker-side processing.
- `failProjectSeedJob()` — worker failure transition.

Also reduce exports from `libs/projects/src/index.ts`:

- Export contracts and intentional service entrypoints.
- Avoid exporting records, queue internals, and event internals unless another runtime truly needs them.

### Why this matters

The current design is close. The main risk is future confusion, not current breakage. Clear naming and export boundaries will make future project-foundation work easier.

---

## P1: Split gateway bootstrap into small runtime modules

### Current state

`apps/web/server/src/main.ts` handles many responsibilities:

- resolves built output paths
- dynamically imports API
- dynamically imports Angular SSR
- dynamically imports Astro
- dynamically imports realtime
- starts the worker child process
- handles shutdown
- starts the HTTP server

Relevant files:

- `apps/web/server/src/main.ts`
- `apps/web/server/src/gateway.ts`
- `apps/web/server/project.json`

### Gap

The gateway is both the public HTTP composition layer and a process/runtime supervisor. That is acceptable for the current monolith deployment, but the bootstrap file is getting dense and is tightly coupled to build output paths.

### Recommendation

Keep the current monolith-friendly deployment model, but split the bootstrap into small modules.

Possible shape:

- `apps/web/server/src/runtime/load-api.ts`
- `apps/web/server/src/runtime/load-angular.ts`
- `apps/web/server/src/runtime/load-astro.ts`
- `apps/web/server/src/runtime/load-realtime.ts`
- `apps/web/server/src/runtime/start-worker.ts`
- `apps/web/server/src/runtime/shutdown.ts`

This does not need to change behavior. It only makes each runtime concern easier to reason about and test.

### Why this matters

The gateway is the composition root for the product. Keeping it readable prevents deployment and local-development bugs later.

---

## P2: Make active account context explicit

### Current state

API auth context currently derives tenant information from `req.user`:

- `req.user.accountId`
- `req.user.role`
- `req.user.id`

Relevant file:

- `apps/web/api/src/auth/auth-middleware.ts`

This is fine for a single-account early product.

### Gap

The data model already has:

- `accounts`
- `account_memberships`

But there is no explicit active account resolution boundary yet. If multi-account UX appears later, scattered assumptions about `req.user.accountId` will become harder to unwind.

### Recommendation

Add a small explicit abstraction before multi-account workflows grow.

Possible names:

- `resolveActiveAccount(req)`
- `activeAccountMiddleware`
- `accountContextMiddleware`

Responsibilities:

- read active account from session/user context
- validate membership
- attach a single request account context
- expose `accountId`, `userId`, and `role`

Do not build a full account-switching system yet. This should stay small and KISS.

### Why this matters

This preserves the current simple model while preventing tenant assumptions from leaking into every feature.

---

## P2: Add graceful worker shutdown

### Current state

The gateway starts the worker as a child process and sends `SIGTERM` during shutdown.

Relevant files:

- `apps/web/server/src/main.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/projects/project-seed/worker.ts`

### Gap

The worker runtime should close BullMQ workers gracefully when the process receives shutdown signals.

### Recommendation

Track BullMQ worker instances in `apps/worker/src/main.ts` and call `worker.close()` on shutdown.

Desired behavior:

- receive `SIGINT` or `SIGTERM`
- stop accepting new work
- close BullMQ worker connections
- exit cleanly

Keep this simple. No worker framework is needed.

### Why this matters

It improves reliability during deploys, local restarts, and future production operations.

---

## P2/P3: Make realtime event scoping future-safe

### Current state

Realtime project seed events are emitted to user-scoped rooms:

```ts
io.to(`user:${event.job.userId}`).emit(event.eventName, event);
```

Relevant files:

- `apps/web/realtime/src/projects/project-seed/subscriber.ts`
- `apps/web/realtime/src/shared/socket-server.ts`
- `apps/web/app/src/app/shared/realtime/realtime.ts`
- `apps/web/app/src/app/shared/jobs/project-seed.ts`

This is fine for the current single-user project seed flow.

### Gap

Future collaborative project workflows will likely need account-scoped or project-scoped fanout.

Angular also stores only `lastEvent`, and `ProjectSeed` stores the latest job by `projectId`. That works for one active job per project, but it loses fidelity if multiple jobs run concurrently.

### Recommendation

Keep user-scoped events for now, but define the taxonomy deliberately:

- current: `user:{userId}`
- later: `account:{accountId}`
- later: `project:{projectId}`

Frontend improvement when needed:

- store jobs by `job.id`
- derive the latest job per project separately
- keep `lastEvent` only as a convenience, not the source of truth

### Why this matters

This avoids a premature realtime abstraction while keeping the design ready for collaborative workflows.

---

## P3: Share frontend/backend DTO contracts safely

### Current state

Backend/domain contracts exist in:

- `libs/projects/src/lib/contracts/projects.ts`
- `libs/projects/src/lib/contracts/async-jobs.ts`
- `libs/projects/src/lib/contracts/project-seed.ts`

Angular duplicates similar models in:

- `apps/web/app/src/app/shared/projects/projects.models.ts`
- `apps/web/app/src/app/shared/realtime/realtime.models.ts`

### Gap

Duplicated DTO types can drift as API responses evolve.

### Recommendation

Create a browser-safe contract boundary.

Options:

1. Add `libs/projects-contracts` for DTO-only exports.
2. Keep DTO-only files in `libs/projects/src/lib/contracts/*`, but enforce that they never import DB, Node, BullMQ, Redis, or server-only code.

Angular services can stay app-local and simple, but they should import shared DTO types instead of redefining them.

Do not add a generated API client unless API churn becomes painful.

### Why this matters

This keeps frontend/backend agreement tight without adding heavy tooling.

---

## Things I would leave alone for now

### Astro and Angular split

The current split is good:

- Astro for marketing/public pages
- Angular for dense product workflows

Relevant files:

- `apps/web/site`
- `apps/web/app`
- `apps/web/server/src/gateway.ts`

No major refactor needed.

### Runtime split

The API, worker, realtime, and gateway split is appropriate. I would not collapse everything into the API process, and I would not split into independently deployed services yet.

### Angular state management

The current Angular services and signals are simple and understandable. I would not introduce NgRx or another state framework now.

### Backend feature-first folders

The current backend folder direction matches the repo conventions:

- `auth/`
- `activation/`
- `projects/`
- `shared/`

Keep this pattern.

---

## Recommended implementation sequence

### Step 1: Tenant safety

Files to touch later:

- `libs/shared/src/lib/db/schema.ts`
- new Drizzle migration under `drizzle/`
- tenant-owned query sites such as `apps/web/api/src/activation/activation-service.ts`

Outcome:

- RLS enabled
- policies added
- indexes added
- tenant-owned lookups consistently scoped by `account_id`

### Step 2: Project seed boundary cleanup

Files to touch later:

- `apps/web/api/src/projects/project-seed-queue.ts`
- `libs/projects/src/lib/seed/service.ts`
- `libs/projects/src/lib/seed/queue.ts`
- `libs/projects/src/index.ts`

Outcome:

- one clear seed enqueue entrypoint
- API route becomes a thin adapter
- confusing function names removed
- public exports narrowed

### Step 3: Gateway bootstrap split

Files to touch later:

- `apps/web/server/src/main.ts`
- new files under `apps/web/server/src/runtime/`

Outcome:

- same behavior
- smaller composition modules
- easier gateway tests

### Step 4: Active account context

Files to touch later:

- `apps/web/api/src/auth/auth-middleware.ts`
- possibly `apps/web/api/src/types/express.d.ts`
- realtime socket auth later when account switching exists

Outcome:

- active account resolved explicitly
- membership validation centralized
- feature code stops depending directly on `req.user.accountId`

### Step 5: Worker graceful shutdown

Files to touch later:

- `apps/worker/src/main.ts`
- `apps/worker/src/projects/project-seed/worker.ts`

Outcome:

- BullMQ workers close cleanly on `SIGTERM`/`SIGINT`

### Step 6: Shared DTO contracts

Files to touch later:

- `libs/projects/src/lib/contracts/*`
- or new `libs/projects-contracts`
- `apps/web/app/src/app/shared/projects/projects.models.ts`
- `apps/web/app/src/app/shared/realtime/realtime.models.ts`

Outcome:

- frontend/backend DTOs no longer drift
- no heavy generated client required

---

## KISS guardrails

While improving the architecture, keep these constraints:

- Prefer plain module exports.
- Keep API routes thin.
- Keep domain logic in feature/domain libs, not `libs/shared`.
- Keep `libs/shared` limited to cross-runtime platform concerns.
- Do not add framework abstractions unless repeated pain appears.
- Do not split deploy units before operational need exists.
- Prefer one obvious entrypoint over flexible but unclear wiring.

---

## Summary

The architecture is good. The repo does not need a big rewrite.

The best architecture improvements are:

1. Enforce tenant isolation at the database layer.
2. Clarify async project seed ownership and naming.
3. Split gateway bootstrap into small runtime modules.
4. Make active account context explicit.
5. Gracefully close worker runtimes.
6. Share frontend/backend DTO contracts safely.

This keeps Themis simple while making it safer to expand the product surface.
