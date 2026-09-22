---
goal: Make Visomi Stack reproducible, safely configurable, and verifiable as a newly created application
version: 1.0
date_created: 2026-09-18
last_updated: 2026-09-18
owner: Visomi Stack
status: 'In progress'
tags: [template, bootstrap, developer-experience, ci, documentation]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

The user authorized the reusable-template readiness milestone: consistent toolchain, safe initialization/diagnostics, first-run documentation, clean-copy verification, and critical E2E in CI. The initial worktree already contained the uncommitted authentication UX implementation; it is preserved. No commit, push, PR, release, or deployment is part of this task.

## 1. Requirements & Constraints

- **REQ-001**: Pin Node/pnpm consistently across development, CI, and Docker using the already verified Node 24.14.1 and pnpm 12.4.2.
- **REQ-002**: Initialize explicit public metadata, root package identity, project README, and a private local environment; never perform global replacement or modify internal package identities/migrations/workflow state.
- **REQ-003**: Support dry runs and idempotent reruns without rotating secrets. Refuse existing environments, custom documentation, unsafe inputs, or symlink targets.
- **REQ-004**: Diagnose toolchain, runtime-schema configuration, origins, mail/factors, connectivity, ports, and migration hashes without printing configuration values or mutating services.
- **REQ-005**: Verify a disposable clean copy without copied dependencies/build caches/secrets: frozen install, rename, repeat initialization, migration, build, readiness, signup, and sign-in.
- **REQ-006**: Run critical authentication and PostgreSQL clean-copy smoke in PR CI; run the full browser/durable matrix on schedules/manual dispatch.
- **REQ-007**: Provide a root environment example, first-account walkthrough, configuration reference, architecture/Themis distinction, maintenance/version policy, and MIT license text.
- **SEC-001**: Generate distinct local database/session/TOTP secrets with restrictive `.env` permissions. Doctor errors contain field names, not values.
- **SEC-002**: Demo APIs are explicit and loopback-bound. Production runtime rejects `ENABLE_TEST_API=true`.
- **SEC-003**: Smoke may migrate only its own containers or explicitly supplied disposable `SMOKE_DATABASE_URL`/`SMOKE_REDIS_URL`; never infer permission from ordinary `DATABASE_URL`.
- **CON-001**: Preserve previous authentication changes and version aliases. Use fnm and export `NX_DAEMON=false` before direct/indirect Nx calls.
- **CON-002**: Keep all repository prose/source identifiers in English, with Spanish in existing translation resources. No new agent delegation or remote infrastructure actions.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish reproducible versions and executable tooling conventions.

| Task     | Description                                                                                                                               | Completed | Date       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-001 | Inspect runtime schema, manifests, Compose, Docker, workflows, and existing CLI/generator patterns.                                       | Yes       | 2026-09-18 |
| TASK-002 | Add `.node-version`, `packageManager`, and `engines`; align CI/Docker and copy all internal package manifests before frozen installation. | Yes       | 2026-09-18 |
| TASK-003 | Generate the `template` Nx project through the inspected npm-package generator and define build/test/typecheck/doctor/init/smoke targets. | Yes       | 2026-09-18 |

### Implementation Phase 2

- GOAL-002: Implement safe, useful initialization and read-only diagnostics.

| Task     | Description                                                                                                                                                             | Completed | Date       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-004 | Add validated `template.json`, allowlisted four-file initialization, unique secrets, rollback/locking, dry-run, and idempotence.                                        | Yes       | 2026-09-18 |
| TASK-005 | Parameterize local Compose and add `.env.example`; load local variables for explicit Drizzle migrations.                                                                | Yes       | 2026-09-18 |
| TASK-006 | Extract the existing side-effect-free runtime environment schema and expose a public subpath for tooling; retain runtime validation and reject production fixture APIs. | Yes       | 2026-09-18 |
| TASK-007 | Add text/JSON, offline/running/production diagnostics with redacted failures and read-only service/migration checks.                                                    | Yes       | 2026-09-18 |
| TASK-008 | Connect public branding to Angular, Astro, verification mail, and passkey provider display names; preserve RP IDs and internal identifiers.                             | Yes       | 2026-09-18 |

### Implementation Phase 3

- GOAL-003: Verify the generated application, not only the source template.

| Task     | Description                                                                                                                                 | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-009 | Add clean-copy export/install/init/build/start/signup/sign-in smoke with owned-service cleanup and retained evidence.                       | Yes       | 2026-09-18 |
| TASK-010 | Verify memory-mode clean copy locally, including idempotence, frozen install after rename, rendered branding, and real authentication HTTP. | Yes       | 2026-09-18 |
| TASK-011 | Configure PR PostgreSQL smoke and critical E2E jobs, plus scheduled/manual full browser/durable coverage.                                   | Yes       | 2026-09-18 |
| TASK-012 | Execute PostgreSQL clean-copy smoke and Docker image build in a working container environment or CI.                                        | No        | —          |

