# Visomi Stack

Reusable full-stack application template for Visomi projects. It combines an Nx monorepo, Angular SSR, Astro, Node runtimes, PostgreSQL, Redis, passkey-first authentication, zero-knowledge product storage, and Themis-powered delivery workflows.

## Included

- `apps/web/site`: public Astro website.
- `apps/web/app`: authenticated Angular application.
- `apps/web/api`: Express API with OpenAPI contracts.
- `apps/web/server`: unified gateway for site, app, API, realtime, and worker runtimes.
- `apps/web/realtime`: Socket.IO runtime.
- `apps/worker`: BullMQ worker runtime.
- `apps/cli`: example CLI for distributing `.opencode` resources.
- `libs/shared`: database, sessions, environment, transport, crypto, and runtime primitives.
- `libs/projects`: shared project contracts and Themis integration seams.
- `libs/themis-workflow`: local `.themis` workflow state and lifecycle.
- `.opencode`: Themis agents, skills, commands, and tools.

## Architecture

```text
                         +----------------------+
                         |  server / gateway    |
                         +----------+-----------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
       Astro site          Angular app             Express API
              |                     |                     |
              +---------------------+---------------------+
                                    |
                    PostgreSQL + Redis + object storage
                                    |
                 worker + realtime + local vault/agent
```

The gateway exposes the public site at `/`, the Angular app at `/app`, the API at `/api`, and realtime traffic at `/socket.io`.

## Local Development

Install dependencies and start PostgreSQL and Redis:

```bash
pnpm install
podman compose up -d
```

Run the complete gateway:

```bash
pnpm nx run server:serve
```

Run individual surfaces:

```bash
pnpm nx run site:serve
pnpm nx run app:serve
pnpm nx run api:serve
pnpm nx run worker:serve
pnpm nx run realtime:serve
```

## Themis Workflow

The template includes the complete Themis local workflow. Use `.themis` for projects, work items, sprints, runs, evidence, and reviews. Use `.opencode` for the coordinating agents and tools.

State mutations must go through the `themis_*` tools. Do not edit `.themis/state.json` or `.themis/events.ndjson` directly.

```bash
pnpm themis status
pnpm themis portfolio --json
pnpm themis project-list --json
pnpm themis validate
```

Start with the OpenCode workflow command:

```text
/themis-onboard
/themis-workflow
```

## CLI Example

The example CLI validates and installs the resources in `.opencode`:

```bash
pnpm nx run cli:build
pnpm nx run cli:verify
pnpm nx run cli:package
```

The future distributable Themis package can evolve from `apps/cli` without changing the local workflow model.

## Authentication

Authentication is passkey-first and includes:

- WebAuthn registration and sign-in.
- Verified email and PIN gating.
- Explicit password fallback.
- Password recovery.
- Passkey lifecycle management.
- HTTP-only sessions, CSRF protection, rate limiting, and audit boundaries.

## Zero-Knowledge Storage

Product data is encrypted before synchronization. Cloud API, workers, realtime, and gateway runtimes validate and transport opaque envelopes. Local vault and agent boundaries own plaintext and keys. Authentication and minimum routing metadata remain server-operational concerns.

## Verification

```bash
pnpm nx run-many -t lint
pnpm nx run-many -t test
pnpm nx run-many -t build
pnpm nx run cli:verify
pnpm nx e2e app-e2e
pnpm nx e2e api-e2e
pnpm nx e2e server-e2e
pnpm nx e2e site-e2e
```

## License

MIT
