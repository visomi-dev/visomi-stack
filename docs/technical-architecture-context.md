# Technical Architecture Context

## Stack

- Nx 23 monorepo managed with pnpm 10.
- Node.js 24 in CI.
- TypeScript 6 with strict compiler settings.
- Angular 22 with SSR.
- Astro 6 with the Node adapter in middleware mode.
- Tailwind CSS 4 through Vite/PostCSS integration.
- Express 5 for HTTP services.
- Socket.IO 4 for realtime communication.
- BullMQ 5 for background jobs.
- PostgreSQL through `pg` and Drizzle ORM.
- PGlite for in-memory database execution and tests.
- Redis through `ioredis` for queues and pub/sub.
- Zod 4 and `zod-openapi` for validation and API contracts.
- `express-session` with either an in-memory store or a PostgreSQL-backed store.
- Mailgun with an in-memory mail transport alternative.
- Pino and Morgan for logging.
- Helmet for security headers.
- Vitest, Jest, and Playwright for testing.
- ESLint, Prettier, Husky, lint-staged, Commitlint, Docker, and GitHub Actions.

## Repository Structure

```text
apps/
├── web/
│   ├── app/              # Angular SSR application
│   ├── site/             # Astro SSR/middleware application
│   ├── api/              # Express API runtime
│   ├── server/           # Public HTTP gateway
│   ├── realtime/         # Socket.IO runtime
│   ├── ui-designer/      # UI prototype server
│   ├── app-e2e/          # Angular E2E tests
│   ├── site-e2e/         # Astro E2E tests
│   ├── api-e2e/          # API E2E tests
│   ├── server-e2e/       # Gateway E2E tests
│   └── realtime-e2e/     # Realtime E2E tests
└── worker/
    └── src/              # BullMQ worker runtime

libs/
├── shared/               # Cross-cutting infrastructure
└── projects/             # Shared feature contracts and services
```

Each application has its own Nx project configuration, TypeScript configuration, ESLint configuration, and targets.

## Runtime Architecture

The system uses one public gateway with multiple internal runtimes:

```text
Client
  |
  v
apps/web/server
  ├── /api/*       -> apps/web/api
  ├── /app/*       -> Angular SSR or Angular dev server
  ├── /socket.io   -> Socket.IO/realtime
  └── /*           -> Astro SSR
```

The gateway also:

- Configures security headers with Helmet.
- Mounts authentication and session middleware.
- Exposes `/healthz`.
- Serves Astro static assets.
- Proxies to the Angular development server when configured.
- Starts the worker as a child process.
- Attaches Socket.IO to the same HTTP server.

### API Runtime

`apps/web/api` is an Express application that can run standalone or be embedded into the gateway.

Responsibilities include:

- JSON parsing.
- HTTP logging with Morgan.
- Authentication middleware.
- Optional database migrations during startup.
- Feature-based routers under `/auth`, `/activation`, and `/projects`.
- Optional `/test` routes controlled by configuration.
- OpenAPI output at `/openapi.json`.
- Centralized error handling.

### Realtime Runtime

`apps/web/realtime` contains:

- Socket.IO server creation.
- Session-based authentication.
- Subscriptions and room fanout.
- Redis pub/sub integration.
- `attachRealtimeServer()` for gateway integration.

### Worker Runtime

`apps/worker` contains:

- BullMQ bootstrap code.
- Background job processors.
- Optional database migrations during startup.
- Feature-specific worker implementations.

The gateway starts this runtime as a child process. If the worker exits unexpectedly, the gateway terminates as well.

## Shared Libraries

### `libs/shared`

```text
libs/shared/src/lib/
├── db/
│   ├── client.ts
│   ├── pool.ts
│   ├── schema.ts
│   ├── migrate.ts
│   └── account-context.ts
├── redis/
│   ├── connection.ts
│   └── pub-sub.ts
├── session.ts
├── env.ts
├── logger.ts
└── http/
```

This library provides database clients, PostgreSQL pooling, PGlite support, migrations, session handling, Redis connections, pub/sub, environment validation, logging, and shared HTTP utilities.

### `libs/projects`

```text
libs/projects/src/lib/
├── contracts/
├── records/
├── seed/
└── projects-service.ts
```

This library contains shared TypeScript contracts, record access, queue helpers, and services used across the API, worker, realtime runtime, and Angular application.

TypeScript aliases are defined in `tsconfig.base.json`:

```json
{
  "shared": ["libs/shared/src/index.ts"],
  "projects": ["libs/projects/src/index.ts"]
}
```

## Persistence

Drizzle uses PostgreSQL as the primary database and PGlite as the in-memory alternative.

The schema includes tables for:

- Users.
- Accounts and memberships.
- Sessions.
- Authentication verification challenges.
- Remembered devices.
- API keys.
- Activation milestones.
- Projects.
- Project documents.
- Asynchronous jobs.

The database driver is selected with:

