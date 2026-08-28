# Backend Feature Architecture

## Purpose

Define the preferred backend structure for Themis across API, worker, realtime, gateway, and shared libraries.

## Directory Shape

Use feature-first folders at the top of each runtime app:

- `apps/web/api/src/<feature>` for HTTP features
- `apps/worker/src/<feature>` for BullMQ worker features
- `apps/web/realtime/src/<feature>` for websocket subscription features

For the API app, prefer top-level feature folders such as:

- `auth/`
- `activation/`
- `projects/`
- `testing/`

Use `shared/` only for cross-feature backend infrastructure:

- `shared/db/`
- `shared/http/`

Use `libs/shared/` only for cross-runtime platform concerns:

- env loading
- session helpers
- HTTP error utilities
- logger
- database access
- Redis connections and generic publish/subscribe helpers

Use feature-specific libraries such as `libs/projects/` for shared domain code:

- queue contracts
- async job record access
- feature event payloads
- domain services reused by API, worker, and realtime

## Feature Pattern

Each feature should prefer plain module exports rather than factories or builder wrappers.

Recommended feature contents:

- `feature-router.ts`
- `feature-service.ts`
- `feature-schemas.ts`
- `feature-types.ts`

For async and realtime features, use these file roles when needed:

- `queue.ts`
- `processor.ts`
- `worker.ts`
- `subscriber.ts`
- `contract.ts`

Recommended pattern:

- feature-local schemas live next to the feature
- service functions are exported directly from the service module
- the feature router is exported as a configured `Router` constant
- shared middleware is imported from other modules, not recreated per feature

## Example Shape

For auth:

- `auth/auth-router.ts`
- `auth/auth-service.ts`
- `auth/auth-schemas.ts`
- `auth/auth-types.ts`
- `auth/auth-middleware.ts`

For projects HTTP code:

- `projects/projects-router.ts`
- `projects/projects-service.ts`
- `projects/projects-schemas.ts`
- `projects/projects-types.ts`

For projects shared domain code:

- `libs/projects/src/lib/contracts/project-seed.ts`
- `libs/projects/src/lib/records/async-job-records.ts`
- `libs/projects/src/lib/seed/queue.ts`
- `libs/projects/src/lib/seed/service.ts`

For projects worker code:

- `apps/worker/src/projects/project-seed/processor.ts`
- `apps/worker/src/projects/project-seed/worker.ts`

For realtime fanout code:

- `apps/web/realtime/src/projects/project-seed/subscriber.ts`

## Validation Pattern

All route input validation must use Zod v4.

Use the typed middleware from `shared/http/route-schemas.ts`:

- `validateRequest({ body })`
- `validateRequest({ query })`
- `validateRequest({ params })`
- `validateRequest({ headers })`

Read parsed values with:

- `readValidated(req)`

## OpenAPI Pattern

Each feature owns its OpenAPI path metadata next to the feature schemas.

Examples:

- `auth/auth-schemas.ts` exports `authOpenApiPaths`
- `projects/projects-schemas.ts` exports `projectsOpenApiPaths`
- `activation/activation-schemas.ts` exports `activationOpenApiPaths`

The shared document builder under `shared/http/openapi.ts` composes all feature path objects into one document.

## Runtime Pattern

API runtime:

- `app.ts` wires middleware and mounts feature routers
- features are imported directly from their folders
- environment comes from `shared/env.ts`
- API must not create BullMQ workers or websocket servers

Worker runtime:

- `apps/worker/src/main.ts` bootstraps feature workers
- worker apps depend on shared runtime from `libs/shared` and feature libs such as `libs/projects`
- worker apps do not expose HTTP routes

Realtime feature code:

- `apps/web/realtime` owns Socket.IO auth, subscriptions, and room fanout code
- `apps/web/server` attaches realtime to the shared HTTP server
- realtime code authenticates sockets through the shared session store
- realtime code subscribes to Redis pub/sub and fans out to socket rooms

Server runtime:

- keep public HTTP server composition in `apps/web/server/src/`
- preserve `/socket.io` by attaching Socket.IO to the same HTTP server as `/api`, `/app`, and `/`
- do not run API or realtime as separate HTTP servers for the monolith path

## Do Not Do

- do not put all backend code in `src/lib/`
- do not add `buildXRouter` or `createXService` wrappers for normal feature modules
- do not split schemas away from the feature they describe
- do not redefine auth guards or account context logic in every feature
- do not place feature-shared domain code in `libs/shared`
- do not create generic global `jobs`, `queues`, or `workers` buckets when the code belongs to a feature domain
- do not use an in-process event emitter as a cross-runtime boundary

## Session And Runtime Notes

- Do not depend on `connect-pg-simple` for session persistence. The shared runtime uses an in-repo Postgres-backed `express-session` store.
- Keep shared runtime code in `libs/shared` lean and framework-agnostic enough to work in API, worker, realtime, and gateway builds.
- Local, test, and production environments should all use shared DB-backed sessions for realtime socket auth.

## Tenancy Notes

- Themis uses shared-schema multi-tenancy by default.
- `account_id` is the tenant boundary on tenant-owned data.
- RLS is the database safety layer, but app-layer authorization still applies.
- Tenant-aware operations should pass account context explicitly for jobs, realtime, projects, documents, and activation state.

## Validation And OpenAPI Notes

- All backend request validation uses Zod v4.
- OpenAPI docs are derived from feature-local schemas via zod-openapi.
- The canonical generated document is served from `/api/openapi.json`.
