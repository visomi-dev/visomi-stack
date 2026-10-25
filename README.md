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
The `web-gateway` application mounts the compiled API at `/api` and owns its
HTTP listener, shared telemetry and optional PostgreSQL pool. Authentication
runs once in the host; the embedded API uses inherited mode.

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
# Or serve the gateway, which builds and mounts the compiled API:
pnpm nx serve web-gateway
```

Run one server at a time. Open <http://localhost:3000/> for the standalone API
or <http://localhost:3000/api/> for the gateway. Stop it with Ctrl+C.
The server reads `HOST` and `PORT` from the process environment; their defaults
are `localhost` and `3000`. `NODE_ENV` selects a controlled telemetry environment
label; logs are local JSON and no trace or metric exporter is configured by default.
Authentication requires PostgreSQL and explicit configuration; without it, auth routes
fail closed with 503 while the public greeting remains available. There is no Redis
dependency or `.env` loader. See the [API guide](apps/web/api/README.md) for migration
commands, authentication endpoints and middleware ownership.

For local containers, supply a high-entropy `SESSION_SECRET` of at least 32 bytes
and run `docker compose up --build app`. The separate `database-init` service
waits for healthy PostgreSQL and applies checked-in migrations before `app` can
start. The API never migrates or seeds during startup. See
[container database initialization](docs/development.md#container-database-initialization)
for reruns and seed ownership.

The serve command and HTTP response have been checked with the existing local
dependencies. A fresh-checkout installation has not yet been verified.

## Build and remaining gaps

- The API build emits `app.js`, `main.js`, shared chunks, and CommonJS package
  metadata under `dist/apps/web/api`. Preserve that complete output directory
  and provide its declared runtime dependencies when consuming it.
- The gateway emits ESM `app.js` and `main.js` under `dist/apps/web/gateway`.
  Keep the API output as its sibling directory; the gateway imports `../api/app.js`.
  Process integration tests verify that mount, inherited authentication, shared
  telemetry and resource cleanup. Angular SSR and other frontend mounts remain pending.
- API and gateway Playwright request suites verify their HTTP contracts using
  separate owned PostgreSQL clusters and local telemetry destinations. Run
  `pnpm nx e2e web-api` and `pnpm nx e2e web-gateway`.
- The container runtime targets the current standalone API, with a separate
  database initialization image. Redis and MinIO services remain in Compose from
  the earlier infrastructure setup; the API authentication slice does not use
  them. Containers do not establish gateway, worker, or deployment readiness.

## Documentation

- [API authentication and persistence](apps/web/api/README.md): schema, migrations, endpoints, ownership and verification.
- [Shared backend infrastructure](libs/backend/shared/README.md): database module, shared schemas and explicit migration commands.
- [Architecture](docs/architecture.md): current structure, intended topology, and open decisions.
- [Development](docs/development.md): project discovery, verification, contribution conventions, and maintenance.
- [Agent guidance](AGENTS.md): repository instructions for coding agents.
