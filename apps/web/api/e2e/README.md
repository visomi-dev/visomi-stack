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
- Each project's `e2e/support/` owns its Nx serve entrypoint, isolated auth
  database access and minimal preload restricted to that application's process.

Dependencies currently used by both projects live in `libs/development/testing`:

- `@visomi-stack/dev-testing/playwright`: lazy telemetry fixture, `expect` and
  shared teardown of owned watchers, application processes and PostgreSQL clusters.
- `@visomi-stack/dev-testing/telemetry`: telemetry reader and local exporters.
- `@visomi-stack/dev-testing/postgres`: runner-independent owned PostgreSQL helpers.
- `@visomi-stack/dev-testing`: PostgreSQL and software-authenticator helpers without
  importing Playwright.

Specs keep using Playwright's request fixture. The telemetry fixture binds the
run's destination and can read a separate destination for the compiled shutdown
scenario. The database fixture closes only the pool it creates. Neither fixture
initializes telemetry or starts another server. The preload runs in the owning
server process, writes its PID marker, and initializes observability with the
shared test exporters. `webServer` still owns startup through Nx serve.

Gateway `e2e/http.e2e.spec.ts`, `authentication.e2e.spec.ts` and
`telemetry.e2e.spec.ts` exercise the running gateway through Playwright's request
fixture. They verify mounted success/failure headers, controlled 400/401/403s,
real ES256 signup/sign-in, cookie rotation, logout revocation, concurrent
correlation and exactly-once completion/spans across the host/API layers.
Telemetry is delivered to owned local files; no collector or external service is
contacted. The unit and compiled-process suites remain distinct from these E2E checks.

The existing Playwright configuration uses a test-only wrapper to start isolated PostgreSQL and then `pnpm nx serve web-api` on loopback port 3307. It never reuses an unrelated server. Request fixtures need no browser. A test-only preload explicitly supplies local file exporters; the application entrypoint still performs shutdown. Teardown closes the owned watcher, application and recorded PostgreSQL cluster. The cluster has an ownership marker and a separate manifest, so cleanup does not depend on the serve wrapper surviving. Each run gets an isolated ignored directory under `tmp/api-e2e/run-*` from the repository root, containing its telemetry, manifests and temporary PostgreSQL cluster. Teardown removes the owned cluster and retains telemetry for inspection. The shutdown scenario owns a separate compiled process and destination under Playwright's configured test output; Nx's report/output locations remain unchanged.

The gateway's existing configuration selects its own test-only wrapper's
explicit `web-gateway` target on loopback port 3317, with its own PostgreSQL
cluster and `tmp/api-e2e/gateway-run-*` destination. Its readiness path is `/api/`;
the gateway root intentionally remains 404. Only application entrypoints are
instrumented, including the gateway's ESM startup; imports of the compiled API
never initialize another runtime. Both configurations use one API-only Playwright
project and disable browser traces. The file metric exporter projects public SDK
resource attributes rather than serializing SDK-private resource fields.

The shutdown check holds a local span export until shutdown and uses delayed local metric exports and the existing runtime's one-second flush budget and executable's five-second deadline. It verifies delivery across a real process/filesystem boundary and verifies that the owned PostgreSQL connections disappear when the standalone process exits. It does not verify OTLP, network collectors or external services. The compiled build is also checked for import safety without enabling telemetry or opening ports.

The API exposes a greeting, passkey authentication and credential/session routes, and a 404 response. Authentication scenarios verify real ES256 signatures, cookies, CSRF, replay/expiry, ownership, sanitized SQL rejection, and a real inherited Express host. PostgreSQL setup uses only an owned cluster; see the [API guide](../README.md). Induced 500-error privacy, internal async work and job trace relationships remain unit/integration checks. There is no running worker, realtime service or queue path to exercise end to end. The child-process carrier check verifies serialization and reconstruction, not queue delivery or a production worker.

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
gate includes `src/`, `e2e/` and `tests/`; re-export barrels do not get artificial
tests. Playwright discovers only each application's `e2e/*.e2e.spec.ts`, while
application Vitest suites include their `src/` and `tests/`. They never discover
the Playwright suites. The source aliases resolve through the configured test
tsconfig, including the server preload. Nx detects the library dependency for
affected and cached checks. Production builds retain their explicit
application entrypoints and exclude all test dependencies. Type-only files,
barrels and static configuration do not receive artificial unit suites; fixture,
bootstrap and owned-process cleanup wiring is exercised through the real E2E runs.
