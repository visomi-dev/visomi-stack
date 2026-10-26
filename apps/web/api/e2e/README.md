# API and gateway HTTP checks

Run from the workspace root:

```sh
pnpm nx test web-backend-shared
pnpm nx test web-api
pnpm nx test dev-testing
pnpm nx e2e web-api
pnpm nx e2e web-gateway
pnpm nx run-many -t lint typecheck typecheck-tests -p web-api web-gateway web-backend-shared dev-testing
```

## Compose prerequisites and application selection

Install Docker with Compose v2 or Podman with `podman-compose`, and make the
container engine available to your unprivileged user. The test helper detects
Docker Compose first, then `podman-compose`. To choose explicitly:

```sh
export VISOMI_TEST_COMPOSE=podman-compose
pnpm nx e2e web-api --ui
# Or:
pnpm nx e2e web-gateway --ui
```

No native PostgreSQL or Redis installation is required. The first run downloads
images/dependencies and builds the selected application. With Podman, the wrapper
explicitly awaits the initializer before starting `app`, avoiding provider issues
with one-shot dependency conditions. Initialization failure prevents app startup.

For regular local containers, `APP_NAME` selects the same build and executable:

```sh
APP_NAME=web-api docker compose up --build app
APP_NAME=web-gateway docker compose up --build app
```

Supply `SESSION_SECRET` as described in the development guide. Use `APP_PORT` to
change the published application port; keep `AUTH_ORIGIN` consistent with it.
Use separate Compose project names when running both applications concurrently.

## Local UI mode on Arch Linux

The API suites use HTTP request fixtures and need no browser for a normal run.
Playwright's `--ui` mode needs its bundled Chromium to display the test runner.
Arch Linux is outside Playwright's officially supported Linux distributions;
`install-deps` and `install --with-deps` use `apt-get` and do not work with
Arch's `pacman`.

Install system prerequisites with Arch's package manager if they are missing.
The `chromium` package supplies the browser's system libraries; Playwright still
uses its own versioned browser binary:

```sh
sudo pacman -S --needed chromium
pnpm exec playwright install chromium --no-shell --no-remove
```

Only Chromium is needed for this UI; Firefox and WebKit are not prerequisites.
The installer may warn that it is using an Ubuntu fallback build on Arch.
Do not bypass dependency validation; an actual browser launch must still work.

```sh
pnpm nx e2e web-api --ui
```

Run this from a graphical desktop session. For a terminal-only run, omit `--ui`.

## Suite ownership

| Suite                                                        | Ownership                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared colocated `lib/observability/lib/*.spec.ts`           | Capture policy, runtime reuse, detached callbacks, async context, jobs, metrics, completion guards, shutdown and cleanup failures                                              |
| Shared colocated `middleware/http.spec.ts`                   | HTTP adapter ownership, status classification, completion listeners and controlled error handling                                                                              |
| API colocated `src/auth/*.spec.ts`                           | Auth configuration, session adapter, Passport initialization, security guards, capability options/session binding, router validation and delegation, and HTTP error boundaries |
| API `tests/integration/auth-persistence.integration.spec.ts` | Real PostgreSQL migrations/constraints/transactions, cryptographic verification, challenge replay, independent counter races, owner-scoped revocation and rate-limit sharing   |
| API colocated `src/*.spec.ts`                                | App composition and executable startup/drain/deadline behavior; unit tests mock process and socket boundaries                                                                  |
| API `tests/integration/observability.integration.spec.ts`    | Real Express HTTP boundaries, detached contexts, aborts, induced 500 errors and sensitive input; failed cleanup in an isolated process                                         |
| API `tests/integration/compiled.integration.spec.ts`         | Compiled import/package boundary, standalone signal handling and serialized job context across a real child process                                                            |
| API `e2e/*.e2e.spec.ts`                                      | Running API HTTP lifecycle, correlation, privacy and local exporter delivery during shutdown                                                                                   |

Shared `src/lib/http/*.spec.ts` own HTTP error classes, cross-bundle recognition,
public response serialization and the Helmet policy. API/gateway composition
units cover independent managed/inherited ownership. `http-security.e2e.spec.ts`
checks real response headers on successes and failures and controlled 401/403s.
The inherited parent fixture installs Helmet and the common handler itself,
preserving a distinct host CSP across the compiled API boundary. Gateway process
integration verifies the same delegation between the actual ESM/CJS artifacts.

Each project owns its application-specific Playwright dependencies under its
own `e2e/` directory:

- `apps/web/api/e2e/fixtures/http.ts`: composes the shared telemetry fixture
  with an owned database pool and auth rate-limit isolation.
- `apps/web/gateway/e2e/fixtures/http.ts`: composes the shared telemetry fixture
  with rate-limit isolation for authentication through the mounted API.
- Each project's `e2e/support/` selects its Compose application, isolated auth
  database access and minimal preload restricted to that application's process.

Dependencies currently used by both projects live in `libs/development/testing`:

- `@visomi-stack/dev-testing/playwright`: lazy telemetry fixture, `expect` and
  shared Compose startup/teardown and owned PostgreSQL resources.
