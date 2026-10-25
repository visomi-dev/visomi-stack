# Visomi Stack

A reusable application foundation being rebuilt incrementally with Nx and TypeScript.
It combines Screaming Architecture with Domain-Driven Design: business domains
and capabilities determine feature organization, while cross-cutting infrastructure
lives in shared libraries. The intended runtime direction is Angular SSR, Astro,
Express, and explicit gateway, worker, and realtime boundaries.

## Current state

The API project, `web-api` in `apps/web/api`, exports `createApp()` separately
from its standalone server. `GET /` returns `{"message":"Hello API"}`.
The `web-backend-shared` library contains the Pino/OpenTelemetry integration.
The `web-gateway` application is a separate scaffold; API composition there
is still in progress and is not verified by the API's import-contract tests.

Angular tooling is installed, but Angular SSR, Astro, worker, and realtime
applications have not been implemented. The API now supports PostgreSQL-backed passkey authentication and durable sessions.
Business domains remain future work; this slice does not demonstrate a complete DDD model.

The agreed topology is documented in [Architecture](docs/architecture.md).
Descriptions of the previous stack and Nive are reference material, not evidence
that their features exist in this repository.

## Local development

Use Node **24.15.0** from `.node-version` and pnpm **12.15.0** from
`package.json#devEngines.packageManager`. Nx is pinned to **24.0.1**.
Dependency versions and resolution are recorded in `package.json` and `pnpm-lock.yaml`.

From the repository root, with those tools available:

```sh
pnpm install --frozen-lockfile
NX_DAEMON=false pnpm nx run web-api:serve
```

Open <http://localhost:3000/>. Stop the development server with Ctrl+C.
The server reads `HOST` and `PORT` from the process environment; their defaults
are `localhost` and `3000`. `NODE_ENV` selects a controlled telemetry environment
label; logs are local JSON and no trace or metric exporter is configured by default.
Authentication requires PostgreSQL and explicit configuration; without it, auth routes
fail closed with 503 while the public greeting remains available. There is no Redis
dependency or `.env` loader. See the [API guide](apps/web/api/README.md) for migration
commands, authentication endpoints and middleware ownership.

The serve command and HTTP response have been checked with the existing local
dependencies. A fresh-checkout installation has not yet been verified.

## Build and remaining gaps

- The API build emits `app.js`, `main.js`, shared chunks, and CommonJS package
  metadata under `dist/apps/web/api`. Preserve that complete output directory
  and provide its declared runtime dependencies when consuming it.
- Focused tests verify the API boundary and shared telemetry. A complete gateway,
  queue, deployment, or production-readiness claim requires separate verification.
- `Dockerfile` and `compose.yaml` contain configuration inherited from the previous
  stack. They reference absent runtimes, packages, and an `.env` file; they are not
  a working application bootstrap or a verified deployment path.

## Documentation

- [API authentication and persistence](apps/web/api/README.md): schema, migrations, endpoints, ownership and verification.
- [Shared backend infrastructure](libs/backend/shared/README.md): database module, shared schemas and explicit migration commands.
- [Architecture](docs/architecture.md): current structure, intended topology, and open decisions.
- [Development](docs/development.md): project discovery, verification, contribution conventions, and maintenance.
- [Agent guidance](AGENTS.md): repository instructions for coding agents.