```text
DATABASE_DRIVER=pg
DATABASE_DRIVER=memory
```

Relations use foreign keys, indexes, and unique indexes.

## Sessions And Multiple Runtimes

Sessions are shared between runtimes:

- `memory` uses `MemoryStore`.
- `pg` uses a custom `PostgresSessionStore`.
- The PostgreSQL store persists sessions in `user_sessions`.
- Cookies are `httpOnly`, use `sameSite=lax`, and have configurable `secure` behavior.
- PostgreSQL allows the API, realtime runtime, and gateway to share session state across processes.

## Configuration

Environment variables are loaded with `dotenv` and validated with Zod.

Important variables include:

```text
NODE_ENV
DATABASE_URL
DATABASE_DRIVER
DATABASE_SSL
DATABASE_AUTO_MIGRATE
REDIS_URL
SESSION_SECRET
SESSION_MAX_AGE_MS
COOKIE_SECURE
API_INTERNAL_URL
REALTIME_INTERNAL_URL
REALTIME_PATH
APP_BASE_URL
GATEWAY_PORT
APP_DEV_SERVER_URL
MAIL_TRANSPORT
MAILGUN_API_KEY
MAILGUN_DOMAIN
MAILGUN_FROM
MAILGUN_URL
ENABLE_TEST_API
```

Configuration parsing and defaults are implemented in `libs/shared/src/lib/env.ts`.

## Angular Architecture

The Angular application uses:

- Standalone components.
- `bootstrapApplication`.
- Angular Router.
- SSR.
- Lazy loading through `loadComponent`.
- Functional route guards.
- Domain-first source organization.

```text
apps/web/app/src/app/
├── auth/
├── activation/
├── projects/
├── dashboard/
└── shared/
    ├── auth/
    ├── activation/
    ├── constants/
    ├── jobs/
    ├── ui/
    └── ...
```

Route components are grouped by domain or feature rather than placed in a global `pages/` directory.

## Astro Architecture

`apps/web/site` uses:

- Astro SSR.
- `@astrojs/node`.
- Server output.
- Middleware mode.
- Tailwind through the Vite plugin.
- `en` and `es` locales.
- Locale-prefixed routes.
- Trailing slashes.

The gateway loads the generated Astro SSR handler and serves its static assets.

## Nx Configuration

Nx provides targets and plugins for Angular, Node, esbuild, Vite, Vitest, Jest, Playwright, and ESLint.

Common targets are:

```text
build
serve
test
lint
e2e
preview
```

Caching is enabled for builds, linting, typechecking, and tests. Build targets depend on upstream project builds through `dependsOn: ["^build"]`.

## Testing

### Unit Tests

- Vitest is used for Angular, Astro, and libraries.
- Jest is used for API, gateway, worker, and realtime runtimes.

### E2E Tests

Playwright projects are separated by runtime or frontend:

```text
apps/web/app-e2e
apps/web/site-e2e
apps/web/api-e2e
apps/web/server-e2e
apps/web/realtime-e2e
apps/worker-e2e
```

E2E setup generally uses `DATABASE_DRIVER=memory`, which activates PGlite and avoids external database dependencies.

## CI/CD

GitHub Actions runs:

```text
pnpm install --frozen-lockfile
pnpm exec prettier --check .
pnpm nx run-many -t lint ...
pnpm nx run site:typecheck
pnpm nx run site:test
pnpm nx run app:vite:test
pnpm nx run api:test
pnpm nx run server:test
pnpm nx run server:build
```

A separate Docker workflow builds the production image with Docker Buildx.

## Technical Conventions

- Strict TypeScript.
- Type-only imports use `import type`.
- Workspace aliases are used for shared libraries.
- Source code is organized by feature or domain.
- HTTP, realtime, and background jobs run in separate runtime boundaries.
- Redis is used for cross-process communication.
- PostgreSQL is the persistent source of truth.
- PGlite is used for memory mode and tests.
- Zod is used for configuration and validation.
- Shared feature contracts belong in `libs/projects`.
- Prettier is the primary formatter.
- ESLint includes Angular, Astro, import, and Playwright rules.
- New Nx tasks should be run through pnpm and Nx.
- Cross-feature code should use public library entrypoints rather than deep imports into private implementations.

## Key Files

```text
package.json
pnpm-workspace.yaml
nx.json
tsconfig.base.json

apps/web/server/src/main.ts
apps/web/server/src/gateway.ts
apps/web/api/src/main.ts
apps/web/api/src/app.ts
apps/web/realtime/src/main.ts
apps/worker/src/main.ts
apps/web/app/src/main.ts
apps/web/app/src/app/app.routes.ts
apps/web/site/astro.config.mjs

libs/shared/src/lib/env.ts
libs/shared/src/lib/db/client.ts
libs/shared/src/lib/db/schema.ts
libs/shared/src/lib/session.ts
libs/shared/src/lib/redis/pub-sub.ts
libs/projects/src/index.ts
```
