# Incremental verification

Ported from Nive commits `671c92d` and `1a5bfb5`, adapted to the template's native
Node TypeScript loader and existing `tools/eslint/` rules. No product code is imported.

Hooks read staged paths after lint-staged autofixes. CI uses base/head from
`nrwl/nx-set-shas`, including changes since the last successful main-branch run.
Nx's dependency graph selects projects and consumers; native related-test filters
only narrow coverage when it is safe.

| Change                                   | Verification                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Documentation outside project inputs     | Changed-file formatting; no project suites                             |
| Project source or test                   | Changed-file lint; Jest/Vitest related tests                           |
| Angular HTML/component styles            | Include the existing companion TypeScript file for unit tests          |
| Shared dependency source                 | Related tests in the owning project; full suites in affected consumers |
| Browser spec only                        | Selected specs with the configured browser matrix                      |
| Browser fixture/helper only              | Playwright changed-test import graph                                   |
| Production UI, backend or shared runtime | Full affected E2E; URL-driven tests have no source import graph        |
| Config, deleted file or unmapped asset   | Full affected unit and E2E suites                                      |
| ESLint rules or dependencies             | Full lint targets in affected projects                                 |

Native bundled Node tests can select edited specs; implementation changes retain
the full suite. Deleted files are retained for Nx dependency analysis and full
unit coverage but are not handed to file-only lint. Renames include both old and
new paths. Ambiguous filenames containing commas or newlines fail closed.
TypeScript companions broaden test discovery only: staged lint/autofixes receive
the exact selected files and do not modify an unstaged companion.

The composed gateway declares project dependencies on API, app, site, worker and
realtime. Task-level build prerequisites alone do not establish affected-project
edges. These project edges make runtime edits select the gateway and its HTTP/E2E
consumers, including the conditional release build in CI.

Failures stop later checks. The runner forces `NX_DAEMON=false`. Commands have a
five-minute deadline, or 25 minutes for E2E. Timeout and SIGINT/SIGTERM terminate
only the command's owned process group, escalating after five seconds. API
integration Jest runs in a separate process with its original config and build
prerequisites, without `--forceExit`. Unsupported filtering retains full coverage.

Load Node with fnm and export `NX_DAEMON=false` before commands, including scripts:

```sh
export NX_DAEMON=false
pnpm exec node --experimental-strip-types scripts/template/checks/affected.ts staged --dry-run
pnpm exec node --experimental-strip-types scripts/template/checks/affected.ts range origin/main HEAD --dry-run
pnpm exec node --experimental-strip-types scripts/template/checks/affected.ts range origin/main HEAD lint test vite:test
pnpm format:check --base=origin/main --head=HEAD
```

`--exclude-e2e` reserves integration projects for the CI job with infrastructure.
Scheduled/manual browser and durable API matrix checks remain full regressions.
Formatting honors Nx/Prettier extensions and ignore rules. For an intentional full
check, use `pnpm nx run-many -t lint test vite:test` and
`pnpm nx format:check --all --sort-root-tsconfig-paths=false`.

Tests execute working-tree content, as before: stage the complete intended change.
See `docs/agents/e2e.md` for gateway prerequisites. Do not bypass failing hooks.
