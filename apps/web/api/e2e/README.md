# Observability checks

Run from the workspace root:

```sh
pnpm nx test web-backend-shared
pnpm nx test web-api
pnpm nx e2e web-api
pnpm nx run-many -t lint typecheck typecheck-tests -p web-api web-backend-shared
```

| Suite                                                     | Ownership                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shared colocated `lib/observability/lib/*.spec.ts`        | Capture policy, runtime reuse, detached callbacks, async context, jobs, metrics, completion guards, shutdown and cleanup failures      |
| Shared colocated `middleware/http.spec.ts`                | HTTP adapter ownership, status classification, completion listeners and controlled error handling                                      |
| API colocated `src/*.spec.ts`                             | App composition and executable startup/drain/deadline behavior; unit tests mock process and socket boundaries                          |
| API `tests/integration/observability.integration.spec.ts` | Real Express HTTP boundaries, detached contexts, aborts, induced 500 errors and sensitive input; failed cleanup in an isolated process |
| API `tests/integration/compiled.integration.spec.ts`      | Compiled import/package boundary, standalone signal handling and serialized job context across a real child process                    |
| API `e2e/*.e2e.spec.ts`                                   | Running API HTTP lifecycle, correlation, privacy and local exporter delivery during shutdown                                           |

The existing Playwright configuration starts `pnpm nx serve web-api` on loopback port 3307. It never reuses an unrelated server. Request fixtures need no browser. A test-only preload explicitly supplies local file exporters; the application entrypoint still performs shutdown. Teardown closes the owned watcher and application. Each run gets an isolated ignored directory under `tmp/api-e2e-*`; the shutdown scenario owns a separate compiled process and destination under Playwright's test output.

The shutdown check holds a local span export until shutdown and uses delayed local metric exports and the existing runtime's one-second flush budget and executable's five-second deadline. It verifies delivery across a real process/filesystem boundary. It does not verify OTLP, network collectors or external services. The compiled build is also checked for import safety without enabling telemetry or opening ports.

The API currently exposes a greeting and a 404 response. Induced 500-error privacy, internal async work and job trace relationships remain unit/integration checks. There is no running worker, realtime service or queue path to exercise end to end. The child-process carrier check verifies serialization and reconstruction, not queue delivery or a production worker.

Vitest includes only `src/` and `tests/` and explicitly excludes `e2e/`. Test type checking includes both runners. Production builds retain their existing test exclusions and explicit application entrypoints. Type-only files, re-export barrels, static configuration and test harness helpers do not receive artificial unit suites.
