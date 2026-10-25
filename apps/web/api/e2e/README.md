# Observability checks

Run from the workspace root:

```sh
pnpm nx test web-backend-shared
pnpm nx test web-api
pnpm nx e2e web-api
pnpm nx run-many -t lint typecheck typecheck-tests -p web-api web-backend-shared
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

The existing Playwright configuration uses a test-only wrapper to start isolated PostgreSQL and then `pnpm nx serve web-api` on loopback port 3307. It never reuses an unrelated server. Request fixtures need no browser. A test-only preload explicitly supplies local file exporters; the application entrypoint still performs shutdown. Teardown closes the owned watcher, application and recorded PostgreSQL cluster. The cluster has an ownership marker and a separate manifest, so cleanup does not depend on the serve wrapper surviving. Each run gets an isolated ignored directory under `tmp/api-e2e/run-*` from the repository root, containing its telemetry, manifests and temporary PostgreSQL cluster. Teardown removes the owned cluster and retains telemetry for inspection. The shutdown scenario owns a separate compiled process and destination under Playwright's configured test output; Nx's report/output locations remain unchanged.

The shutdown check holds a local span export until shutdown and uses delayed local metric exports and the existing runtime's one-second flush budget and executable's five-second deadline. It verifies delivery across a real process/filesystem boundary and verifies that the owned PostgreSQL connections disappear when the standalone process exits. It does not verify OTLP, network collectors or external services. The compiled build is also checked for import safety without enabling telemetry or opening ports.

The API exposes a greeting, passkey authentication and credential/session routes, and a 404 response. Authentication scenarios verify real ES256 signatures, cookies, CSRF, replay/expiry, ownership, sanitized SQL rejection, and a real inherited Express host. PostgreSQL setup uses only an owned cluster; see the [API guide](../README.md). Induced 500-error privacy, internal async work and job trace relationships remain unit/integration checks. There is no running worker, realtime service or queue path to exercise end to end. The child-process carrier check verifies serialization and reconstruction, not queue delivery or a production worker.

Passkey unit tests stub option generation and the narrow persistence boundary;
router unit tests dispatch through the router without opening a listener and stub
the passkey capability and rate limiter. These tests establish decisions and
delegation, not persistence or cryptographic correctness. Real PostgreSQL and
SimpleWebAuthn verification cover wrong user handles, revoked credentials,
counter regression, inconsistent backup flags and independent challenge races in
integration.

Vitest includes only `src/` and `tests/` and explicitly excludes `e2e/`. Test type checking includes both runners. Production builds retain their existing test exclusions and explicit application entrypoints. Type-only files, re-export barrels, static configuration and test harness helpers do not receive artificial unit suites.
