# Development

Work from the current Visomi Stack repository root. The previous stack and Nive
are references; commands and completion claims from those repositories must be
checked against this workspace before reuse.

## Toolchain and project discovery

Use `.node-version` for Node, `package.json#devEngines` for runtime and package
manager requirements, `package.json` for declared dependencies, and `pnpm-lock.yaml`
for resolved versions. See the [README](../README.md#local-development) for setup.

Run Nx through pnpm. Inspect the resolved project configuration, including targets
inferred by plugins, before choosing commands:

```sh
NX_DAEMON=false pnpm nx show projects --json
NX_DAEMON=false pnpm nx show project web-api --json
```

The web applications are `web-api`, `web-gateway`, `web-app`, and `web-site`, with
supporting libraries and test projects listed by `nx show projects`. Use these
Nx project names rather than the legacy name `api` or directory names such as
`app` and `site`.
Template initialization, doctor and smoke scripts from the previous stack are not
available here. Check command help before using unfamiliar
flags. Agents should follow the Nx skill guidance in [AGENTS.md](../AGENTS.md).

Drizzle configuration lives at `libs/backend/shared/drizzle.config.ts`, alongside
`src/`. Domain schemas and migrations live in
`libs/backend/shared/src/lib/database/`. Use the shared project's explicit
commands from the workspace root:

```sh
pnpm nx run backend-shared:db-generate -- --name describe-schema-change
DATABASE_URL=postgresql://localhost/visomi_stack_dev pnpm nx run backend-shared:db-migrate
```

The example database must be created separately. Do not use a developer database
for tests: the API integration and E2E suites create isolated PostgreSQL clusters
and apply this same shared migration history. Application imports and startup do
not run migrations. See the [API guide](../apps/web/api/README.md) for configuration
and resource ownership.

## Local agent tooling

Run these steps on each new checkout created from the stack template. Use the
Node and pnpm versions described above. Install the workspace dependencies with
`pnpm install --frozen-lockfile` and run the remaining commands from the repo root.

1. Make the Codegraph and Context7 CLIs available on the host's PATH. Skip the
   install if both commands are already available.

   ```sh
   pnpm add -g @colbymchenry/codegraph@1.6.2 ctx7@0.10.0
   ```

2. Build the source and Markdown indexes for this checkout. Codegraph reads
   `codegraph.json` and QMD reads `.qmd/index.yml`.

   ```sh
   CODEGRAPH_TELEMETRY=0 codegraph init --yes
   pnpm --config.ignore-scripts=true dlx @tobilu/qmd@2.8.3 update
   ```

   Use `CODEGRAPH_TELEMETRY=0 codegraph index` after changing Codegraph's coverage.
   Rerun QMD's `update` after Markdown changes. The generated indexes are local
   to each checkout and ignored by Git.

3. Open the repo root as a trusted Codex project and start a new session. Codex
   loads the local Nx, Angular CLI, Codegraph, and QMD MCP servers from
   `.codex/config.toml`. Run `codex mcp list` from the repo root to inspect the
   configuration. QMD uses lexical search over the `visomi-docs` collection.

The bundled `find-docs` skill uses `ctx7` for public third-party documentation.
Send only public technology names and questions to Context7. See
[AGENTS.md](../AGENTS.md#code-and-documentation-lookup) for the QMD MCP and CLI
search workflow.

## Gateway development

```sh
pnpm nx serve web-gateway
pnpm nx build web-gateway
```

Serving watches the gateway source and builds its application dependencies first.
The gateway mounts the compiled API at `/api`, the Angular SSR application under
`/app`, and the Astro website at `/`. The website root redirects to `/en/`; localized
pages are available at `/en/` and `/es/`. Angular entry routes are `/app/en/` and
`/app/es/`. Rebuild a mounted application after changing its source, then restart
the gateway to load the new artifact.

Nx supplies `API_APP_PATH`, `SITE_APP_PATH`, and `APPLICATION_APP_PATH` for
source-mode serving. Compiled startup defaults to sibling artifacts
`../api/app.js`, `../site/server/entry.mjs`, and `../app/server/server.mjs`,
independent of the working directory. Explicit overrides must point to these
compiled application exports; relative overrides resolve from the working directory.

The gateway emits ESM with matching package metadata; the API retains CommonJS.
Deploy all four complete output directories as siblings with their runtime
dependencies. `node dist/apps/web/gateway/main.js` owns the public listener.
Importing either `app.js` only exposes a factory, without listening, connecting
to PostgreSQL or initializing telemetry. The gateway uses the API's existing
database/auth environment settings, with `AUTH_ORIGIN` matching its public origin.
It installs one auth chain in the host and uses inherited mode for the mounted API.
Its shutdown uses the same three-second HTTP drain, one-second telemetry flush
budget and five-second total deadline as the standalone API.

The container runtime defaults to `web-gateway`. Its build includes the API,
Angular application, and Astro website, and the runtime starts the gateway's
`main.js` with all four compiled outputs. Set `APP_NAME=web-api` only when running
the standalone API, which serves its greeting at `/`. Set `APP_PORT` to change the
published port and align `AUTH_ORIGIN` with that public URL. Worker and realtime
applications remain unimplemented.

## Template formatting and editor linting

HTML, Angular templates and Astro use the local `workspace/template-sibling-newlines`
ESLint rule to separate sibling elements and control-flow blocks already written
on different lines. Inline text, comments and literal content in `pre`, `code`,
`textarea`, `script` and `style` retain their spacing. Prettier preserves the
inserted blank lines. `lint-staged` runs Prettier followed by ESLint fixes for both
HTML and Astro; the workspace editor settings enable formatting and ESLint fixes
on explicit save. Nx lint tasks enforce the same rule.

The editor selects the local ESLint configuration for each project. After shared
ESM lint configuration changes, use **ESLint: Restart ESLint Server** if diagnostics
still reflect an older configuration. `toSignal`, `signal` and `linkedSignal` belong
to the same Angular state group, before computed properties. Configuration tests
verify this ordering from both the workspace root and the application directory.

## Integrated live reload

The `pnpm dev` launcher serves the same website, Angular SSR application and
API together on `http://localhost:8080`. It uses one source-watching supervisor,
short-lived Nx builds with a concurrency of one, and a compiled gateway child
process. Angular and Astro watch servers and the Nx daemon are not started by
the supervisor. The direct launcher also avoids a long-running Nx task retaining
build output in memory. The optional `web-gateway:dev` target runs the same
supervisor under Nx. Nx's cache reuses unaffected builds. This is full browser reload,
not component HMR; both English and Spanish production-localized outputs are
built so the mounted runtime remains the same as the container runtime.

The supervisor owns the public port and injects an external, same-origin reload
client into HTML. The compiled gateway listens on a private loopback port, owns
authentication and SSR session context, and receives the original cookies and
Host header. The development client uses a local event stream, without external
telemetry. Production startup does not include this proxy or reload client.

While rebuilding, the public server returns a temporary 503 building page. It
uses the shared UI recipes, Tailwind theme and locally served fonts, with
English/Spanish copy and the saved or system light/dark preference. Its HTML and
CSS are prepared once at supervisor startup in a short-lived compiler process;
they require neither application build output nor additional watchers. Restart
the supervisor after editing this screen or its shared design recipes.

The supervisor starts a new gateway and reloads connected browsers only after a successful
build and API readiness check. Compilation or startup failures remain visible in
the terminal; editing a source file retries the build. Changes arriving during a
build are batched for the next build. Stopping the supervisor closes its source
watchers, event streams, build process group, and gateway.

### Gateway on the host

Use Node and pnpm from this workspace. Keep a private root `.env` with a unique
`SESSION_SECRET`; `.env.example` documents the local defaults. The supervisor
loads `.env` without overriding existing process variables. It defaults the
database connection to the published local PostgreSQL port and the credentials
used by Compose; set `DATABASE_URL` explicitly for a native or different database.
An explicitly empty `DATABASE_URL` allows a preview with authentication disabled.

If a Compose application is running, stop it to release the public port. Start
only dependencies and apply migrations when needed:

```sh
podman compose stop app
podman compose up -d postgres redis minio minio-init
podman compose run --rm database-init
pnpm dev
```

With PostgreSQL already available locally and its schema migrated, only the last
command is needed; Podman is optional. `APP_PORT` (or `PORT`) changes the public
port. Keep `AUTH_ORIGIN` aligned with that port. Stop development with Ctrl+C.
The existing `serve` targets remain available for working on one application.

### Gateway inside Podman

Stop a host development process first, then use the explicit development overlay:

```sh
podman compose -f compose.yaml -f compose.dev.yaml up -d --build
podman compose -f compose.yaml -f compose.dev.yaml logs -f app
```

The same supervisor runs inside the development image. The checkout is
bind-mounted as a directory, including atomic editor saves, while `node_modules`,
compiled output, temporary files and Nx workspace data use separate development
volumes inside the container. Host edits trigger a build, gateway restart and
browser reload without rebuilding the image. The
application's database URL continues to use container DNS `postgres:5432`.

Use one gateway development mode per checkout at a time and release its public
port before switching. Source, templates, styles, public assets, project
configuration and shared library changes
are watched; generated outputs, dependencies, tests and private environment files
are excluded. Restart the supervisor after changing `.env`, the supervisor itself,
or adding a new project/source subtree. After changing dependencies, run
`pnpm install --frozen-lockfile` on the host, or update the isolated container
dependencies with
`podman compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps app pnpm install --frozen-lockfile`
and restart the development service. The development volumes are disposable
build state and are separate from the PostgreSQL and MinIO data volumes.

To return to the ordinary container runtime:

```sh
podman compose up -d --build app
```

The source-watching setup reduces persistent compiler processes; it does not cap
the memory needed for a build. Measure actual memory use before setting limits.
Check the development controller with `pnpm nx run web-gateway:development-check`.

## Container database initialization

The Dockerfile has separate `database-init` and `runtime` targets. The former
includes the workspace tooling and shared database migrations; the latter runs
the selected compiled API or gateway with production dependencies. Neither image runs
migrations at build time. The API entrypoint does not run migrations or seeds.

Provide a high-entropy `SESSION_SECRET` of at least 32 bytes in your environment,
or in a root `.env` file (ignored by Git). Keep that file private, for example
with `chmod 600 .env`. Then run:

```sh
docker compose up --build app
```

Compose starts PostgreSQL, waits for its health check, then runs the one-shot
`database-init` service. It executes `pnpm nx run backend-shared:db-migrate` and
exits. `app` requires `service_completed_successfully`; a failed migration blocks
its startup. Redis and MinIO remain available as separate services but are not
dependencies of the current API. Use `up app` for this slice; starting every
service also includes those legacy integrations.

Use Docker Compose with support for these dependency conditions. `podman-compose`
providers, including 1.6.0, can fail to start the application after the one-shot
dependency exits because of their native container dependency graph. Docker Compose
v2 can use the host's Podman API socket instead; this is a local provider limitation,
not a reason to move initialization into the API.

With that socket and Docker Compose v2 available, run:

```sh
DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock" docker-compose up --build app
```

Alternatively, let `podman compose` configure the connection to that socket:

```sh
PODMAN_COMPOSE_PROVIDER="$(command -v docker-compose)" podman compose up -d --build app
```

To make this provider selection persistent, set `compose_providers` under
`[engine]` in `~/.config/containers/containers.conf` to the absolute path returned
by `command -v docker-compose`. Check `podman compose version` as well as
`podman-compose --version`: an explicit provider path overrides `PATH` and can
keep selecting an older distribution package. When changing providers for an
existing project, run `podman-compose down` with the old provider first, without
`--volumes`, so the new provider can recreate the containers and network with its
own labels while retaining the database and storage volumes.

Both services use the same database URL, with container DNS `postgres:5432`.
The default URL is composed from the same `POSTGRES_USER`, `POSTGRES_PASSWORD`
and `POSTGRES_DB` values as PostgreSQL. Set `APP_DATABASE_URL` when credentials
need URL encoding or when using a different connection target. Both services
receive the same URL. Podman Compose 1.3 does not interpolate nested or empty defaults correctly and
its `port` command fails for dynamically allocated host ports. Use Docker Compose
v2 or Podman Compose 1.6.0 for the isolated test fixtures. To install the latter
for the current user without replacing distribution packages:

```sh
uv tool install podman-compose==1.6.0
podman-compose --version
```

Ensure `~/.local/bin` precedes `/usr/bin` in `PATH`. This updates the Compose
provider independently of the Podman engine; it does not upgrade the engine or
restart unrelated containers.

The API defaults to `AUTH_ORIGIN=http://localhost:8080` and `AUTH_RP_ID=localhost`
for this local setup; override both together when needed. Compose supplies only
the declared settings to the API and does not require an `env_file`.

Migration generation stays a development action through `backend-shared:db-generate`;
the initializer only applies the versioned SQL already in the image. There are no
required seeds for the current authentication schema: users are created only
after successful passkey registration. No default identities, credentials or test
fixtures are inserted. If a capability later needs reference data, its idempotent
seed belongs in this explicit initialization workflow after migrations, with a
failure preventing application startup.

To apply pending migrations explicitly against an existing local database:

```sh
docker compose build database-init
docker compose run --rm database-init
```

Migration history makes successful reruns safe. Restarting the API alone does not
apply new migrations; rebuilding the initializer and running it is an explicit
step when schema changes. Coordinate schema changes with existing application
instances: the startup dependency does not stop an already running API. Do not
delete volumes to rerun initialization or point test runs at developer data.

## Compose-backed tests

`pnpm nx e2e web-api` and `pnpm nx e2e web-gateway` build and run the selected
compiled application through `compose.yaml` plus `compose.test.yaml`. Playwright
and its optional `--ui` stay on the host. Test PostgreSQL uses the same image as
local Compose, with an independent project, volume, credentials and random
loopback database port for each run. Native PostgreSQL and Redis are unnecessary.
The tests do not start Redis or MinIO because neither application consumes them.

Docker Compose is detected first, falling back to `podman-compose`; select a
provider with `VISOMI_TEST_COMPOSE=docker|podman-compose`. The E2E wrapper explicitly
builds both required images, runs the one-shot initializer, checks its exit, and
starts only the selected app. This also works with providers that mishandle
`service_completed_successfully`. Cleanup removes only the recorded test project
and its volumes and retains local telemetry. See the [E2E guide](../apps/web/api/e2e/README.md)
for browser setup on Arch and fixture boundaries.

## Verification

Choose checks relevant to the change and report the command, result, and any
remaining limitation. Focused checks for the API boundary and shared infrastructure are:

```sh
NX_DAEMON=false pnpm nx run-many -t lint typecheck typecheck-tests test build -p web-api web-gateway web-backend-shared backend-shared dev-testing
pnpm nx e2e web-api
pnpm nx e2e web-gateway
```

Every project's Vitest suite collects V8 coverage by default and requires 100%
statements, branches, functions and lines **per source file**. Each project includes
`src/**/*.ts`, including the exported helpers in the development testing library.
Modules not imported by tests are included; only test files
and type declarations are excluded. Reports are written to `coverage/<project-root>`
as HTML, JSON and LCOV. Unit and integration tests contribute to this source
coverage. Playwright E2E checks and compiled child processes verify their real
boundaries separately and do not contribute source coverage to these reports.
SQL migrations are verified against isolated PostgreSQL, not instrumented by V8.
`test-ci` delegates to the complete project `test` target, including its build
dependencies. Individual Nx test atoms are disabled: a single spec cannot satisfy
the project-wide include pattern and per-file coverage gate on its own.

`web-api:test` depends on its build so the import and startup tests exercise the
actual emitted application. These tests cover side-effect-free CommonJS imports
under an ESM parent and standalone startup/shutdown. Colocated shared unit tests verify policy, runtime lifecycle, context isolation,
job correlation, and adapter completion ownership. API integration tests exercise
real HTTP listeners and local in-memory OpenTelemetry sinks. Playwright request
tests run the compiled API in Compose and inspect telemetry exported to isolated local
files, including delivery during standalone shutdown. See the
[observability test guide](../apps/web/api/e2e/README.md) for suite ownership and commands.
Gateway colocated units cover composition, compiled-module validation and startup
ownership. Its `tests/integration/compiled.integration.spec.ts` starts the compiled
ESM executable, imports the sibling API, and verifies real HTTP, PostgreSQL-backed
passkey sessions, single telemetry completion and owned-pool cleanup. It reuses
runner-independent helpers from `@visomi-stack/dev-testing`; no production API source is imported. Its isolated
cluster and temporary files live under `tmp/api-e2e/gateway-*` and are removed
afterward. These are Vitest process integration checks. Both projects also own
Playwright request suites in their existing `e2e/` directories. The gateway suite
runs the compiled gateway in Compose, mounts the compiled API, and verifies inherited
authentication/errors, Helmet, correlation and privacy through local file exports.
Each project owns its Playwright fixture composition in `e2e/fixtures/http.ts`
and its Compose app selection, authentication database access and minimal telemetry
preload in `e2e/support/`. These files live under `apps/web/api/` or
`apps/web/gateway/`; neither project imports the other project's test files.
Shared support lives in `libs/development/testing`, an internal source library
exposed as `@visomi-stack/dev-testing`. Its `/playwright` entry exports the shared
telemetry fixture, Compose server lifecycle and teardown; `/telemetry` exports the reader and local exporters;
`/postgres` exports the owned-cluster helpers. The root entry exports PostgreSQL
and software-authenticator helpers without loading Playwright. Exported library
implementation lives in `src/lib/`, with Playwright-specific helpers grouped in
`src/lib/playwright/`. Each application wrapper explicitly selects its own target;
the shared Compose support maps that selection to the test build and loopback port.
Unit tests stay beside each helper and run through `dev-testing:test`, with the
same 100% per-file coverage gate over `src/`. Nx detects the
library dependencies for affected checks; production code cannot import it.
No separate unit-test directory or additional Nx project is introduced.
Neither suite certifies Angular SSR, queue delivery, external collectors or deployment.

For Markdown-only changes, check the touched files and review the diff:

```sh
pnpm exec prettier --check README.md docs/architecture.md docs/development.md
git diff --check
```

When API behavior changes, verify the relevant HTTP behavior. When UI work begins,
verify keyboard access, labels, focus, and responsive states alongside the affected
behavior. Distinguish local fixtures from real infrastructure and provider testing;
historical or unrelated results do not establish current coverage.

## Contribution conventions

- Keep changes small and reviewable. Discuss consequential choices before implementation.
- Write documentation, code, and comments in English. Update documentation when behavior changes.
- Keep feature logic close to its owner. Introduce shared abstractions when there is a concrete need.
- Follow Screaming Architecture with DDD: name feature folders for business domains
  and capabilities, keep domain boundaries explicit, and reserve shared for cross-cutting
  infrastructure. Add aggregates, repositories, interfaces, or layers only when justified.
- Follow the current formatter, linter, and compiler configuration. Propose policy changes explicitly;
  the root TypeScript configuration currently has `strict: false`.
- Prefer focused checks over broad suites unrelated to the change. Document skipped verification.
- Use Conventional Commit messages, enforced by Commitlint.

The Husky pre-commit hook runs lint-staged, which formats staged files and lints
staged code. The commit-message hook runs Commitlint.

The pre-push hook runs the affected unit tests and then E2E for each ref being
pushed, comparing the remote SHA with the local SHA supplied by Git:

```sh
pnpm exec nx affected -t test --base="$base" --head="$local_sha" --nxBail
pnpm exec nx affected -t e2e --base="$base" --head="$local_sha" --nxBail
```

For a new remote ref, the base is its merge base with `origin/main`. Deletions
skip these checks. The comparison includes committed changes being published;
staged, unstaged and untracked edits are excluded from affected-file selection.
Tests execute in the current checkout, so push from the branch being validated
with a clean working tree. Tests enforce the coverage threshold before E2E starts;
any failed step stops the hook and blocks the push. The PostgreSQL integration and
E2E suites use dedicated disposable databases under `tmp/api-e2e`, so the local
PostgreSQL test prerequisites described in the API guide are required.

These hooks contain machine-specific Node paths: pre-commit and pre-push use
24.15.0, while commit-msg still points to 24.14.1. They need a later portability
review; do not describe them as verified on a fresh checkout. The API owns its
Playwright E2E configuration and directory; no separate E2E project is needed.

## Configuration and data hygiene

The current API uses `HOST` and `PORT` from its process environment for networking;
standalone startup validates the port. `NODE_ENV` maps to the controlled labels
`development`, `test`, `production`, or `unknown` for telemetry. It does not load `.env`. PostgreSQL authentication requires `DATABASE_URL`,
`AUTH_ORIGIN`, `AUTH_RP_ID` and `SESSION_SECRET`; migration and trust-proxy settings
are explicit. See the [API guide](../apps/web/api/README.md) for configuration and isolated tests.
Container configuration describes additional variables for integrations that
have not been implemented.

Keep credentials, private environment values, customer data, and reference-project
resource identifiers out of source, documentation, examples, logs, and reports.
The current `.gitignore` does not exclude `.env` files; check ignore rules and
staged paths before creating any private configuration. Public metadata must
contain only values safe to expose to a browser.

When an integration is added, document only its implemented configuration: variable
names, purpose, defaults, validation, and public/private boundary. Use synthetic
examples and report diagnostic field names or safe error codes instead of values.

Use the shared telemetry facade rather than raw logger objects or SDK spans in
feature code. Add operational names and fields deliberately to its allowlist;
never pass request objects, payloads, raw errors, or customer identifiers to a sink.
Keep a job's technical context separate from its payload. External trace context
and baggage are untrusted and are not accepted at the public HTTP boundary.
See [observability ownership and privacy](architecture.md#observability-ownership-and-privacy)
for the current contract and exporter limitations.

## Maintenance

Update Node and pnpm declarations, container references, and any hook or CI references
together. Keep Nx packages compatible and aligned. Review dependency and lockfile
changes as part of the same change; do not regenerate the lockfile merely to make
an installation error disappear.

Validate a frozen install and relevant targets after tooling changes. Container
build and deployment verification remain separate from running the local API.

When persistence and release workflows are introduced, preserve applied migration
history, make environment changes explicit, and verify backup restoration before
relying on it. Initializer reruns, key rotation, destructive database operations,
and deployment are not implicit maintenance steps.

## Web foundations

See [Web foundations](web-foundations.md) for the independent Angular SSR app,
Astro development server, compiled Astro/Express composition, themes and UI checks.

## Authentication frontend

The Angular root now selects the appropriate authentication or private route.
Use `/app/en/foundations` or `/app/es/foundations` for the original UI examples.
Full auth runs through the gateway with its existing PostgreSQL, SMTP, origin and
session configuration; the standalone Angular executable does not own those resources.

Run the browser suite with an owned synthetic database and mailbox:

```sh
pnpm nx e2e web-app-e2e --configuration=auth
```

It includes Chromium virtual passkeys and password/recovery workflows in Firefox
and WebKit. Select the installed Compose provider through `VISOMI_TEST_COMPOSE`
when necessary. No real Google account, customer records or developer database is
used. See the [application guide](../apps/web/app/README.md) for route, SSR and
challenge-restart behavior and the remaining manual device/provider checks.
