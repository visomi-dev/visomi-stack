# Backend Agent Guidance

These instructions apply to Node backend, API, worker, realtime, validation, contracts, persistence, and tenancy work in Themis.

## Module Pattern

- Organize backend source using feature-first folders at `src/<feature>` and shared infrastructure at `src/shared/<area>`.
- Prefer plain module exports for backend features: feature-local schemas, service functions, and a `router` constant exported directly from the feature.
- Avoid `buildXRouter` or `createXService` factories for normal feature wiring.
- Shared auth and authorization concerns must live in reusable middleware modules, not be redefined per feature.
- Role and permission checks should be expressible through shared middleware options such as arrays of allowed roles or permissions.
- API, worker, and realtime apps must stay narrow: `apps/web/api` owns HTTP, `apps/worker` owns BullMQ workers, `apps/web/realtime` owns websocket delivery, and `apps/web/server` owns gateway/proxy wiring.
- Backend features should prefer top-level folders such as `src/auth`, `src/activation`, and `src/projects`.
- Avoid global catch-all folders like `src/jobs` or `src/realtime` when behavior belongs to a specific feature domain.

## Shared Libraries

- Cross-cutting runtime and platform code shared across backend runtimes belongs in `libs/shared`.
- `libs/shared` is only for cross-cutting runtime concerns such as env loading, logger, database access, Redis connections, sessions, and generic transport primitives.
- Feature-shared domain code must live in a dedicated feature library such as `libs/projects`, not in `libs/shared`.
- Do not deep-import another feature's private implementation details. Use shared contracts or feature libraries.

## Async And Realtime Files

- Use `queue.ts` for queue configuration and producer helpers.
- Use `processor.ts` for job logic.
- Use `worker.ts` for BullMQ worker bootstrap.
- Use `subscriber.ts` for realtime fanout subscriptions.
- Use `contract.ts` for shared feature contracts.
- Async jobs and realtime events must carry explicit account context.

## Validation And Contracts

- Use Zod v4 for all backend request and data validation.
- Route validation must go through the shared typed middleware in `src/shared/http/route-schemas.ts` so `body`, `query`, `params`, and `headers` are parsed consistently.
- Use zod-openapi for route documentation.
- Feature-local schema files should export OpenAPI path objects used by the shared document builder.
- Prefer schema-derived types where it improves consistency, but keep exported types readable and local to the feature when possible.

## Tenancy

- Themis uses a hybrid multi-tenant architecture with shared-schema by default and a path to stronger isolation later.
- Treat `account_id` as the primary tenant boundary for tenant-owned data. Do not rely on `user_id` alone for isolation.
- Keep `users` global and model tenant access through `accounts` and `account_memberships`.
- Tenant-owned backend tables should be scoped by `account_id` and protected with Postgres RLS plus app-layer authorization checks.
- API keys, projects, documents, async jobs, and realtime events must all carry explicit account context.

## TypeScript Backend Style

- Use strict type checking and avoid `any`; use `unknown` when the shape is uncertain.
- Use function declarations for reusable module logic.
- Arrow functions are acceptable for short inline callbacks passed directly to APIs.
- Keep imports at the top and use type-only imports for types.
- Import directly from source files. Do not use barrel re-exports.

## Backend Verification

- Prefer focused Nx targets for affected backend projects.
- For generated Node libraries, use `pnpm nx g @nx/node:lib libs/<thing> --linter=eslint --unitTestRunner=jest`.
- If adding or changing contracts, verify both the producer and consumer projects when feasible.
