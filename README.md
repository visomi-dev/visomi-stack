<!-- visomi-template-readme -->

# Visomi Stack

A reusable Nx application template with Angular SSR, an Astro public site, an Express API, PostgreSQL, Redis, passkey-first authentication, workers, and realtime delivery.

## Start a new project

Create a repository from this template, or clone it into a new working directory. The supported development environment is Linux, macOS, or Windows through WSL2, with [fnm](https://github.com/Schniz/fnm) and Docker Compose or Podman Compose installed.

```sh
fnm install
fnm use
export NX_DAEMON=false
corepack enable
pnpm install --frozen-lockfile
pnpm template:init --name "My App" --slug my-app --organization "My Team" --demo
docker compose up -d
pnpm db:migrate
export NX_DAEMON=false
pnpm template:doctor
pnpm nx run server:serve
```

For Podman, replace `docker compose` with `podman compose`. Open <http://localhost:8080/> and <http://localhost:8080/app/en/auth/sign-up>.

`--demo` explicitly enables the existing local fixture APIs, including the in-memory email mailbox, on a loopback-bound development server. Without it, configure Mailgun to receive verification messages. Production rejects enabled test APIs. See the [first-account walkthrough](docs/template/getting-started.md#complete-your-first-sign-in).

Initialization updates only `template.json`, the root package name, this README, and a new private `.env`. It preserves internal package identities, migration history, Themis state, and existing environment files. Repeating the same initialization does not rotate secrets. Use `--dry-run` or `--help` to inspect the contract.

## Template commands

```sh
export NX_DAEMON=false
pnpm template:init --help
pnpm template:doctor --offline
pnpm template:doctor --running --json
export NX_DAEMON=false
pnpm nx run template:test
pnpm template:smoke
```

The smoke command exports a clean copy without dependencies, caches, generated output, or local secrets; installs from the lockfile; initializes it as **Smoke App**; applies migrations; builds; and exercises signup and sign-in through the real gateway. It provisions disposable PostgreSQL/Redis containers and cleans them up. Explicit `--memory` mode uses PGlite and a local `redis-server` instead; it does not claim PostgreSQL coverage.

## Guides

- [Getting started and troubleshooting](docs/template/getting-started.md)
- [Local and production configuration](docs/template/configuration.md)
- [Architecture and optional Themis integration](docs/template/architecture.md)
- [Versioning and updates for derived projects](docs/template/maintenance.md)
- [Implementation and verification tracking](plan/feature-template-readiness-1.md)

## Included runtimes

| Path                                | Responsibility                                                            |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `apps/web/site`                     | Astro public website at `/`.                                              |
| `apps/web/app`                      | Angular authenticated application at `/app`.                              |
| `apps/web/api`                      | Express API and OpenAPI contracts at `/api`.                              |
| `apps/web/server`                   | Unified gateway and runtime composition.                                  |
| `apps/web/realtime`                 | Socket.IO at `/socket.io`.                                                |
| `apps/worker`                       | BullMQ background work.                                                   |
| `libs/backend/shared`               | Backend runtime configuration, database, sessions, transport, and crypto. |
| `libs/frontend/shared`              | Framework-agnostic browser vault, IndexedDB, and WebAuthn PRF utilities.  |
| `libs/shared/crypto`                | Portable encrypted-envelope contracts and client synchronization.         |
| `libs/projects`                     | Example project-domain contracts.                                         |
| `libs/themis-workflow`, `.opencode` | Optional repository-local planning and delivery workflow.                 |
| `scripts/template`                  | Initialization, diagnostics, and clean-copy verification.                 |
| `apps/cli`                          | Example distribution CLI for OpenCode resources.                          |

The template contains sample product/domain content and zero-knowledge storage integration seams. Those examples are documented separately from the template bootstrap; enabling production protected-storage behavior requires its actual object-store and local-agent configuration.

## Toolchain and verification

Runtime/API E2E targets require Redis. Start the local Compose services first, or supply an isolated `REDIS_URL` for verification. Routing unit tests use isolated dependencies.

Node is pinned by `.node-version`; pnpm is pinned by `packageManager`. CI and Docker use the same versions. Run `fnm use` before Node-based commands and export `NX_DAEMON=false` before every shell invocation containing Nx or its scripts.

```sh
export NX_DAEMON=false
pnpm nx run template:test
pnpm nx run template:typecheck
pnpm nx run app:vite:test
pnpm nx run api:test
pnpm nx run server:build:production
pnpm nx run app-e2e:e2e
pnpm nx run api-e2e:e2e
```

The workspace intentionally uses Nx's side-by-side TypeScript setup: `@typescript/native` provides the TypeScript 7 CLI, while `typescript` aliases the TypeScript 6 compiler API required by Angular/Nx integrations. Keep Nx plugins aligned and update shared runtime package dependencies together. See [maintenance](docs/template/maintenance.md).

CI runs critical authentication E2E and clean-copy PostgreSQL smoke verification on pull requests. Scheduled/manual runs additionally exercise the complete browser and durable API suites. Tests requiring real Google authorization or physical/synced passkey providers remain a separate acceptance matrix.

## License

[MIT](LICENSE). Preserve the upstream license when creating derived projects.