### Implementation Phase 4

- GOAL-004: Make first use and downstream maintenance understandable.

| Task     | Description                                                                                                                                          | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-013 | Replace the root README with a verified first-run path and add setup/configuration/architecture/maintenance guides.                                  | Yes       | 2026-09-18 |
| TASK-014 | Add MIT license text, preserve upstream attribution in generated READMEs, and separate template tracking from the historical Themis product roadmap. | Yes       | 2026-09-18 |

### Implementation Phase 5

- GOAL-005: Validate implementation and record genuine environment limits.

| Task     | Description                                                                                                          | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-015 | Run tooling unit/type/lint checks and affected runtime/web checks; validate localized extraction and composed build. | Yes       | 2026-09-18 |
| TASK-016 | Run critical browser regression with owned Redis, inspect cleanup, and record final commands/results.                | Yes       | 2026-09-18 |
| TASK-017 | Close this plan only after TASK-012 has evidence; publishing a release remains a separate requested action.          | No        | —          |

### Traceability

| Phase | Status  | Gap                                                                                   |
| ----- | ------- | ------------------------------------------------------------------------------------- |
| PH-01 | done    | None.                                                                                 |
| PH-02 | done    | Local regression checks passed.                                                       |
| PH-03 | blocked | Container runtime unavailable locally; PostgreSQL/image execution remains TASK-012.   |
| PH-04 | done    | None.                                                                                 |
| PH-05 | done    | Local verification passed; final closure still depends on PH-03 container acceptance. |

## 3. Alternatives

- **ALT-001**: Global text replacement. Rejected; package identities, migration names, storage keys, and existing workflow state are not display branding.
- **ALT-002**: Silently overwrite an existing `.env` or regenerate secrets on rerun. Rejected; initialization is exclusive/idempotent.
- **ALT-003**: Copy `node_modules`, build artifacts, or Nx caches for the smoke. Rejected; reuse of the package-manager store is permitted, but installation and builds occur in the clean copy.
- **ALT-004**: Treat PGlite success as PostgreSQL/image acceptance. Rejected; result artifacts explicitly identify memory mode.
- **ALT-005**: Add unsupported switches to remove worker/realtime or production protected-storage requirements. Rejected; those require separate architectural changes.

## 4. Dependencies

- **DEP-001**: Pinned Node/pnpm, Git, installed workspace dependencies, and the existing Angular/TypeScript compatibility arrangement.
- **DEP-002**: Docker/Podman for canonical smoke and image verification, or explicitly supplied disposable PostgreSQL/Redis services.
- **DEP-003**: Native `redis-server` for explicit memory smoke when no external test Redis is supplied.
- **DEP-004**: Playwright Chromium and its OS dependencies for critical E2E; full browsers for scheduled runs.

## 5. Files

- **FILE-001**: `scripts/template/` — CLI, initialization, doctor, smoke, tests, and Nx configuration.
- **FILE-002**: `template.json`, `.node-version`, `package.json`, `.env.example`, `compose.yaml`, `Dockerfile`, `.dockerignore`, `drizzle.config.ts`, `nx.json`, `eslint.config.mjs`, `.gitignore` — explicit bootstrap/toolchain contracts and private-environment exclusions.
- **FILE-003**: `libs/shared/src/lib/{env,environment-schema,environment-schema.spec}.ts`, `libs/shared/package.json` — shared validation contract.
- **FILE-004**: Angular branding constants/layout/title/sign-in, Astro branding/content/configuration, gateway default-locale routing, and API auth branding/mail/passkey display names.
- **FILE-005**: `.github/workflows/{ci,docker}.yml` — consistent versions, fresh-copy verification, and critical/full E2E.
- **FILE-006**: `README.md`, `LICENSE`, `docs/template/`, and roadmap cross-reference — template-specific documentation.

## 6. Testing

| Category    | Required evidence                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Tooling protection/idempotence/redaction/version tests, shared environment-schema tests, affected application/API/site suites.   |
| API         | Real password signup/email verification/sign-in/session in the clean-copy smoke.                                                 |
| App E2E     | Existing critical auth suites after dynamic branding and localization changes.                                                   |
| Gateway E2E | Clean-copy liveness/readiness and mounted site/app/API responses; composed runtime build.                                        |
| Site E2E    | Site type/tests and rendered renamed brand in clean-copy smoke; no layout redesign.                                              |
| Visual      | N/A: existing layout is retained; only configured text/accessible names and supported-language options change.                   |
| Security    | Symlink/existing-file protection, origin/port validation, secret redaction, no rotation on rerun, production test-API rejection. |
| Build       | Composed production build, frozen installs before/after initialization, and pending Docker image build.                          |