- `@visomi-stack/dev-testing/telemetry`: telemetry reader and local exporters.
- `@visomi-stack/dev-testing/postgres`: runner-independent owned PostgreSQL helpers.
- `@visomi-stack/dev-testing`: PostgreSQL and software-authenticator helpers without
  importing Playwright.

Specs keep using Playwright's request fixture. The telemetry fixture binds the
run's destination and can read a separate destination for the compiled shutdown
scenario. The database fixture closes only the pool it creates. Neither fixture
initializes telemetry or starts another server. The preload runs in the owning
server process and initializes observability with the shared test exporters.
Container PIDs are never used to signal host processes. `webServer` owns the
Compose wrapper; only the separate host shutdown fixture writes a host PID marker.

Gateway `e2e/http.e2e.spec.ts`, `authentication.e2e.spec.ts` and
`telemetry.e2e.spec.ts` exercise the running gateway through Playwright's request
fixture. They verify mounted success/failure headers, controlled 400/401/403s,
real ES256 signup/sign-in, cookie rotation, logout revocation, concurrent
correlation and exactly-once completion/spans across the host/API layers.
Telemetry is delivered to owned local files; no collector or external service is
contacted. The unit and compiled-process suites remain distinct from these E2E checks.

Playwright starts a dedicated Compose project for each run using `compose.yaml`
and `compose.test.yaml`. The wrapper selects `APP_NAME=web-api` or `web-gateway`, builds
that application with Nx inside the image, runs the explicit database initializer,
and starts its compiled `main.js`. API binds loopback port 3307; gateway binds
3317 and uses `/api/` for readiness. The gateway root intentionally remains 404.
The gateway build also produces the compiled API it imports as a sibling artifact.
There is no Nx serve watcher or native PostgreSQL server in this E2E startup.

Every run owns its project name, PostgreSQL volume, network, synthetic credentials,
and ignored `tmp/api-e2e/run-*` or `gateway-run-*` directory. PostgreSQL is published
on an automatically assigned loopback port for fixture queries. The empty explicit
Compose env file and controlled settings prevent use of developer database
configuration. Teardown removes only that test project's containers and volumes;
telemetry and manifests remain for local inspection. Redis and MinIO are available
in the base Compose but are not started because these suites have no consumer for them.

The test-only image retains tooling for the local telemetry preload. The regular
`runtime` target installs production dependencies and excludes the preload/tooling.
Both execute the compiled application; only the owning entrypoint initializes
resources. Telemetry files are mounted into the test container, with browser
tracing disabled and no external collector. The metric exporter projects public
SDK resource attributes rather than serializing SDK-private resource fields.

The inherited parent-Express scenarios and standalone shutdown scenario retain
their dedicated host process fixtures and compiled-module checks. They connect
to the same owned Compose PostgreSQL, without native PostgreSQL binaries. The Nx
host build remains necessary for those compiled fixture imports. Nx's existing
report/output locations remain unchanged.

The shutdown check holds a local span export until shutdown and uses delayed local metric exports and the existing runtime's one-second flush budget and executable's five-second deadline. It verifies delivery across a real process/filesystem boundary and verifies that the owned PostgreSQL connections disappear when the standalone process exits. It does not verify OTLP, network collectors or external services. The compiled build is also checked for import safety without enabling telemetry or opening ports.

The API exposes a greeting, passkey authentication and credential/session routes, and a 404 response. Authentication scenarios verify real ES256 signatures, cookies, CSRF, replay/expiry, ownership, sanitized SQL rejection, and a real inherited Express host. PostgreSQL setup uses only an owned Compose project; see the [API guide](../README.md). Induced 500-error privacy, internal async work and job trace relationships remain unit/integration checks. There is no running worker, realtime service or queue path to exercise end to end. The child-process carrier check verifies serialization and reconstruction, not queue delivery or a production worker.

Passkey unit tests stub option generation and the narrow persistence boundary;
router unit tests dispatch through the router without opening a listener and stub
the passkey capability and rate limiter. These tests establish decisions and
delegation, not persistence or cryptographic correctness. Real PostgreSQL and
SimpleWebAuthn verification cover wrong user handles, revoked credentials,
counter regression, inconsistent backup flags and independent challenge races in
integration.

Unit tests remain beside the module they test. `dev-testing:test` owns the shared
helper regressions, including cryptographically valid authenticator responses,
PostgreSQL ownership/failure paths, fixtures, telemetry and teardown. Its coverage
gate includes `src/`, where exported helpers live under `lib/`; re-export barrels do not get artificial
tests. Playwright discovers only each application's `e2e/*.e2e.spec.ts`, while
application Vitest suites include their `src/` and `tests/`. They never discover
the Playwright suites. The source aliases resolve through the configured test
tsconfig, including the server preload. Nx detects the library dependency for
affected and cached checks. Production builds retain their explicit
application entrypoints and exclude all test dependencies. Type-only files,
barrels and static configuration do not receive artificial unit suites; fixture,
bootstrap and owned-process cleanup wiring is exercised through the real E2E runs.