Every shell invocation containing Nx starts with `export NX_DAEMON=false`, followed by loading Node through fnm. This execution environment also required `XDG_RUNTIME_DIR=/tmp/opencode` because `/run/user/1000` was unavailable; that is an environment workaround, not a repository requirement.

| Command                               | Observed result                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm nx run template:test`           | Six tests passed: dry-run, idempotence/secrets, existing-file protection, input/symlink validation, redacted doctor JSON, version consistency.                                                   |
| `pnpm nx run template:typecheck`      | Passed.                                                                                                                                                                                          |
| `pnpm nx run template:lint`           | Passed.                                                                                                                                                                                          |
| `pnpm install --frozen-lockfile`      | Passed with pnpm 12.4.2; no dependency resolution/lockfile regeneration required.                                                                                                                |
| `pnpm nx run app:extract-i18n`        | Passed, 391 messages after dynamic branding.                                                                                                                                                     |
| `pnpm nx run server:build:production` | All eight composed build tasks passed.                                                                                                                                                           |
| `pnpm template:smoke --memory`        | Passed in 35.3 seconds; evidence at `tmp/template-smoke-ydxWtz/result.json`. A fresh install, rename, idempotence, frozen re-install, rendered brand, readiness, signup, and sign-in all passed. |
| Container preflight                   | Docker is a Podman shim; Podman reports missing `crun` and an unavailable runtime directory. No PostgreSQL/container-image success is claimed for this execution.                                |

CI configuration is committed-file content only at this point; no remote run was triggered. Do not treat YAML presence as a passing GitHub check. The canonical follow-up is `pnpm template:smoke` in a functional container environment and the Docker workflow's production build.

## 7. Risks & Assumptions

### Final local verification checkpoint

- Tooling: **9 tests passed**, including private-environment filtering, command-specific flags, and parsed CI job requirements. Template typecheck and lint passed.
- Shared: **138 tests passed**, including rejection of production demo APIs and known example-secret placeholders.
- App: **107 passed**, one existing skip. API: **84 passed**. Site: **2 passed**. Gateway: **15 passed**.
- Browser regression: **62 app E2E tests passed** and **4 site E2E tests passed**, using a task-owned Redis process that was stopped after the run.
- Composed build, native localization extraction (391 messages), site typecheck, six affected-project lint targets, formatting, and whitespace checks passed.
- Latest clean-copy smoke: **passed in 34.1 seconds**, with renamed branding and **Spanish default locale** verified at the real public entry. Evidence: `tmp/template-smoke-NEptFS/result.json`. It used explicit memory mode and real Redis; it does not claim PostgreSQL coverage.
- `pnpm template:smoke` was also attempted without fallback flags and stopped cleanly with **No working container engine**. TASK-012 remains open for a working Docker/Podman environment or the configured CI job.
- Hidden baseline dependencies found and corrected: the gateway's hardcoded English redirect, Astro's now-required `fallbackType`, and a routing-unit test's implicit PostgreSQL/Redis dependency. The route test now isolates the service boundary while real credential behavior remains covered by persisted/HTTP suites; its rejection and service-call assertions were retained.
- No private environment was generated in the source workspace. Temporary smoke applications were removed; their redacted result/log evidence remains ignored under `tmp/`. Existing authentication changes remain uncommitted and intact.

The earlier six-test and first-smoke entries above are historical checkpoints. This checkpoint records the later expanded verification. Do not mark the plan `Completed` or claim a passing remote CI/image build until TASK-012 is actually executed successfully.

- **RISK-001**: Existing `themis-local` volumes are not renamed or migrated by initialization. Keep or migrate existing data explicitly.
- **RISK-002**: Public `template.json` is client-visible metadata. It must never contain private credentials.
- **RISK-003**: Demo fixture APIs are intentionally powerful; they are opt-in, local, and rejected in production.
- **RISK-004**: Full container acceptance is blocked by the current host runtime, not replaced by memory-mode evidence.
- **RISK-005**: Optional provider presence checks do not prove Google/Mailgun/physical-authenticator configuration works remotely.
- **ASSUMPTION-001**: Template source version `0.1.0` is a bootstrap contract marker, not a published release claim.
- **ASSUMPTION-002**: Linux/macOS/WSL2 are the documented command environments. Native Windows process orchestration is not claimed.
- **ASSUMPTION-003**: Existing uncommitted authentication work remains local and part of the smoke snapshot; it was not reverted, committed, or pushed.

## 8. Related Specifications / Further Reading

- [Getting started](../docs/template/getting-started.md)
- [Configuration](../docs/template/configuration.md)
- [Architecture and Themis](../docs/template/architecture.md)
- [Maintenance](../docs/template/maintenance.md)
- [Authentication UX implementation](feature-auth-ux-continuity-1.md)
- [Astro import reference](https://docs.astro.build/en/guides/imports/)
