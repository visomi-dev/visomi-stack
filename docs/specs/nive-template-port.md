# Nive improvements upstream port

## Confirmed scope

Port all reusable platform improvements from sibling repository `../nive`, in
verified blocks. Exclude Nive's finance, shopping, household, brand, customer
data, secrets, production resource identifiers, and uncommitted source changes.
Preserve the template's existing local UI/i18n work.

Source snapshot: `070ec99` (2026-10-03 inspection). Target starting revision:
`d1ee585`. This is an incremental port, **not a completed synchronization**.
The incremental verification follow-up explicitly imports later tooling commits
`671c92d` and `1a5bfb5`; other post-snapshot product changes remain outside this port.

## Phase inventory

| Phase                         | Explicit sub-scope                                                                                                                                                          | Status                                                                                                                               | Remaining gaps                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tooling                       | Fail-fast hooks; graph-aware affected/related checks; exact-file lint; CI base/head; one-shot tests; serialized E2E; bounded interruption cleanup                           | Implemented, focused tests passed                                                                                                    | Await-expression, extensionless-import, 120-column and 500-line enforcement require the associated workspace refactors; do not enable them against incompatible existing files |
| Formatting                    | Compare Prettier configuration and dependency versions                                                                                                                      | Already equivalent                                                                                                                   | None for configuration; workspace-wide formatting is not part of this first block                                                                                              |
| Deployment and infrastructure | Explicit trusted ingress hops; secure-cookie HTTP regressions; generic deployment/migration runbook; checksum-pinned MinIO CI fixture                                       | Implemented, tests and fixture build passed                                                                                          | Container deployment, real provider verification and real restore remain unverified                                                                                            |
| Sessions                      | Authoritative HttpOnly session lookup without auxiliary hints; retry temporary failures; forced checks fail closed; no-store session responses                              | Implemented, unit and gateway browser tests passed                                                                                   | None for this correction; application vault lifecycle remains separate                                                                                                         |
| Passkeys                      | Direct regular WebAuthn; explicit method sheet; post-selection errors; focus return; email-free entry and live waiting/navigation status                                    | Implemented, unit and gateway route tests passed                                                                                     | None for entry behavior; vault unlock remains separate                                                                                                                         |
| Zero-knowledge primitives     | Strict PRF/PIN envelopes; Argon2id; non-extractable custody; local PIN enrollment; durable attempts; recovery UI; PRF assertions/UI; signed relay; session cleanup          | PIN/recovery, PRF and application browser relay verified                                                                             | Final whole-port verification and deployment/authenticator certification                                                                                                       |
| Resilient synchronization     | Persistent encrypted queue; revision-bound replay; cross-tab locking; isolate blocked/conflicting transfers; durable apply-before-cursor                                    | Application projection consumer, ciphertext archive, gateway authority and localized reconciliation integrated; native checks passed | Final whole-port verification; archive compaction/checkpoint retention beyond the bounded 10,000-envelope archive requires a separate design                                   |
| Durable async operations      | Persisted operation acceptance/results; reconnect catch-up; authenticated live completion                                                                                   | Integrated with project seed and gateway verified                                                                                    | Real PostgreSQL process-restart/failover verification; new handlers require their own bounded, idempotent writes                                                               |
| Notifications                 | Account/user-scoped inbox/preferences; atomic producers; localized inbox; live invalidation; session-bound subscriptions; leased outbox; VAPID; explicit browser enrollment | Inbox/preferences, bounded delivery and opt-in enrollment implemented and verified                                                   | External-provider/OS permission certification and deployment-specific VAPID rollout                                                                                            |
| Email                         | Generic localized MJML verification, email-change and recovery templates; previews; renderer/build and real delivery-flow integration                                       | Implemented, tests/build/gateway checks passed                                                                                       | Real Mailgun delivery and Gmail/Outlook client certification not exercised; no family or financial reminder templates imported                                                 |
| Application updates and PWA   | Locale-scoped worker; template-generated manifest/icons; explicit reload notice; freshness navigation; no API data caching                                                  | Implemented, unit/build/gateway browser passed                                                                                       | Real deployment update rollout and operating-system install certification remain unverified                                                                                    |
| Shared UI                     | Native button toggle semantics; table state fixes; select parity review; mobile navigation focus restoration; shell-local page titles                                       | Primitives and shell titles verified                                                                                                 | Product palettes/navigation excluded; complete any remaining independently useful source review                                                                                |
| Personal runtime              | Portable pairing proof and recipient-bound encrypted key delivery in shared-crypto                                                                                          | Primitives and application browser enrollment verified                                                                               | Finance client, intake commands and product runtime excluded; final whole-port verification remains                                                                            |

## Provenance and adaptations

### Sync HTTP and durable-matrix boundaries completed

Close two of the seven oversized modules recorded at the draft checkpoint:
`apps/web/api-e2e/src/api/sync.spec.ts` and `pzs-005-real.spec.ts`.
Keep the other five open: auth middleware integration, OpenAPI runner, frontend
sign-in, shared DB schema and legacy workflow internals. This is incremental
progress, not whole-port completion or global strict-rule activation.

- Move the unchanged session, same-account member, cookie and envelope fixtures
  into `src/support/sync-fixture.ts`. Move the revocation, quorum recovery,
  all-device-loss, re-enrollment and anti-rollback scenario into
  `src/api/sync-device-lifecycle.spec.ts`. Each scenario still creates its own
  authenticated accounts/project/devices through HTTP; no suite-order state is
  introduced. Assign the tombstone and first-append responses before asserting.
- Move PZS-005 observation capture, run/stream identity, status/code matrix
  validation, report serialization and artifact fingerprinting into
  `src/support/pzs-005-evidence.ts`. Keep the complete durable scenario in one
  test and one owned API/PostgreSQL/MinIO invocation. The status helper awaits
  the request and asserts before the next case; requests are not parallelized.
  Assign artifact bytes before hashing, preserving exact byte-sensitive hashes.
- Enable snapshot strict rules for both suites and their new support modules.
  All are below 500 counted lines. No rule exceptions, assertions, expected
  negative codes, evidence files or timeout budgets are removed.

Fresh focused verification, before the publication hook:

- `tmp/sync-boundaries-tests.log`: six sync HTTP scenarios passed across the two
  suites through `api-e2e:test`, with `--skip-nx-cache`. Build and native-fixture
  prerequisites also ran fresh.
- `tmp/sync-boundaries-parity.log`: all six scenario names, per-scenario HTTP
  request ASTs, assertion matchers/expected values and timeouts match the baseline;
  all five extracted fixture initializer/body ASTs match. Assertion subjects for
  the two assigned append responses were also inspected in the diff.
- `tmp/sync-matrix-boundaries-e2e.log`: the single durable scenario passed all
  23 cases through `api-e2e:e2e` with `PZS005_REAL=true` and `--skip-nx-cache`.
  Invocation-owned PostgreSQL/MinIO were provisioned and removed. Artifacts are
  retained locally at `tmp/sync-matrix-boundaries-evidence`, not published.
- `tmp/sync-matrix-boundaries-parity.log`: all 23 observed request ASTs preserve
  membership, order and arguments; all 21 formerly embedded status assertions
  preserve their case and expected code. Identity, expected matrix status/code,
  HAR, JUnit, raw HTTP, OpenAPI and evidence-file initializers match baseline ASTs.
- `tmp/sync-matrix-boundaries-lint.log`: project lint passed after strict-rule
  activation; formatting and `git diff --check` passed.

Publish only after the normal pre-commit gate. Record that gate separately in
`tmp/sync-boundaries-commit.log`; focused verification above is not a substitute.
Keep PR #2 draft with the five remaining boundaries and final source-inventory,
restore, whole-port verification and external certification gaps visible.

### Draft publication and generated-email follow-up

The integrated branch was pushed and draft PR
[#2](https://github.com/visomi-dev/visomi-stack/pull/2) targets `main` directly.
Commits `32df7f5` (implementation) and `ed93734` (gate evidence) both passed
their normal hooks before push. The draft lists remaining work explicitly and
does not claim whole-port completion or deployment certification.

Synchronize the generated email resource with the MJML source after the gate's
formatter added whitespace inside Handlebars expressions. Compare committed and
regenerated source after normalizing only equivalent `{{ expression }}` spacing;
the sources match exactly after that normalization, so no template/copy/markup
change is hidden in this follow-up. The generated-resource follow-up must pass
its own normal pre-commit gate before push. Its evidence log is
`tmp/relocated-email-generation-commit.log`.

### Integrated progress committed after the complete pre-commit gate

Commit `32df7f5` (`feat(platform): port reusable Nive capabilities into stack`)
captures the integrated progress authorized by the user, including the preserved
local UI/i18n work. The real pre-commit gate passed without bypasses. Its final
log is `tmp/relocated-port-commit.log`; failed attempts remain separate evidence,
not successful verification. Push and draft PR creation follow this checkpoint.

The final gate ran staged lint/formatting, affected unit suites and all six
affected E2E projects: API, application, realtime, gateway/server, site and worker.
The application E2E executed 87 Chromium scenarios with one intentional skip;
API E2E passed 24 memory scenarios plus four durable/restart/device-approval
scenarios against invocation-owned PostgreSQL/MinIO. Gateway/server passed five,
site passed seven, and realtime and worker each passed one E2E scenario.
Some unit/build prerequisites replayed local Nx cache; E2E scenarios executed
afresh. Memory API units retain nine infrastructure-gated skips, shared-library
tests retain seven gated skips, and Angular retains one intentional skip.
This does not certify every optional durable matrix or browser/OS/provider mode.

Additional real-gate corrections, all included in the integrated commit:

- Keep report sanitization as a native Node fixture suite, executed by the
  required `api-e2e:fixture-test` dependency. Exclude it from Jest discovery,
  including the full runner's CLI ignore-list override, which replaces config
  patterns rather than extending them. No sanitization tests are dropped.
- Projects tests need PGlite's VM-module support and the existing database
  environment that drains initialization before runtime teardown. Configure both
  in the owning project; its five tests pass without asynchronous-import errors.
- Declare a workspace-root-prefixed output for the site's inferred Vitest target
  and keep its coverage directory inside the repository, not the parent folder.
- Invocation-owned MinIO must use the generated bucket and fixture credentials.
  Inheriting the developer bucket produced a real durable enrollment `409`;
  fix fixture isolation rather than weakening authorization or retry assertions.
  External bucket/credential overrides require `API_E2E_EXTERNAL_SERVICES=true`.

All invocation-owned Redis, gateway, local-agent, PostgreSQL and MinIO resources
were stopped; unrelated Nive containers remain untouched. Temporary full-run
server diagnostics are retained locally, not published. Email build regeneration
after staged formatting changed only whitespace inside Handlebars expressions
in the generated resource module; inspect that residual generated diff before
the next implementation commit. Do not discard unrelated work to clean status.

**The full port is still incomplete.** Seven oversized modules, source-inventory
reconciliation, global strict enforcement, refreshed final clean-copy restore
after the last implementation, and the previously listed deployment/provider/OS
certifications remain open. The PR must stay draft until those implementation
and applicable verification gaps are closed.

### Relocated workspace and incremental draft PR authorization

Resume from the canonical workspace at
`/srv/fast/visomi/Projects/GitHub/visomi-dev/visomi-stack` after the disk migration.
The repository, branch and uncommitted port were preserved. The new volume had
approximately 506 GB free and 55 million available inodes at inspection.
Keep task resource directories under the current `$PWD/tmp`; do not reuse stale
absolute paths from the old location.

The user now explicitly authorizes publishing the integrated progress as a
**draft PR targeting `main` before the full port is complete**. They also explicitly
approved including the existing local UI/i18n work integrated with this branch.
This supersedes the earlier whole-port-before-publication restriction, not the
mandatory pre-commit gate. Never bypass hooks. Keep the draft's outstanding work
and certification limits visible; do not present it as merge-ready or complete.

Complete the project-workflow split by moving its project-bound domain API type
to `project-workflow-domain.ts`. Keep the type signatures unchanged and export
that public type from both library entry points. Assign the concurrent child
process results before asserting them. This resolves both errors from the older
checkpoint below without compressing statements or disabling strict rules.

After reinstalling in the relocated checkout, `pnpm exec tsc` resolves the native
TypeScript 7 compiler while this project's CommonJS configuration still targets
the pinned TypeScript 6 API/build toolchain. Select the installed `tsc6` binary
explicitly in `themis-workflow:typecheck`; do not broaden this change into a
workspace compiler/module-resolution migration.

Fresh relocated verification:

- `tmp/relocated-workflow-lint.log`: workflow lint passed.
- `tmp/relocated-workflow-tests.log`: all 11 workflow tests passed, including
  foreign-project rejection, bounded contention and cross-process serialization.
- `tmp/relocated-workflow-typecheck.log`: typecheck passed with `tsc6` after the
  first attempt exposed the TypeScript 7 CLI mismatch.
- `tmp/relocated-workflow-build.log`: workflow build passed.
- `tmp/relocated-workflow-consumers.log`: native CLI, migration, scanner and
  adapter consumer tests passed after the workflow split.

Seven oversized modules remain to adapt: authentication middleware integration
tests, API E2E `pzs-005-real.spec.ts` and `sync.spec.ts`, the OpenAPI runner,
frontend sign-in, shared DB schema and legacy workflow internals. Remaining
source-inventory reconciliation, global strict enforcement and final whole-port
verification remain open. Production/provider/OS/physical-authenticator limits
in the phase inventory also remain unchanged. Hook execution and draft publication
are the next steps; no publication is established by this checkpoint alone.

Initial real pre-commit attempts correctly failed closed. Fix two blank-line
violations in the existing Angular i18n ESLint rule without changing rule behavior.
Explicitly select memory DB/sync and memory mail for unit/browser verification:
the inherited developer `.env` selected PostgreSQL, and vault tests correctly
refused mutation without an explicitly authorized disposable database. Durable
API E2E retains its separate owned PostgreSQL/MinIO provisioning; this override
does not skip it. The next attempt passed API unit tests and reached API E2E
tests, which exposed an ES2020 test-library configuration incompatible with the
report sanitizer's native `String.replaceAll`. Set the API E2E test library to
ES2022 (plus DOM fetch types), matching the current Node runtime, without
disabling diagnostics or weakening sanitization. Failed-attempt logs are kept
under `tmp/relocated-port-commit-attempt-*`; no failed gate was bypassed.

### Resume checkpoint: project workflow extraction in progress

Checkpoint saved at the user's request on 2026-10-04. All port changes remain
uncommitted and unpushed on `feature/nive-platform-port`; no PR has been opened.
Preserve the existing local UI/i18n and ESLint work. The full reusable port is
still incomplete; do not treat the passing verification below as authorization
to publish a partial implementation.

After completing the migration and adapter-matrix boundaries recorded in the
next section, begin separating `libs/themis-workflow/src/lib/project-workflow.ts`:

- `project-workflow-contract.ts` owns registration, cursor, event and snapshot
  types plus the single shared `WorkflowError` class.
- `project-workflow-filesystem.ts` owns project-id/path validation, hashing,
  atomic writes and the filesystem authority lock. Preserve the two-second
  contention deadline, thirty-second stale-lock threshold and descriptor cleanup.
- `project-workflow-portable.ts` owns recursive portable redaction and event
  translation, preserving the protected-field list.
- `project-workflow.ts` retains registry, project-store and project-bound domain
  operations. It imports the extracted modules directly.
- Both public library entry points (`src/index.ts` and `src/index.build.ts`)
  export the new public contracts and portable functions; filesystem internals
  are not re-exported. The workflow suite imports moved symbols directly.
- Incremental strict lint now includes `project-workflow*.ts`, with the explicit
  `.ts` import exception required by native Node test/CLI execution.

**This workflow extraction is not yet verified or complete.** The last exact-file
autofix invocation failed with two remaining errors in
`tmp/project-workflow-boundaries-lint.log`:

1. `project-workflow.ts` has 504 counted nonblank/noncomment lines after braces
   autofix; the enforced maximum is 500. Finish a meaningful extraction rather
   than disabling the limit or compressing statements to evade it.
2. `project-workflow.spec.ts` still uses an awaited expression inside another
   expression (reported at line 389). Assign the awaited result first.

The resolved project configuration is saved in `tmp/project-workflow-targets.json`.
The workflow's available targets are `lint`, `test`, `typecheck` and `build`.
Its native `test` target executes `project-workflow.spec.ts` from the repository
root, including child-process concurrency coverage. Run these focused targets
after fixing the two errors, then rerun native CLI/migration/scanner and adapter
tests because those consumers use the workflow library. Refresh formatting and
`git diff --check` after the workflow edits; their previous passing observations
predate this in-progress extraction.

Suggested next verification, loading Node with `fnm` and exporting
`NX_DAEMON=false` in every shell invocation:

```sh
eval "$(fnm env)"
fnm use
export NX_DAEMON=false
export NX_SOCKET_DIR="$PWD/tmp/nxp-s" TMPDIR="$PWD/tmp/nxp-t" NODE_COMPILE_CACHE="$PWD/tmp/nxp-c"
pnpm nx run themis-workflow:lint
pnpm nx run themis-workflow:test
pnpm nx run themis-workflow:typecheck
pnpm nx run themis-workflow:build
pnpm nx exec --projects=template -- node --experimental-strip-types --test "$PWD/scripts/themis-cli.test.ts" "$PWD/scripts/themis-project-migration.test.ts" "$PWD/scripts/themis-project-migration-evidence.test.ts" "$PWD/scripts/themis-adapter-operation-matrix.test.ts"
```

Eight previously oversized files remain open until the workflow extraction is
verified. Then finish the other seven: authentication middleware integration
suite, API E2E `pzs-005-real.spec.ts` and `sync.spec.ts`, OpenAPI runner, frontend
sign-in, shared DB schema and legacy workflow internals. Reconcile the remaining
reusable source inventory and enable global strict rules only after compatibility
is established. Final whole-port verification, the pre-commit gate, commit, push
and a self-contained PR targeting `main` remain pending in that order.

### Project migration and adapter-matrix boundaries

Separate native project-store migration contracts, paths, record/event partitioning,
and evidence inspection into directly imported `scripts/themis-project-migration-*`
modules. Keep migration/resume/cutover/rollback orchestration and checksum-based
store operations in `themis-project-migration.ts`. Preserve ownership selection,
orphan/ambiguous-record quarantine, event ordering, retargeting, write fencing and
backup identity validation. Consumers now import evidence inspection directly.

Extract the explicit CLI operation families and OpenCode tool cases from the
adapter authorization suite; retain every independently named adversarial test in
the suite itself. Resolve its child CLI relative to the module URL rather than
the Nx invocation directory. Enable braces, 120-column, 500-line and await-result
rules on both extracted groups; their native Node imports keep required `.ts`
extensions. These two files leave eight outstanding oversized modules from the
preceding audit: authentication middleware integration tests, the two API E2E
suites, the OpenAPI runner, frontend sign-in, DB schema, project workflow and
legacy workflow internals. Global enforcement and whole-port completion remain
pending; this is not permission to publish the incomplete port.

The extracted raw-output scanner exposed an existing double-escaped whitespace
pattern that missed normal credential/protected-payload assignments. Correct it
and include optional JSON/single-quote delimiters. Ten regression cases cover
plain text, tabs, JSON, quoted keys, private keys, exact local paths and harmless
status metadata. Migration tests now actually remove their unique temporary
fixtures rather than assuming Node automatically cleans `mkdtempSync` directories.

Fresh verification (2026-10-04):

- `tmp/migration-native-tests.log`: all 10 CLI/project migration tests passed
  after the initial extraction.
- `tmp/adapter-native-tests.log`: all 213 CLI/OpenCode adapter authorization,
  foreign-project isolation and redaction tests passed after extraction.
- `tmp/migration-evidence-native-tests.log`: all 20 CLI, migration and scanner
  regression tests passed after the scanner correction and fixture cleanup.
- `tmp/migration-adapter-final-lint.log`: exact-file native-script lint passed
  with the new strict rules enabled.
- `tmp/migration-template-tests.log`: all 66 template/tooling tests passed fresh
  with `--skip-nx-cache`; no tests were skipped.

All three extracted matrix initializers (`cliCases`, `operationFamilies` and
`toolCases`) match the baseline after TypeScript erasure and token comparison,
including command arguments, literal values, operation membership and order.
Formatting and `git diff --check` passed for the updated artifacts.

Verification used `pnpm nx exec --projects=template --` for native script tests
and exact-file lint; the invocation repeated native groups in the current Nx
execution context. Counts above describe unique tests, not the repeated total.
The full gateway E2E/clean-copy restore recorded below predates these script
changes and must be refreshed after the remaining implementation. No commit,
push or PR has occurred.

### CLI boundary and full-suite isolation follow-up

Extract native CLI context/output helpers into `scripts/themis-cli-context.ts`
and project-store commands into `scripts/themis-cli-storage.ts`. Preserve all
command names, option definitions, handler semantics and registration order.
Enable braces, 120-column, 500-line and await-expression rules on the CLI modules;
explicit `.ts` imports remain required because these scripts also run directly
with Node's native TypeScript resolution. The CLI is no longer oversized, leaving
10 files from the preceding audit to adapt.

`tmp/themis-cli-boundaries-tests.log` passed all 63 template/tooling tests.
`tmp/themis-cli-native-tests.log` passed all 10 CLI/project-migration tests via
`pnpm nx exec --projects=template -- node --experimental-strip-types --test`.
The first Nx-exec invocation exposed a test harness path assumption: the CLI test
launched a repository-relative script while Nx executed from the template root.
Resolve that script relative to the test module instead; this does not change CLI
product behavior. Final template lint, formatting and `git diff --check` passed.

`tmp/port-full-app-e2e.log` records a fresh whole-app Chromium invocation with
85 passing scenarios, one intentional skip and two failing native vault scenarios.
The shared gateway's authentication rate-limit state accumulated between scenarios;
these same cases passed when isolated. Use the existing ENABLE_TEST_API,
memory-driver-only reset endpoint in before/after hooks for each native vault
scenario, as the existing security suites already do. Do not change production
budgets or reset between attempted proofs within a scenario. App E2E lint passed.
`tmp/port-full-app-e2e-isolated.log` records the passing fresh complete rerun:
87 Chromium scenarios passed and one was intentionally skipped in 2.7 minutes,
with `--skip-nx-cache` and one serialized worker. This includes native vault,
projection, notification, Web Push worker registration, durable operations, PWA,
authentication and light/dark mobile keyboard/AXE coverage together.
All task-owned Redis/gateway/local-agent processes from the app run stopped.

A fresh renamed clean-copy restore was executed. The initial invocation was
correctly rejected because the shell inherited container host/context overrides;
the retry explicitly unsets those overrides and all SMOKE database/Redis inputs,
so only the default local engine and invocation-owned containers could be used.
All publishing remains pending completion of implementation and final verification.

The first local restore invocation built and exercised the renamed copy but
failed schema fingerprint comparison. A restricted disposable-fixture diagnostic
showed identical data and a single schema-text difference: PostgreSQL flattened
the nested AND nodes of `push_deliveries_attempts_check` while reparsing the dump.
Do not suppress schema comparison. Normalize only fully parenthesized unquoted
AND regrouping in schema CHECK constraints, keeping operand parentheses, order,
operators and values. Data fingerprints remain byte-sensitive except for pg_dump
restriction nonces; schema quoted material, comments and dollar-quoted function
bodies are preserved. Regression tests cover bound/operator/name/OR changes and
single/multiline data strings and function bodies resembling constraint text.
`tmp/restore-canonical-tests.log` passed all 66 template/tooling tests, and template
lint passed. The fresh standard Nx clean-copy restore passed after this fix:
`tmp/port-final-clean-copy-restore-passed.log` and
`tmp/template-smoke-3Cocly/result.json` record a fresh clean install and composed
runtime build, renamed branding/Spanish default, idempotent initialization,
PostgreSQL migrations, schema/data restore equality and password-authentication
continuity. The restored synthetic encrypted object canary and TOTP-v1 record
authenticated successfully; missing/wrong keys were rejected. The object source
was removed before restore, and its client key remained runner-memory-only.
This certifies database and synthetic recovery fixtures, not full application-vault
recovery, production key escrow, physical authenticators or provider/OS rollout.
Only the template bundler prerequisite reused local Nx cache; the clean copy,
install/build/runtime and restore executed anew. Task-owned containers/processes
were cleaned up, and restricted raw fixture diagnostics were removed after the
schema-only difference was understood. No commit, push or PR occurred.

`tmp/mobile-navigation-visual.log` passed the two native light/dark scenarios again
with open/closed screenshots. The screenshots in the corresponding
`dist/.playwright/apps/web/app-e2e/test-output/app-mobile-navigation-*` directories
were reviewed: no drawer clipping, overlapping actions or missing focus indicator
was observed at 390×844. This is targeted screenshot review, not broad visual
snapshot certification. `tmp/port-continuation-final-lint.log` records the subsequent
nine-project lint pass; formatting and `git diff --check` passed.
All 41 CLI initializer expressions, including command metadata and registration
order, also matched the original TypeScript AST after extraction.

### Completed authentication-service split and native mobile-navigation follow-up

Split authentication identity/membership/enrollment, remembered-device tokens,
TOTP/recovery-code consumption, password signup/reset and password session/proof
transactions into directly imported feature modules. No compatibility barrel or
duplicate implementation remains. Preserve password proof freshness, enrollment
binding, epoch checks, upgrade CAS, user-before-factor lock order, durable failed
attempt reservations and atomic one-use code consumption. The recovery module now
imports enrolled-factor consumption directly from `auth-factors.ts`.

Enable the incremental strict rules on all six resulting modules, including the
remaining `auth-service.ts`. The service has 466 nonblank/noncomment lines; the
identity, device, factor, password-account and password-session modules are each
below 500 lines. This closes the oversized auth-service gap but does not establish
global strict-rule compliance for the other outstanding modules.

The current approximate nonblank/noncomment audit still finds 11 oversized files:
`auth-middleware.spec.ts`, API E2E `pzs-005-real.spec.ts` and `sync.spec.ts`,
`run-openapi-contract.ts`, frontend `sign-in.ts`, backend DB `schema.ts`,
`project-workflow.ts`, `legacy-workflow-internal.ts`, `themis-cli.ts`,
`themis-project-migration.ts` and `themis-adapter-operation-matrix.test.ts`.
The authentication schemas, passkey router and authentication service are no longer
on that list. Keep required native-runner and Angular route import extensions.

Add real-browser mobile-navigation regressions in both explicitly selected light
and dark modes. Exercise forty forward/backward Tab presses per mode, Escape,
reopening, opener restoration, desktop resize and inert-background release. Run
unmodified WCAG A/AA AXE checks with the drawer open and closed.

The native tests exposed a failure that TestBed-only trap-enabled checks did not
catch: the generic `transition-all` kept the close control's computed visibility
hidden when focus was requested. Restrict animation to transform and explicitly
focus the close button in a browser render-write callback. The layout owns opener
restoration; no asynchronous auto-capture remains to focus a closed drawer. Add a
unit regression for repeated opening and no focus capture on close. AXE also found
4.34:1 initials contrast on the light avatar background; use the existing darker
slate foreground without disabling color-contrast checks or changing dark colors.

Verification (2026-10-04):

- `tmp/auth-identity-boundaries-tests.log`: full API run passed 29 enabled
  suites/243 tests, with two infrastructure-gated suites/nine tests skipped.
- `tmp/mobile-focus-final-tests.log`: full Angular run passed 261 tests, with
  one intentionally skipped test.
- `tmp/auth-service-shell-final-lint.log` and
  `tmp/auth-service-shell-final-build.log`: nine-project lint and all six
  production-runtime builds passed.
- `tmp/auth-service-native-vault-shell-passed.log`: five native scenarios passed:
  light/dark keyboard + AXE navigation and three PIN/PRF cases.
- `tmp/auth-service-native-browser-sync.log`: two native browser delivery and
  encrypted-projection cases passed against a separately started gateway.
- `tmp/auth-service-native-openapi.log`: live gateway contract smoke passed the
  20 required observations and three deterministic Schemathesis examples after
  the final service split. Runtime prerequisites used a mix of fresh builds and
  local Nx cache; browser/HTTP scenarios executed afresh.

These focused E2E groups passed before the complete run recorded in the newer CLI
and full-suite follow-up. No commit, push or PR has occurred.

### Passkey, contract and recovery boundary follow-up

Extract passkey ceremony helpers and credential management while retaining the
parent router's CSRF, rate-limit, authenticated-mutation and restricted-registration
middleware order. All registration, authentication/verification and credential
management routes retain their original paths and proof requirements. The router,
ceremony helpers and credential-management module now satisfy the 500-line rule
(which excludes blank/comment lines), 120-column, braces, extensionless imports and
await-expression restrictions.

Separate authentication runtime schemas from `auth-openapi.ts`; retain the existing
validation shapes, OpenAPI identities, response envelopes and path descriptions.
The document builder imports metadata directly instead of loading it through the
router. Both contract modules satisfy the same strict rules.

Extract existing-account recovery into `auth-recovery.ts`. Keep the account → user
→ flow → proof lock order, auth-version/email/session binding, committed failed
attempts, TOTP/recovery-code consumption, issued-grant continuity and post-Passport
rebinding checks. Import consumers and spy-based epoch tests from the new module;
do not leave duplicate implementations or compatibility barrels. The remaining
auth service still exceeds the line limit and requires further splitting; its
shared delivery/factor helpers are temporary feature-local dependencies of recovery.

Verification (2026-10-04):

- `tmp/auth-recovery-boundaries-tests.log`: 18 enabled suites/167 tests passed,
  including all auth and account recovery/epoch regressions; two infrastructure
  suites/nine tests remained explicitly skipped in memory mode.
- `tmp/passkey-contract-native-openapi.log`: real composed gateway smoke passed
  all 20 required HTTP observations and three deterministic Schemathesis examples.
  This rerun exercises the extracted metadata and report-sanitization module.
- `tmp/passkey-boundaries-native-vault-localhost.log`: three native Chromium
  PIN/PRF/unsupported-authenticator scenarios passed after the extraction.
- `tmp/passkey-boundaries-native-browser-sync.log`: two native browser-delivery
  and encrypted-projection scenarios passed in a separate fresh gateway invocation.
  These remain focused scenarios, not a passing entire app E2E suite.
- `tmp/auth-boundaries-final-lint.log` and `tmp/auth-boundaries-final-build.log`:
  nine-project lint and six production runtime builds passed without budget changes.
  Formatting and `git diff --check` passed.

An initial native invocation used `127.0.0.1` as the RP ID and failed browser
credential creation before email verification. Repeating with the native fixture's
`localhost` host passed; do not treat raw IP RP IDs as interchangeable with localhost
for browser WebAuthn. All task-owned Redis, gateway and local-agent processes were
stopped; ports 27379/18083/14318 are free. No commit, push or PR occurred.

Global strict-tooling adaptation, remaining oversized modules, final whole-port E2E
and fresh PostgreSQL restore verification remain outstanding.

### Authentication boundaries and incremental strict-tooling rollout

Split Google linking/sign-in, purpose-bound reauthentication, password flows,
device approval, TOTP/recovery-code management and security/enrollment management
out of the original authentication router. Keep the existing route contracts and
middleware order within each flow. The main router is now below 500 physical lines;
all 51 original method/path registrations remain present exactly once. Shared
session transitions and method availability remain feature-local helpers.

Enable the source snapshot's await-expression, extensionless-import, braces,
120-column and 500-line limits for these completed modules, not for incompatible
workspace files. This is an incremental rollout, not completed global enforcement.
The auth service/schema, passkey router, sign-in, larger integration suites,
workflow internals, DB schema and Themis scripts still need compatible splits.

The broader authentication run exposed skipped integration suites initializing
PGlite through imports. Jest does not execute their afterAll hooks. A custom test
environment now waits for that initialization at Circus run_finish, before Jest
disposes its module loader, including when all suite tests are skipped. It does not
close suite-owned fixtures or weaken PostgreSQL/Redis opt-in guards. The environment
is shared in `tools/testing/database-environment.cjs`; API and gateway test targets
include it in their cache inputs. Gateway tests use the same explicit Node VM option
as API/shared tests, rather than relying on external NODE_OPTIONS for PGlite imports.

Extract OpenAPI report sanitization into a standalone support module, with focused
regressions for nested authentication/custody data, both quotation styles, paths,
long diagnostic material and recursive JSON/text/malformed-report processing.
Keep explicit TypeScript extensions in the native Node runner. The larger fixture,
observation, smoke and reporting boundaries still require further extraction.

Verification (2026-10-04):

- `tmp/auth-strict-tests.log`: all 16 enabled authentication suites passed, 147 tests;
  two integration suites/nine tests skipped because their explicit infrastructure
  opt-ins were absent. This includes approval ownership, cancellation and consume races.
- `tmp/auth-port-full-api-tests.log`: full API run passed, 29 enabled suites/243 tests,
  with the same two suites/nine integration cases skipped. An earlier four-minute
  invocation was interrupted; the repeated invocation completed successfully.
- `tmp/openapi-extraction-fixture-tests.log`: 13 support fixture tests passed,
  including four new sanitization regressions. This is not a live OpenAPI smoke run.
- `tmp/auth-port-final-lint.log`: six-project lint passed with strict rules enabled
  on the extracted modules.
- `tmp/auth-port-final-build.log`: all six production runtime builds passed without
  increasing budgets. Route registration parity and `git diff --check` passed.
- `tmp/server-memory-harness-tests.log`: all three gateway suites/30 tests passed
  after correcting the missing VM option and initialization lifecycle. The previous
  combined run had passing assertions but failed its PGlite module imports.
- `tmp/port-runtime-full-tests.log`: combined API, gateway, backend shared, portable
  crypto and frontend shared targets passed; API/gateway executed again and the
  other three targets reused Nx's local cache. This remains memory-mode verification.
- `tmp/port-template-full-tests.log`: all 63 template/tooling tests passed.
- `tmp/port-follow-up-final-lint.log` and `tmp/port-follow-up-final-build.log`:
  nine-project lint and six production runtime builds passed after the shared-shell
  corrections. Formatting checks and `git diff --check` also passed.

No commit, push or PR occurred. Full strict-tooling adaptation, remaining reusable
source review, whole-port E2E and a fresh clean-copy restore remain outstanding.

### Shared-shell source-review follow-up

Reviewed the snapshot's shared select, checkbox, radio, form, dialog, listbox,
password, table, pagination, shell/navigation and settings/interceptor differences.
Preserve Stack's existing localization, authentication-layout work and palette;
exclude Nive's financial navigation, household invitations and onboarding scope.
Select and the inspected form/overlay control behavior were already equivalent
apart from class layout and braces. Do not replace them to copy source formatting.

Import the independently reusable remaining corrections: native checkbox
appearance, mobile safe-area padding, dynamic bottom-link query parameters,
CDK drawer focus containment plus inert background content, and explicit
service-worker bypass headers for browser `/api/` requests. Drawer Escape and
opener restoration remain available; static/external requests retain normal worker
handling. Add focused regression coverage for dynamic hrefs, named projected links,
safe-area padding, native checkbox classes, drawer activation/Escape cleanup and
API-only bypass behavior. Desktop resize closes the mobile drawer and releases its
focus trap/inert background; destruction removes only the owned media listener.
No source branding, palette or finance routes imported.

- `tmp/shared-shell-review-tests.log`: complete Angular unit run passed, 260 tests
  and one intentional skip. This is not browser keyboard or AXE certification.
- `tmp/shared-shell-review-lint.log` and `tmp/shared-shell-review-build.log`: app
  lint and production build passed after the final shell/interceptor corrections.
- `tmp/auth-port-clean-copy-smoke.log`: fresh renamed clean-copy memory smoke passed
  at `tmp/template-smoke-60CO6Z`, including clean install and composed runtime build.
  This ran after authentication extraction but before the final shared-shell changes;
  it does not certify PostgreSQL restore, live vault recovery or the final whole port.

The overall port remains incomplete, including global strict-rule adaptation and
whole-port native E2E/restore verification. Commit, push and PR remain pending.

### Application browser delivery and encrypted projection consumers

Adapted the reusable request/compare/approve/receive flow from Nive's
`finance/vault/browser-enrollment` without its financial scope assumptions.
`BrowserUnlock` owns temporary non-extractable recipient keys and bounded expiry;
the localized panel composes existing Signal Forms, buttons and purpose-bound
confirmation. `VaultKeySession.deliverToBrowser` encrypts transient capsule bytes
without exporting a persistent raw-key reference. Recipient installation validates
the canonical continuity anchor, owner/account/version and authoritative session.
`VAULT_BROWSER_ENABLED` is explicit opt-in, defaults false and gates relay routes
with 503. The Playwright gateway explicitly selects memory opaque storage instead
of inheriting unrelated developer `.env` durable configuration.

Added route-owned `VaultSync`, ciphertext-only `IndexedDbProjections`, authenticated
portable projection codecs and localized connection/reconciliation status. Gateway
workspace/device authorization precedes plaintext publication. Durable, idempotent
archive apply and integrity validation precede cursor acknowledgement. Every routing
and ordering field is authenticated, including deletion metadata. The bounded archive
is partitioned by user/account/workspace. Lock and owner changes cancel transport,
drop keys and clear decrypted projections. Explicit rejected-upload discard compares
both ID and revision and retains local encrypted data. No financial document editor,
personal-account semantics or Nive-specific source data was copied.

Native verification exposed two real lifecycle issues that were repaired: borrower
release calls the borrower's `lock`, so consumer cleanup must be reentrant; a late
generation-reset effect could erase fresh PIN input already supplied through the
new-generation linked model. A dedicated settings regression now preserves new
input while clearing departing-generation values. Test passkey-mode telemetry is
retained across navigation rather than relying only on a disappearing DOM attribute.

Focused evidence (2026-10-04):

- `tmp/browser-sync-native-final.log`: native browser relay and projection sync
  scenarios passed against the real gateway, including Spanish rendering and AXE.
- `tmp/browser-sync-native-vault-final.log`: the existing three PIN/PRF/unsupported
  native scenarios passed after the lifecycle correction. Earlier combined five-case
  runs failed; the passing evidence is these separate gateway invocations, not a
  passing full E2E suite.
- `tmp/sync-consumer-app-tests.log`: complete Angular unit run passed with 255 tests
  and one intentional skip, including settings-reset and consumer authority regressions.
- `tmp/sync-projection-tests.log`: 72 shared crypto and 39 frontend tests passed,
  including capsule delivery, tamper/scope checks and transactional replay/quota/cancellation.
- `tmp/browser-link-api-tests.log`: all 24 PIN/PRF/relay API tests passed in memory mode.
- `tmp/browser-sync-api-final-tests.log`: 45 tests across seven API suites passed
  after the first route-helper extraction and memory-database test lifecycle correction.
  This includes all 24 vault cases, seven opaque sync authorization/no-store cases
  and password/identity/session regressions.
- `tmp/browser-sync-final-lint.log`: six-project lint passed.
- `tmp/browser-sync-final-build.log`: final six-runtime production builds passed without
  relaxing budgets. `git diff --check` also passed.

Task-owned Redis/container/network resources were removed and isolated listeners
27379/18083/14318 are free. No commit, push or PR occurred. This completes the
browser delivery application integration and adds native-tested projection consumers;
strict-tooling refactors, remaining reusable source review, full verification and
fresh clean-copy restore are still pending. Production/provider/RLS certification
limits in earlier evidence remain unchanged.

The strict-tooling refactor has started with `auth-route-session.ts`, extracting
password session rebinding, request context and restricted-session validation from
the existing router without changing route contracts. A targeted combined run also
exposed background PGlite WASM imports after Jest teardown. API setup hooks now await
the original process-global memory database initialization, including when suites
replace `db` with a separate fixture; they do not close database-owning fixtures
before those suites run their own cleanup. Production TypeScript excludes that
test-only setup alongside the existing managed-session fixture. All seven combined
suites, API lint and the final production runtime builds passed after the correction.

The 500-line audit still identifies oversized authentication router/service/schema,
sign-in, OpenAPI runner, several integration suites, workflow internals, shared DB
schema and Themis scripts. Continue splitting by the existing feature boundaries
before enabling the rule. Native Node TypeScript entry points and Angular route
`loadComponent` imports need the repository's documented explicit-extension handling;
do not blindly apply extension removal where the loader or route rules require it.

### Native PRF settings and session-custody cleanup

The settings route now composes a localized, accessible `VaultPasskeys` panel with
existing shared buttons and the route's purpose-bound confirmation UI. Existing
account passkeys can explicitly enroll/unlock/revoke the same vault key. Account
sign-in and vault unlock stay separate. Stale metadata, late confirmations and
destroyed views cannot mutate departing-owner custody. Passkey creation negotiates
PRF capability without enrolling vault custody or serializing extension output.

`VAULT_PRF_ENABLED=true` explicitly enables the public capability and PRF endpoints.
The default/example deployment value is false. Disabled PRF endpoints return 503;
they do not interfere with PIN/recovery routes. Unsupported authenticators fail
without a weaker fallback. A server capability does not certify every client or
physical authenticator. Browser delivery remains disabled pending its application UI.

Trusted API/realtime memory-session callbacks now erase requester relay ciphertext
and assertion challenges on session revocation/scope replacement. A dedicated
migration adds transactional PostgreSQL cleanup on session deletion/revocation,
authority/user/account/auth-version replacement and user auth-version changes.
Membership removal already cascades through the relevant foreign keys. Durable
PRF methods are not session-owned and are not erased by ordinary logout.

Focused verification (2026-10-04):

- `tmp/prf-native-final-e2e.log`: three native Chromium gateway scenarios passed:
  real PRF enrollment/unlock, recovery-key continuity, reload locking, PRF revocation
  without account logout, Spanish rendering and AXE; rejection of a native passkey
  without PRF while preserving PIN custody; and the existing real-Argon2 PIN scenario.
  Chromium's virtual CTAP2.1 authenticator supports PRF. Neither assertion HTTP nor
  PRF evaluation is mocked. This does not certify physical authenticator vendors.
- `tmp/prf-ui-app-tests.log`: 241 Angular tests passed with one intentional skip,
  including five panel regressions for disabled capability, grants, stale owners,
  duplicate enrollment and destruction.
- `tmp/vault-lifecycle-api-tests.log`: 24 PIN/PRF/relay/lifecycle tests passed with
  PGlite and PRF disabled, including the disabled route boundary.
- `tmp/vault-lifecycle-postgres-tests.log`: all 24 passed with PRF enabled against
  fresh disposable PostgreSQL 16; real triggers erase ciphertext on durable
  session/user-version changes. This remains a superuser fixture, not non-superuser
  RLS certification.
- `tmp/vault-lifecycle-runtime-tests.log`: focused session/push runtime regressions
  passed after connecting the additional cleanup callback (23 passed; seven
  explicitly PostgreSQL-gated cases skipped in this memory-only runtime run).
- `tmp/prf-ui-final-lint.log` and `tmp/prf-ui-final-build.log`: five-project lint and
  six-runtime production builds/dependencies passed. Both XLF catalogs parsed and
  `git diff --check` passed.

All isolated Redis/PostgreSQL containers, networks and the task-owned PostgreSQL
volume were removed. No production migration, commit, push or PR occurred. The
whole port still needs browser delivery UI, application sync/projections/reconciliation,
strict-tooling refactors, remaining source review and final whole-port verification.

### PRF assertion authority and signed browser relay follow-up

Adapted Nive's `vault-unlock/assertions.ts`, `store.ts`, `browser-enrollments.ts`
and signed browser delivery primitives to Stack's active account/user membership
model. PRF credential selection checks both user and account, not a personal-account
kind. Dedicated membership-backed/RLS tables hold assertion challenges, encrypted
PRF envelopes and temporary relay ciphertext. All routes inherit full-session,
CSRF and no-store middleware; method creation/revocation and relay approval also
consume a `vault_unlock_manage` grant.

PRF assertions require user verification and bind challenge, selected credential,
session hash, account, user and auth-version. Enrollment proofs expire after sixty
seconds, are single-use and must match every envelope binding field and PRF input.
Active method metadata excludes ciphertext. Revocation compares revisions and
assertions begun before revocation cannot return a removed method. HTTP contracts
reject PRF extension output rather than accepting browser-local secret material.

The route-owned `PrfUnlock` client verifies wrap/open before enrollment and erases
PRF output in `finally`, including wrong-credential, unsupported, late-cancellation
and departing-owner cases. Custody validates its PRF source again at installation
and on bounded authority refresh, dropping borrowers when that source disappears.
At this earlier verification point the client service was not yet wired into the
settings UI or native PRF scenario. The follow-up above completes that integration
behind an explicit opt-in capability.

Browser relay pairings sign owner/account/request/challenge/expiry and both recipient
keys. P-256 proofs, canonical encodings and 3072-bit RSA-OAEP/SHA-256 are enforced.
Delivery labels bind the recipient key and fingerprint as well as the complete
request context. Approval requires a different session; consumption requires a
fresh recipient signature and the original requesting session. Consumption,
cancellation and expiry erase relay ciphertext; expiry cleanup commits separately
so rejection cannot roll erasure back. The relay API and primitives are implemented,
and application enrollment UI remains pending. Session-revocation cleanup is now
implemented by the follow-up above; public config remains `browser: false`.

Focused evidence (2026-10-04):

- `tmp/vault-relay-api-tests.log`: 19 PIN/PRF/relay tests passed with PGlite.
- `tmp/vault-relay-postgres-tests.log`: the same 19 tests passed against disposable
  PostgreSQL 16 on isolated loopback port 25433. These exercise real migrations,
  transactions, shared PIN attempt serialization, CAS, membership cascades and
  relay erasure. WebAuthn signature verification in the PRF suite is mocked; relay
  signatures and ciphertext use real Web Crypto. This is not native PRF evidence
  or a non-superuser RLS certification.
- `tmp/vault-relay-app-tests.log`: 23 custody/client tests passed, including PRF
  revocation between assertion delivery and installation and active-custody removal.
- `tmp/vault-relay-all-app-tests.log`: complete Angular unit suite passed with
  236 tests and one intentional skip.
- `tmp/vault-relay-crypto-tests.log`: all 67 shared-crypto tests passed.
- `tmp/vault-relay-template-tests.log`: template infrastructure/tooling suite passed.
- `tmp/vault-relay-lint.log`: app, API, shared backend and shared-crypto lint passed.
- `tmp/vault-relay-build.log`: production app/API and dependency builds passed.

PostgreSQL test mutation requires `VAULT_UNLOCK_TEST_DATABASE_URL` to exactly match
`DATABASE_URL` and name a loopback `themis_api_e2e` database. Inherited `.env` is not
authorization. Fixtures remove only their recorded random user/account IDs. The
task-owned `visomi-port-prf-efd3` container, network and volume were removed; unrelated
containers were untouched. No production migration, commit, push or PR occurred.

### Application PIN and recovery custody follow-up

Adapted Nive's `vault-unlock/pin-profile.ts`, DEK-encrypted PIN verifier and browser
vault lifecycle to Stack's existing account/user membership model, without its
personal-account or financial snapshot dependencies. Added a dedicated migration,
user/account-scoped profile CAS, full-session/CSRF/purpose-bound grants, canonical
PIN revocation and a durable five-attempt/ten-minute budget shared across sessions.
The server cannot verify PIN success; no client-success reset endpoint exists.
This online budget does not prevent offline PIN attacks or hostile browser code.

Revocation retains the DEK-encrypted continuity anchor so reauthentication cannot
accidentally replace an existing encryption key. Browser enrollment remains local,
uses cross-tab locks and a cancellable dedicated worker, and verifies a wrap/open
round trip before persistence. Recovery export needs explicit reauthentication and
is browser-local. The new English/Spanish vault settings route composes shared
controls and Signal Forms and clears secrets on custody generation changes.
The owning layout starts/stops key custody; SSR always remains locked.

Root custody loads cryptographic schemas through `Deps`. The first production
attempt exposed eager full-Zod/shared-validator chunk retention and exceeded the
existing 1 MB budget; moving live operation validation behind `Deps`, with stale
socket/owner/watch checks, restored production builds without increasing budgets.
The initial bundle is now about 653.17 kB (a 3.17 kB warning above 650 kB), below
the pre-follow-up 669.08 kB result. Existing QR-code CommonJS warnings remain.

Verification: the real Chromium gateway scenario passed PIN creation/enrollment,
wrong/correct PIN derivation, reload locking, recovery of the same key, PIN
revocation, recovery after revocation, Spanish rendering and a clean AXE audit.
Its WebAuthn authenticator is virtual, but vault HTTP, storage and Argon2 are real.
All task-owned Redis/network resources were removed. Focused custody/layout tests
passed before the monotonic-clock test adjustment; 19 crypto PIN tests and five
API profile/budget tests passed before the retained-anchor revocation follow-up.
The final rerun passed all 227 Angular unit tests (one intentional skip), all 65
shared-crypto tests, all five API profile/budget tests, lint for app/API/shared/
shared-crypto/app-e2e and `git diff --check` after the retained-anchor and clock
adjustments. A subsequent run passed 26 focused custody/realtime tests and all 63
template tooling tests. The final native scenario additionally passed PIN change
and the following forced authority refresh without spuriously locking the freshly
enrolled method. Both XLF catalogs parse as well-formed XML. These focused passes
still do not cover the whole outstanding port.

Remaining vault implementation: PRF assertion/enrollment API and browser UI,
signed pairing/delivery relay and complete sync/projection integration. Config
explicitly advertises the pending PRF/browser methods as unavailable. Fresh real
PostgreSQL verification of the new PIN migration is also still required. See
`docs/template/vault-unlock.md`; this is not whole-port completion or authorization
to commit/push unfinished work.

### Incremental verification follow-up

At the user's request, imported the reusable verification changes in Nive
`671c92dd622dc86e83bb5a4a541133e8f1599daa` and the cancellation fix in
`1a5bfb52bea247e94848e8ec9ca68b119b4ccd84`. Product scrolling and shopping changes
from those or intervening commits are not part of this follow-up.

- Added `scripts/template/checks/{affected,selection,run-command}.ts`. Staged
  selection is read after autofixes, preserves deletions/renames, and feeds exact
  paths to Nx through stdin. CI range selection uses the base from the last green
  main run, not only the PR's latest commit.
- Owning Jest/Vitest suites use related files when safe; changed shared runtime
  dependencies retain full suites in Nx-selected consumers. Angular HTML/styles
  and visual/Jest snapshots map to their existing owning TypeScript/spec files.
  Configuration, deletion and unmapped asset changes retain complete coverage;
  runtime changes never use Playwright's test-import-only filter.
- `lint-staged.config.mjs` runs affected lint before Nx/Prettier formatting. Lint
  fixes exact selected files, not unstaged TypeScript companions. Rules under both
  `tools/eslint-rules/` and the existing `tools/eslint/` select full consumer lint.
  Deleted lint files are not passed to ESLint's exact-file mode. Filenames are
  quoted literally, and unsupported comma/newline paths fail closed.
- Hooks and CI share the runner, keep the daemon off, stop on failure, and limit
  each check to five minutes (25 for E2E). SIGINT/SIGTERM propagate to the owned
  process group and escalate after five seconds; interrupted checks exit 130/143.
- API integration Jest now runs out of process with its existing config and all
  runtime prerequisites. No `--forceExit` or hook bypass is introduced.
- Added gateway project dependencies on API, app, site, worker and realtime:
  build-task dependencies alone did not propagate app edits into the affected
  gateway/E2E graph. Real selection now includes the gateway's consumer suites.
- CI fetches full history, resolves Nx base/head, checks affected formatting,
  lint, typecheck/browser builds and tests, reserves integration for its service
  job, and only generates release inputs after an affected gateway build. The
  pinned MinIO fixture is available before affected and full E2E runs; scheduled
  and manual browser/durable matrix runs remain full checks.
- Adapted source entry points to Node's already-pinned native TypeScript loader
  instead of adding `tsx`. Template TypeScript uses Bundler resolution and includes
  nested check modules. No dependency, source secret or product fixture was copied.

Verification: `template:lint`, `template:typecheck` and all 61 `template:test`
cases passed. Real isolated-index runs selected and passed 12 edited native tests
and three related Angular button tests without modifying the user's index. A real
HTML-only dry-run proved companion-based unit selection plus full affected E2E
selection after the gateway graph correction. Real Jest related selection passed
two logger tests. The runner's real staged browser-spec selection passed both
notification gateway scenarios with its configured browser matrix and all build
prerequisites. Nx changed-file formatting and `git diff --check` passed.

API integration verification was initially blocked: two attempts at
`pnpm nx run api-e2e:test --args='--testPathPatterns=security-overview'` with an owned
Redis on 26379 and isolated gateway 18081 completed all build prerequisites, but
the gateway child failed bootstrap during Jest `globalSetup` before any test ran.
The first outer verification timed out at 120 seconds; the second failed with a
global-setup AggregateError after its port readiness wait. A standalone composed
gateway and the real Playwright gateway did boot, so this is recorded as an API
fixture verification gap, not as successful integration or a diagnosed regression.
No hook was bypassed, no commit/push was made, and no production resource changed.

### Isolated infrastructure and API fixture follow-up

The API bootstrap failure above is resolved. The default Jest fixture previously
inferred durable mode from inherited `DATABASE_DRIVER=pg` and
`OPAQUE_SYNC_STORAGE=durable` settings, including unrelated developer `.env`
configuration. `gatewayStorageEnvironment` now defaults to memory and requires
`API_E2E_STORAGE_MODE=durable` plus matching configuration to use external storage.
The durable runner sets this mode explicitly. OpenAPI uses the same isolation.
Fixtures bind their public base URL to their own listener and disable activation.

`gateway-process` rejects occupied listeners, checks health while monitoring the
owned child, fails immediately on child exit, cancels bounded HTTP requests and
cleans up only its detached process group. Cleanup escalates after five seconds
and waits for the child exit; resistant and already-exited children are covered.
Restart fixtures use the same lifecycle and do not implicitly run durable tests
from developer configuration. The new `api-e2e:fixture-test` target is a required
prerequisite of both API test entry points.

`compose.local-e2e.yaml` binds all exposed services to loopback and accepts
`API_E2E_MINIO_IMAGE`. Verification used the task-owned Podman Compose project
`visomi-port-efd3f1`, PostgreSQL 25432, Redis 27379, pinned MinIO 29000/29001,
gateway 18083 and restart child 18084. The existing unrelated container was not
stopped or modified. The first durable run correctly failed before applying
migrations; after explicit migrations to this owned database, it passed.

Verified:

- `api-e2e:test`: 24 tests passed, one explicitly durable restart test skipped in
  memory mode; the security-overview scenario also passed individually.
- `shared:test` with `SESSION_AUTHORITY_TEST_DATABASE_URL` pointing to the owned
  PostgreSQL: 14 session-authority tests passed, including all seven PostgreSQL
  lease/revocation cases previously skipped without infrastructure.
- `api-e2e:durable-integration`: ciphertext/object metadata/tombstones persisted in
  actual MinIO/PostgreSQL, one integration scenario passed.
- `api-e2e:test --args='--runTestsByPath apps/web/api-e2e/src/api/sync-restart.spec.ts'`
  in explicit durable mode: persisted enrollment/envelope replay survived a real
  gateway process restart, one scenario passed.
- `template:smoke --restore`: fresh renamed clean copy passed with PostgreSQL.
  Evidence at `tmp/template-smoke-vjVYqK/result.json` verifies schema/data
  fingerprints, migrations, password authentication continuity, restored encrypted
  object bytes and synthetic TOTP key continuity. This does not certify recovery
  of a full application vault, production escrow or provider failover.
- `template:test`: 62 tests passed; `api-e2e:fixture-test`: nine tests passed;
  focused API fixture lint and template typecheck passed.

The OpenAPI fixture additionally needed adaptation from legacy password signup
challenge IDs to session-bound `{ flowId, code }`, and from client `pinVerified`
claims to actual passkey signup proof/verification and strict enrollment inputs.
It retains negative coverage for client-supplied authority claims instead of
loosening production validation. `api-e2e:openapi` passed all 20 required HTTP
smoke assertions and three deterministic Schemathesis examples across two
operations, without the earlier missing-authentication warning. Failed smoke
observations now make the target fail rather than only writing a report. Jest
teardown uses the actual owned child handle, waits for termination and refuses
to act on a stale PID file. The full API suite passed again after these lifecycle
changes. Restarting the owned PostgreSQL container retained all 22 migrations.

### Packaged browser PIN worker

`app:vault-worker-assets` bundles the portable worker, Argon2/WASM and strict
contracts as a standalone browser module. Angular production builds copy it into
both localized asset roots; dependency-output hashing includes the worker in the
build cache key. No KDF is imported into the Angular main-thread or SSR entry.
The gateway allows `wasm-unsafe-eval` only on the exact worker asset response,
with `default-src 'none'` and `connect-src 'none'`. Ordinary pages and other assets
retain their previous policy without JavaScript `unsafe-eval` or WASM permission.

The native Chromium E2E scenario in `vault-worker.spec.ts` passed against the
production gateway: both localized assets are JavaScript and set no session
cookies; actual worker Argon2 derivation returns a structured-cloned,
non-extractable AES-GCM key, encryption/decryption succeeds and raw export fails.
The initial browser run correctly exposed CSP blocking WASM, which isolated unit
tests had not detected. Gateway scope/security regressions passed in the full
30-test server suite; server and app-e2e lint passed. This packages and verifies
the worker, but does not complete PIN enrollment, server-authoritative attempt
counters, recovery UI or integration with application vault lifecycle.

### Notification preference UI

The inbox now renders a current-account delivery preference using shared `Form`,
`Field`, `Label`, `Checkbox` and `Button` primitives. Signal Forms owns submission
and the conditional disabled state. The only submitted property is `servicePush`;
no endpoint, auth material, raw session ID or account override enters the request.
Copy explicitly distinguishes saving a preference from enabling device delivery:
`pushAvailable` remains false and subscription registration remains gated at 503.
Both English source and Spanish translation resources include the new copy.

The preference component remains mounted during same-owner inbox refreshes,
including realtime invalidation after its commit. Account changes discard the
old resource/component and cancel pending writes; destruction does the same.
Failures retain the user's choice for retry without showing success. Editing a
saved choice clears obsolete status/error feedback.

Verification: eight inbox unit tests passed, including preference payload,
label association, disabled/submitting state, retry and account/destruction
cancellation. The production localized Angular build and app/app-e2e lint passed.
The full Angular suite passed 205 tests with one existing activation skip.
The native gateway Chromium scenario saved a preference, reloaded to confirm
persistence, checked the Spanish screen and confirmed a different account starts
with its own default. It also retained notification completion/read coverage.
This removes the preference UI gap, not the Web Push delivery/subscription gap.

### Bounded Web Push outbox and transport

Added `push_deliveries` with account/user RLS, membership and cascading inbox/device
foreign keys. Notification creation and operation completion enqueue device work
atomically. Leased compare-and-swap claims bind a subscription revision, retain
deduplication receipts, cap retries at three and bound expiry to the session/device
and ten minutes. Cleanup is limited to 100 expired receipts per pass.

The shared delivery processor holds full-session authority and database shared
locks through a bounded send, rechecking membership/auth version, session binding,
preference, unread event, lease, revision, endpoint hash and stored browser keys.
Revoked authority fails closed; transient infrastructure errors retry within the
same limits. Expired vendor responses delete only the exact device revision.
The worker polls one delivery per pass independently of operation errors and
awaits its owned in-flight work at shutdown.

`web-push` prepares encryption and per-request VAPID credentials; the transport
uses manual redirects, a five-second/remaining-authority deadline, 60-second TTL
and content-free generic copy. Provider bodies are discarded and private response
errors are not logged. VAPID key-pair validation and environment variables are
implemented with transport disabled by default. Public registration still returns
503 and `pushAvailable` remains false pending browser subscription integration,
localized interaction and external-provider certification. Crash-after-acceptance
can repeat an alert: this is bounded at-least-once delivery, not exactly once.

Verification: 83 shared notification/operation tests, 11 worker tests, shared/worker
lint and production worker/dependency builds passed. The 18 outbox scenarios also
passed against a fresh isolated PostgreSQL 16 database with the real PostgreSQL
session store, including advisory-lock revocation serialization and RLS. Its
task-owned container, volume and network were removed afterward. API notification
and operation contracts passed all nine tests with explicit memory configuration;
the first chained run hit its aggregate deadline before those API tests completed.
No vendor network delivery, browser registration or production migration occurred.
The full shared suite subsequently passed 232 tests with seven opt-in PostgreSQL
tests skipped in its default memory run. App lint, eight inbox tests, the localized
production app build and `git diff --check` also passed. The app build retains its
initial-bundle warning (669.08 kB against a 650 kB warning threshold) and existing
QR-code CommonJS warnings; these are not whole-port completion evidence.

### Explicit browser Web Push enrollment

The previous Web Push public-registration gate is now replaced by validated
opt-in: default/example environments remain disabled; valid enabled VAPID
configuration advertises availability and the public key only. A full authoritative
session can register/remove its device, and read only its own registration boolean.
Foreign endpoint takeover, stale authority, CSRF and per-owner capacity remain
enforced. Invalid or disabled VAPID returns 503, not a partially enabled capability.

The localized `DevicePush` UI uses Angular `SwPush` and explicit consent, cancels
HTTP on owner changes/destruction, discards late permission results and cleans only
new subscriptions after aborted/failed enrollment. It never clears an existing
foreign registration after a conflict. Server removal precedes local unsubscribe.
Generic push copy comes from a dedicated English/Spanish JSON translation resource
and opens only the fixed localized inbox path. Non-bundled worker/realtime assets
now include that resource; the runtime uses a compatible CommonJS default import.

Verification: 14 Angular notification/device tests, nine API notification tests and
75 shared notification tests passed before the added localized-payload assertion.
The native Chromium enrollment scenario passed explicit registration, persistence
after reload and Spanish removal using real Angular `SwPush`, PWA worker and gateway.
Only `PushManager` was synthetic at the provider boundary; no notification was
produced after its test registration, and no vendor traffic was sent. Production
runtime dependency builds passed. All isolated Redis/network resources were removed.
External-provider delivery, OS permission/install behavior and deployment-specific
VAPID rollout remain operational verification, not certified by this browser fixture.

The full port still has the vault/PIN, sync-consumer and strict tooling implementation
gaps listed in the phase inventory; this follow-up does not declare those complete
or authorize publication of unfinished work.

- Hook behavior and regression strategy: Nive
  `scripts/template/pre-commit.spec.ts` and `.husky/pre-commit`.
- Resource-directory passthrough for clean-copy verification: Nive
  `scripts/template/smoke.ts`. Preserve `TMPDIR`, `NODE_COMPILE_CACHE`, and
  `NX_SOCKET_DIR` while continuing to isolate secrets and force the daemon off.
- Ingress support: `220a8cc` and `023e88d`.
- Persisted sessions: `315c91a`; session caching protection is applied to the
  template's existing unsplit auth router rather than importing unrelated routes.
- Direct passkey access: `e42d66e`; selected-credential feedback:
  `070ec99`. The initial block retained the email field; the continuation below
  removes it after adapting and verifying the full email-free entry slice.
- Key primitives: `c565482`, `84b0414`, `ed94e18`. The portable contracts remain
  in the existing `shared-crypto` library, avoiding an otherwise unnecessary
  `shared-common` project in this first block. Do not import Nive's device/finance
  runtime just to provide local session custody.

The new key-envelope AAD namespace is `visomi-vault-key-envelope-v1`, the
in-memory capsule namespace is `visomi-vault-session-capsule-v1`, and new
recovery strings use `stack1.` with canonical base64url. These are **new library
protocols**, not a migration of Nive ciphertext or a replacement for the
template's existing browser-vault format. Existing data is untouched.

## Security boundaries

- A successful account sign-in is not a vault unlock. No new server-side key
  custody or password-reset-based data recovery is introduced.
- A retained identity during temporary transport failure is only a UX hint.
  API authorization stays server-owned; forced session checks still reject
  failure and must succeed before releasing keys.
- Key wrappers bind owner, scope, method, credential/browser and generation.
  The fixed-profile Argon2id derivation is available through the separate
  `shared-crypto/vault-pin` entry, keeping WASM out of ordinary envelope/session
  imports. It does not authorize PIN enrollment or provide application worker/
  storage lifecycle, cooldown, shared PIN authority or UI integration. Do not advertise PIN unlock
  until its full integration lands.
- `VaultKeySession` clears its private byte copies and invalidates in-flight
  work after locking. Callers must clear their raw input/output buffers, enforce
  fresh purpose-bound reauthentication for recovery export, and drop borrowed
  `CryptoKey` references when locking. It cannot revoke already borrowed keys or
  defend against hostile JavaScript while unlocked.
- Local PIN envelopes must never enter cloud synchronization. Future browser
  storage must keep them in a separate, cross-tab-locked database.
- Push content must remain generic; never include decrypted product content.
  Subscription endpoints need the source vendor allowlist/SSRF boundary, session
  revocation and bounded network delivery before enabling production push.

## Validation matrix for the first block

| Category    | Required evidence                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `template:test`, focused `app:vite:test`, `server:test`, `shared-crypto:test`                                                                         |
| API         | Real session endpoint checks in auth E2E; no new request contract                                                                                     |
| App E2E     | Adaptive entry, sign-in, password fallback, review regressions, signup navigation and verification feedback                                           |
| Gateway E2E | Existing server suite plus ingress secure-cookie HTTP regression                                                                                      |
| Site E2E    | Not applicable: no site route/content changes                                                                                                         |
| Visual      | Method sheet screenshots across existing locale, viewport and theme matrix; review before completion                                                  |
| Security    | Key-binding substitutions, independent crypto vector, tampering, wrong keys, locked sessions, concurrent lock/replacement and forced session failures |
| Build       | `shared-crypto:build`; production `server,realtime,worker,api,app,site` builds; app typecheck                                                         |

All Nx commands require `fnm`-loaded Node and `export NX_DAEMON=false` in the
same shell invocation. No commit, push, database migration, production
deployment, or secret rotation is authorized by this port.

### Recorded verification

- `pnpm nx run template:test`: 35 passed, including gate failure propagation and isolated resource-directory passthrough.
- `pnpm nx run server:test --runInBand`: 23 passed, including real HTTP secure-cookie tests.
- `pnpm nx run app:vite:test --run`: 170 passed; one pre-existing activation test skipped.
- `pnpm nx run api:test --runInBand --testPathPatterns=auth-session`: 5 passed.
- `pnpm nx run shared-crypto:test --runInBand`: 37 passed, including PIN KDF and negative key/race tests.
- `pnpm nx run app:typecheck`: passed.
- `pnpm nx run shared-crypto:build`: passed.
- `pnpm nx run-many -t lint --projects app,app-e2e,server,shared-crypto,template --parallel=2`: passed.
- `pnpm nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production --parallel=2`: passed again after the final isolated PIN entry packaging change.
- Built-package probe: envelope/session exports load without loading `hash-wasm`; the separate PIN entry loads and validates PINs correctly.
- `pnpm nx run template:typecheck`: passed.
- `pnpm nx run template:smoke --memory`: passed after rerouting task-owned resource directories. Clean installation, renamed application initialization/idempotence, composed runtime build and smoke flow passed. This used PGlite; real PostgreSQL and object-store restore were not exercised.
- Chromium gateway E2E: adaptive entry (17), sign-in (5), password fallback (2),
  verification feedback (3), review regressions (2), signup validation (7): all passed.
- Firefox and WebKit password fallback: 4 additional checks passed.
- The adaptive-entry suite captured 12 locale/viewport/theme screenshots.
  Reviewed Spanish/mobile/light and English/tablet/dark captures; no clipped
  dialog controls or layout overflow observed. These are screenshot attachments,
  not a newly established visual snapshot baseline.

E2E used a task-owned Redis process bound only to `127.0.0.1:16379`, with no
persistence. Existing development Redis/database services and private `.env`
files were not modified. The resolved per-file targets accept Playwright
selection through `--args='--project=chromium'`, not Nx's reserved `--project`.

The first clean-copy smoke failed creating Nx plugin sockets because `/tmp`
had exhausted its inodes (`ENOSPC`), despite having free bytes. No unrelated
temporary files were deleted. Rerouting resources to task-owned workspace
directories fixed the environmental failure and exercised the upstream
resource-directory improvement:

```sh
export NX_DAEMON=false
export NX_SOCKET_DIR="$PWD/tmp/nxp-s"
export TMPDIR="$PWD/tmp/nxp-t"
export NODE_COMPILE_CACHE="$PWD/tmp/nxp-c"
pnpm nx run template:smoke --memory
```

The three directories were created with owner-only permissions before the run.
Successful smoke evidence is in `tmp/template-smoke-2B1pdZ`. All task-owned
gateway/worker/agent/Redis processes were stopped by their test teardown; the
separate Redis fixture was explicitly stopped after the E2E runs.

## Next independent blocks

1. Complete security lifecycle: PIN storage/worker application lifecycle and generic
   unlock/session API with migrations, integration and gateway E2E (local PIN
   storage and dedicated derivation worker are implemented, but not integrated). Finish the
   email-free entry/loading transition source slice separately.
2. Adapt durable operations and notifications together with their contracts,
   tenancy rules, revocation paths and tests; then wire optional Web Push/PWA.
3. Port generic localized email rendering and shared-shell/update controls.
4. Port tooling refactors alongside their strict lint rules and extensionless
   tool runner; verify clean template initialization, restore and CI fixtures.

Do not mark a phase complete solely because its library tests pass. In
particular, notifications, resilient synchronization and application vault
unlock are not implemented by this first block.

## Continuation: isolated local PIN storage

Branch: `feature/nive-platform-port`. Existing uncommitted port and UI/i18n
changes were preserved; no commit or push was made.

Source provenance: `../nive/libs/frontend/shared/src/lib/vault/unlock-storage.ts`
and its tests at the recorded source snapshot. Adapted to `shared-crypto`
contracts and the `visomi-vault-unlock` database/lock namespace. No upstream
database migration or financial record queue was copied.

Implemented in `libs/frontend/shared/src/lib/vault/unlock-storage.ts`:

- Strict consent/envelope/counter validation, including persisted records and
  canonical owner/scope partitions. Unknown secret fields fail closed.
- Atomic owner/scope replacement/removal, duplicate-method rejection and
  rollback on quota or asynchronous transaction failures.
- Explicit full-operation Web Lock and late-connection cleanup after blocked
  opens. Callers must hold the lock for the entire PIN attempt lifecycle.
- Public browser-only export with no Angular/backend dependency or Argon2 WASM
  import. `fake-indexeddb` is a development-only test dependency.

The storage does **not** enforce a cooldown policy, authenticate an owner, or
provide shared PIN authority. Same-origin callers can modify local counters;
this is not a server-side attempt limit. Application enrollment, worker
derivation, session validation, revocation and recovery integration remain
pending. The original browser-vault database and encrypted format are unchanged.

### Continuation validation matrix

| Category    | Evidence or applicability                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `frontend-shared:test`: storage validation, isolation, reopen, conflicts, lock/errors, quota/abort rollback and blocked opens |
| API         | Not applicable: no HTTP contract, endpoint or persistence schema change                                                       |
| App E2E     | Real Chromium `frontend-shared:browser-smoke`: two tabs serialize ten updates, reload preserves state and removal succeeds    |
| Gateway E2E | Not applicable: no gateway or application lifecycle integration                                                               |
| Site E2E    | Not applicable: no site route/content changes                                                                                 |
| Visual      | Not applicable: browser utility only, no rendered UI                                                                          |
| Security    | Strict secret-field rejection; partition isolation; fail-closed corruption/storage errors; PIN records absent from vault data |
| Build       | `frontend-shared:typecheck`, `frontend-shared:browser-build`; public entry bundles without Node polyfills                     |

### Continuation verification

- `pnpm nx run frontend-shared:lint --fix`: passed.
- `pnpm nx run frontend-shared:test --runInBand`: 23 passed, including nine
  new storage regressions and the existing vault/PRF suites. Two test-helper
  typing errors in an intermediate run were corrected before this final rerun.
- `pnpm nx run frontend-shared:typecheck`: passed.
- `pnpm nx run frontend-shared:browser-build`: passed; bundle metadata contains
  no `hash-wasm`, `fake-indexeddb`, or Node builtin imports.
- `pnpm nx run frontend-shared:browser-smoke`: passed, including real cross-tab
  Web Locks, ten retained updates, reload, separate database, no PIN envelope
  in vault records, and removal.
- `pnpm nx run shared-crypto:test --runInBand`: 37 passed (Nx cache replay).
- `pnpm nx run template:smoke --memory`: passed. Clean installation and renamed
  composed runtime build/flow evidence: `tmp/template-smoke-RJBTpx`.
- `git diff --check`: passed.

Native browser evidence: `tmp/browser-vault-smoke/result.json`. No real provider
deployment, PostgreSQL migration or production restore was performed.

## Continuation: cancellable dedicated PIN worker

Source provenance: Nive's `apps/web/app/src/app/finance/vault/pin.worker.ts` and
the dedicated worker lifecycle in `pin-unlock.ts`. Adapted into framework-neutral
`frontend-shared` modules rather than copying the finance-specific Angular
service, shared PIN profile API or vault session integration.

- `PinKeyDerivation` validates requests, creates a dedicated worker per attempt,
  correlates replies, checks genuine non-extractable wrapping keys, and
  terminates workers on completion, timeout, abort, errors or explicit cancel.
- The isolated `pin-worker.ts` entry validates untrusted input, rejects concurrent
  work, derives using the fixed crypto profile and returns sanitized errors.
- Ordinary public imports do not load the worker handler or Argon2 WASM.
- Local Jest/TypeScript configuration uses the existing linked package's
  `visomi-source` export condition for the isolated PIN entry. No new tsconfig
  alias or deep cross-library import was introduced. The typecheck target now
  checks both production and test sources; browser build checks both bundles.

The owning application must still instantiate/serve its worker asset, cancel
attempts on vault/session lifecycle changes, enforce authorization and shared
PIN authority, and count only authenticated-decryption failures as guesses.
No new enrollment or unlock UI is enabled. JavaScript PIN strings cannot be
reliably overwritten; never log or persist them.

### Worker validation matrix

| Category    | Evidence or applicability                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Unit        | Client cleanup, abort/timeout/errors, late replies, genuine key validation; worker malformed/busy/error handling    |
| API         | Not applicable: no HTTP endpoint or contract change                                                                 |
| App E2E     | Native `frontend-shared:browser-smoke`: actual module worker, key structured clone, repeated derivation and cancel  |
| Gateway E2E | Not applicable: application session lifecycle and gateway integration are pending                                   |
| Site E2E    | Not applicable: no site route change                                                                                |
| Visual      | Not applicable: no rendered UI                                                                                      |
| Security    | Non-extractable key, wrong-PIN decryption rejection, untrusted message validation, sanitized failures, cancellation |
| Build       | Production/test typechecks, independent main/worker bundles and renamed clean-copy template smoke                   |

### Worker verification

- `pnpm nx run frontend-shared:lint`: passed.
- `pnpm nx run frontend-shared:test --runInBand`: 32 passed, including nine new
  client/worker regressions and all existing storage/vault/PRF tests.
- `pnpm nx run frontend-shared:typecheck`: production and test sources passed.
  Intermediate errors exposed Node's untyped `CryptoKey` test constructor and
  legacy package-subpath resolution. The test setup now obtains the genuine
  constructor from a generated key, and NodeNext resolution matches Node 24's
  CommonJS/ESM behavior without adding a source alias.
- `pnpm nx run frontend-shared:browser-build`: independent main and worker
  bundles passed.
- `pnpm nx run frontend-shared:browser-smoke`: passed. Actual module worker
  structured-cloned a non-extractable key, repeated PIN derivation decrypted the
  same ciphertext, a different PIN failed authenticated decryption, and an
  explicitly cancelled attempt rejected. Existing vault/storage smoke remains
  green. Bundle-metadata assertions enforce Argon2 in the worker only.
- `pnpm nx run template:smoke --memory`: passed, with fresh installation and
  renamed composed runtime evidence in `tmp/template-smoke-R6uDYm` (template
  build replayed from Nx cache; smoke itself executed).

Browser evidence: `tmp/browser-vault-smoke/result.json`. No commit, push,
production deployment, PostgreSQL migration or production restore occurred.

## Continuation: integrated transactional email

Source provenance: Nive's `libs/backend/shared/src/lib/mail` and its three build,
preview and browser-check scripts. Adapted only verification, email-change and
recovery templates. Family invitations, reminders, mineral/forest branding and
financial copy were excluded. Application branding is passed from the existing
`template.json`-derived `APP_NAME`; templates contain no product-specific name.

The renderer is in the existing backend shared library. Strict build-time MJML
embeds trusted templates/catalogs into generated TypeScript so bundled runtimes
do not depend on loose template assets. Runtime Handlebars escapes HTML. Luxon
uses the selected mail locale with explicit UTC expiry display. Verification
codes, expiry, URL schemes/credentials and header-safe brand names are validated.
Notice links target existing routes and never carry verification/recovery tokens.

The API's existing memory and Mailgun delivery paths now share the renderer.
Saved recipient preferences select the locale; unknown recipients default to
English. Email-change verification and notices preserve the initiating user's
locale even though the new/old addresses do not resolve to the current profile.
The memory mailbox retains rendered bodies for assertions, without sending mail.
No public auth language field, production schema or database migration was added.

`handlebars` is declared both by the backend library and by the root runtime:
gateway E2E initially caught the missing root dependency in its externalized
production bundle; the dependency was added with pnpm and all gateway checks
passed on rerun. MJML and its typings remain development-only dependencies.

### Email validation matrix and evidence

| Category    | Evidence or applicability                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Seven renderer regressions; catalog parity, HTML escaping, header injection, invalid dates/codes/URLs, routing and UTC text |
| API         | Existing real-HTTP account/auth suites plus persisted email-change locale integration; no public contract change            |
| App E2E     | Chromium account-profile (4), signup-validation (7), password-fallback (2), verification-feedback (3): all passed           |
| Gateway E2E | The sixteen browser checks booted the actual composed gateway, worker, realtime, API, Angular and Astro runtimes            |
| Site E2E    | Not applicable: no site page or content changes                                                                             |
| Visual      | Twelve English/Spanish mobile/desktop email previews passed axe WCAG A/AA, heading and horizontal-overflow checks           |
| Security    | Escaping, header injection, token-free links, existing authorization/recovery/email-change race regression suites           |
| Build       | Backend shared and all six production runtimes passed; clean renamed template installation/build/flow passed                |

### Email recorded verification

- `pnpm nx run shared:emails-check`: passed all twelve previews. Reviewed
  `dist/email-previews/verification.es.375.png` and
  `dist/email-previews/recovery-notice.en.800.png`; no clipping or overflow found.
  These are review artifacts, not email-client certification or snapshot baselines.
- `pnpm nx run shared:test --runInBand --testPathPatterns=render-mail`: seven
  passed after fixing a test assertion to allow MJML's inline heading styles.
- `pnpm nx run shared:test --runInBand`: 147 passed, seven conditional tests
  skipped; no real PostgreSQL verification is claimed.
- `pnpm nx run api:test --runInBand --testPathPatterns='auth/|account/'`: 182
  passed, nine skipped in Redis/PostgreSQL-gated integration suites.
- `pnpm nx run api:test --runInBand --testPathPatterns=account-router`: eleven
  passed, including new-address and old-address locale preservation.
- `pnpm nx run shared:lint --fix` and `pnpm nx run api:lint --fix`: passed.
- `pnpm nx run shared:lint --args='../../../scripts/build-email-templates.ts ../../../scripts/preview-email-templates.ts ../../../scripts/check-email-previews.ts'`: passed, including the build/preview/check scripts.
- `pnpm nx run-many -t build --projects shared,server,realtime,worker,api,app,site --configuration production --parallel=2`: passed; one crypto build replayed from cache.
- Each recorded browser suite ran through its `app-e2e:e2e-ci--src/auth/<name>.spec.ts`
  target with `--args='--project=chromium'` and an isolated, nonpersistent Redis
  fixture at `127.0.0.1:16379`. Its task-owned process was stopped by an EXIT trap.
- `pnpm nx run template:smoke --memory`: passed. Fresh renamed copy evidence:
  `tmp/template-smoke-XRYYkX`; no production secrets or local service data copied.
- Prettier checks and `git diff --check`: passed.

## Whole-port completion gate remains open

The user's request to finish the entire reusable port does not make the remaining
phases complete. This branch is still uncommitted and the full port remains
unfinished. Explicit remaining implementation work is:

1. Application vault enrollment/unlock API, schema/migrations, authority/cooldown,
   recovery UI and session/storage/worker lifecycle integration.
2. Finish notifications after the account/user-scoped inbox, preference storage,
   atomic completion producer, HTTP contracts and localized route: subscriptions,
   bounded push worker/realtime wiring, revocation and preference UI. Durable operations
   are integrated with project seed; production PostgreSQL recovery remains unverified.
3. Application consumers and reconciliation UI for persistent resilient sync;
   the opaque-contract adapter/storage and native HTTP browser fixture are implemented.
4. Remaining independently useful shared-shell source review; shell titles,
   PWA/app updates and email-free passkey entry are implemented and gateway verified.
5. Strict lint/source refactors and remaining runtime/shell review. The pinned MinIO
   fixture and portable device-key delivery primitives are verified; no speculative
   product project has been added.

No commit/push/deployment, real provider verification or production database
migration was performed. Do not label the branch or entire phase inventory done
on the strength of library, email, or clean-copy tests alone.

## Continuation: persistent opaque queue and email-free entry

Source provenance: Nive's frontend shared sync storage/replay behavior, passkey-first
sign-in template, button toggle semantics, table regressions and mobile navigation
focus restoration. Adapted to the template's existing envelope and HTTP contracts.
No financial schemas, routes, table fixtures, palettes or family projections were copied.

### Synchronization behavior

- `IndexedDbSyncStateStore` persists canonical encrypted queues, cursor and
  tombstones in `visomi-encrypted-sync`, isolated by owner and workspace. Strict
  schemas reject extra secret fields, wrong partitions and cursor regressions.
- Entire adapter operations reload and run under native Web Locks, including
  transfers; quota/transaction failures preserve committed state.
- Acknowledged transfers are committed even if another transfer is offline.
  Transient failures retain exponential backoff; cancellation/401 stop without
  spending retries. Conflicts and permanent errors remain isolated for explicit
  reconciliation rather than silently replaying or deleting ciphertext.
- Pending revisions cannot be silently replaced with different ciphertext.
  Incoming deletions block already queued revisions to prevent resurrection.
- HTTP uses session credentials, no-store and a twenty-second deadline, with an
  optional lifecycle abort signal. Malformed batches and wrong-workspace records
  fail without advancing the cursor.
- Durable `pull(apply)` invokes an idempotent application callback, including
  deletions, before cursor commit. Application failure replays the batch. Legacy
  `pull()` remains available but is not durable consumer integration.

This is a verified reusable adapter, **not** application vault/session wiring.
Gateway authorization tests, caller lifecycle, durable decrypted projections and
conflict/reconciliation UI remain open. The native smoke uses an owned HTTP fixture,
not the production gateway or an authenticated database.

### Entry and shared UI behavior

- The initial passkey screen no longer asks for email. Password and recovery
  fields appear only after selecting those methods. Conditional discovery is
  cancelled before switching; no hidden email input was introduced.
- Credential waiting and successful navigation use live status text with a
  decorative reduced-motion-aware spinner instead of a disabled fake action.
  Alternate methods remain visible but disabled during selected-credential verification.
- Shared buttons support optional `aria-pressed` on their inner native control,
  preserving ordinary action, submit, loading and disabled semantics.
- Shared tables preserve mobile labels/exact text/dynamic rows while centering
  cells vertically and restricting dark hover/sticky backgrounds to their states.
- Mobile navigation restores focus to its opener on close, but never focuses a
  detached element after route navigation. Existing UI/i18n changes were preserved.

Select was compared with the source: production behavior is already equivalent,
including unconditional option projection, optional templates and late-option
synchronization. No redundant rewrite was applied. MinIO images are already pinned
and the local E2E Compose fixture is equivalent; real restore remains unverified.

### Recorded verification

- `shared-crypto:test --runInBand`: 53 passed, including lifecycle cancellation.
  An intermediate Jest realm mismatch exposed `DOMException` not inheriting the
  test realm's `Error`; abort-name classification was corrected and rerun passed.
- `frontend-shared:test --runInBand`: 36 passed, including persistence, owner/scope
  isolation, secret rejection, quota rollback and lock failure.
- `frontend-shared:typecheck`, both focused library lints and independent browser
  builds passed. Main-bundle isolation continues to exclude Argon2.
- `frontend-shared:browser-smoke`: existing native vault/worker checks and new
  two-tab encrypted sync HTTP checks passed. Evidence:
  `tmp/browser-sync-smoke/result.json` (four entries after reload, two sent, one
  blocked, one conflict, no automatic replay, other owner empty).
- `app:vite:test --run`: 178 passed, one pre-existing activation skip; `app:typecheck`,
  `app:lint` and `app-e2e:lint` passed. Two intermediate deferred-promise test
  assertions were corrected to wait for the observable completed state.
- Production builds for all six runtimes passed after the email-free entry change.
- Real Chromium gateway checks: adaptive-entry 17, sign-in 5, password-fallback 2,
  all passed. Locale/viewport/theme dialog captures and keyboard focus checks
  passed. The task-owned Redis fixture was stopped by an EXIT trap.

The whole port remains unfinished: application vault authority/recovery/lifecycle,
durable operations/notifications, remaining shell controls and strict tooling
adaptations are still required. No commit, push or production action occurred.

## Continuation: application updates and PWA

Source provenance: Nive's `ngsw-config.json`, `AppUpdates`, shell notice and public
asset gateway boundary. Adapted to the existing locale-scoped Angular deployment,
without importing Nive's notification worker or product branding. The installed Nx
Angular generator catalog contains no PWA generator; existing app configuration
was adapted without regenerating/overwriting its SSR, forms or i18n setup.

- Production registers Angular's worker only, under `/app/en/` or `/app/es/`.
  Development/SSR remain inert. Angular service-worker version matches core.
- Only static application assets and the CSR shell are cached. There are no data
  groups; `/api` is outside worker scope. Navigation prefers fresh server responses.
- The gateway serves public worker/assets before session initialization, preventing
  anonymous prefetch responses from overwriting newly authenticated session cookies.
  Worker/config/manifest/CSR control resources use `Cache-Control: no-cache`.
- `AppUpdates` checks on visible/online transitions and hourly, catches offline
  failures and removes subscriptions/timers/listeners with the owning layout.
  A ready-version notice provides an explicit reload action; no automatic reload,
  in-place activation, IndexedDB clearing or local-method reset occurs.
- The build generates a manifest from `template.json` plus deterministic generic
  192/512 PNG icons in `dist/pwa-assets`. No Nive icon or native image-build dependency
  is required. Clean template initialization updates install names automatically.
  `pwa-assets` cache inputs and application build inputs include the generator.
- English source copy and Spanish translations use the existing i18n resources.

### PWA validation and evidence

- `template:test`: 36 passed, including initialized manifest branding, no secret
  output, PNG signature/dimensions and deterministic reruns.
- `app:vite:test --run`: 183 passed; one pre-existing activation skip. Update
  service and shell tests verify explicit action, disabled/SSR behavior, offline
  retry, visibility gating, teardown and rendered notice.
- `server:test --runInBand`: 29 passed, including six real HTTP public-asset cases
  that bypass session creation while API requests still traverse it.
- Focused application/server/template/script lints and app typecheck passed.
  One initial script-lint invocation used the wrong cwd-relative path; the corrected
  `template:lint --args='../build-pwa-assets.ts' --fix` passed.
- All six production runtimes built successfully, with the new asset prerequisite.
- `app-e2e:e2e-ci--src/app/pwa.spec.ts --args='--project=chromium'`: passed,
  including native worker activation/control, PNG/manifest serving, freshness
  policy, anonymous-to-authenticated session reads, preserved local storage and
  zero API entries in CacheStorage. Final no-cache assertions also passed.
- Adaptive-entry's seventeen gateway checks passed again with PWA enabled.

Earlier clean-copy evidence before PWA: `tmp/template-smoke-TSl3Bo`. Final PWA
`template:smoke --memory` passed with clean renamed installation and composed
runtime evidence in `tmp/template-smoke-L5EhaU`. PWA asset generator typecheck
and the final native vault/worker/sync browser smoke also passed. Neither this browser
test nor a PGlite smoke certifies production rollout, OS installation, real
PostgreSQL/object-store restore or Web Push delivery. Notifications remain pending.

## Continuation: integrated durable operations and shell titles

Source provenance: Nive's `redis/operations.ts`, `db/operation-schema.ts`, API
operation contract/acceptance helpers, realtime operation watches and Angular
operation catch-up; shell `page-title.ts`, `page-titles.ts` and their tests.
Adapted at snapshot `070ec99`. No finance, family, invitations, inference runners
or protected plaintext result fields were imported.

The generic infrastructure is connected to the template's existing project-seed
API and worker rather than introducing a fake example endpoint. Acceptance and
the feature job commit atomically; optional UUID idempotency keys deduplicate
repeated requests. Persisted leases, bounded attempts, expiry and cleanup survive
transport failure. Session/account/version owner binding and fresh membership
checks protect HTTP reads. Workers revalidate full session authority, selected
account and routing before execution. Completion is persisted before pub-sub,
and failed Redis delivery cannot overwrite a committed result.

Realtime watches recover persisted state after reconnect, cap subscriptions and
release listeners on shutdown. Authority is reloaded both before and inside the
session lease, preventing delivery with an account snapshot that changed while
waiting. Existing project progress delivery now follows the same live authority
and project-access boundary. Angular's `AsyncOperations` adds validated HTTP
catch-up, explicit abort/expiry and request/watch/timer teardown. Browser account
changes drop previous watches. Zod Mini keeps validation without relaxing the
existing Angular bundle budget; an intermediate full-Zod build exceeded it.

The actual composed gateway exposed a memory-mode integration boundary: each
bundle previously created its own PGlite instance, and a spawned worker could
not see the API's database or memory sessions. Memory mode now shares a
process-global PGlite instance and in-process pub-sub, with a drained in-process
operation poll. PostgreSQL retains the separate worker. This does not make a
memory database persistent across process restarts. Operator guidance is in
`docs/template/async-operations.md`.

Shell-local `PageTitles`/`PageTitle` move existing translated title templates
into the layout header without copying source text or losing declaration
bindings and accessible IDs. Dashboard, activation, account, security, device
setup and sessions use the host. Standalone component callers retain their own
title; departing templates cannot clear the next route title. Auth/gallery
pages without the shell retain their existing headers.

### Integrated validation

- Angular: 193 tests passed; one pre-existing activation skip. Title teardown,
  standalone rendering, operation cancellation, HTTP catch-up, malformed results,
  reconnect and account-switch cleanup are covered. App typecheck passed.
- Backend shared: 155 passed with seven conditional skips before the additional
  non-owner-role RLS regression. Atomic acceptance, rollback, concurrent
  idempotency, ownership, revocation, stale leases, recovery, Redis failure,
  bounded attempts and expiration passed. The shared Nx test target now enables
  Jest VM modules for PGlite and includes migration files in its cache inputs.
- Real HTTP API: two integration checks passed for acceptance/deduplication,
  persisted jobs, cross-session `404`, anonymous rejection, UUID validation and
  OpenAPI parity. No production PostgreSQL migration was performed.
- Realtime: six tests passed for catch-up, malformed events, unwatch/shutdown,
  revoked authority and account changes while waiting for a lease.
- Worker: six tests passed before the additional successful-write recovery and
  failure-metadata regressions. Projects: five passed. Gateway: 29 passed.
- All six production runtimes built successfully. Eight focused project lints
  passed, including application and E2E changes.
- Native Chromium composed-gateway E2E: two passed, covering real execution,
  live completion, reconnect replay, repeated acceptance, separate-session
  isolation, logout disconnection and English/Spanish shell titles.
- PWA's native gateway regression passed again. The first invocation referenced
  a nonexistent `src/auth/pwa.spec.ts` target; the correct `src/app/pwa.spec.ts`
  target passed. An initial sign-out API probe lacked browser Origin headers;
  the regression now uses a genuine browser fetch without weakening CSRF checks.
- Clean renamed `template:smoke --memory` passed at
  `tmp/template-smoke-Q58YnB`. This is PGlite evidence, not PostgreSQL or restore
  certification. The mobile account-header capture was reviewed for clipping
  and overflow; it is a review attachment, not a new snapshot baseline.

The whole reusable port remains unfinished. Application vault/PIN/recovery and
durable sync consumers, account-scoped notifications/Web Push, strict tooling
refactors and the remaining personal-runtime/infrastructure review are still
implementation work. No commit, push or production deployment occurred.

## Continuation: portable recipient keys, pinned fixtures and notification inbox

Source provenance at `070ec99`:

- Nive `libs/shared/crypto/src/lib/personal-device.ts` and portable device
  contracts. Adapted into the existing `shared-crypto` package as strict pairing
  and recipient-bound recovery delivery. No finance client, intake commands,
  product request actions, ledger projection or personal-runtime project copied.
- Nive `scripts/minio-fixture.dockerfile` and CI fixture selection. The target
  `template:minio-fixture` builds source revision `07c3a429` only after its archive
  SHA-256 passes, and scheduled/manual durable API runs select the generic
  `visomi-minio-e2e:07c3a429` image. Development/production images are not silently
  replaced with this test fixture.
- Nive notification inbox, preferences and read API. Reworked for Stack's **account
  and user** boundary, rather than importing source user-only/family preferences.

### Recipient-key guarantees

- Private ECDSA P-256 and RSA-OAEP-3072 keys are non-extractable; public keys are
  serializable for pairing. Pairing proof and fingerprint bind client, challenge,
  expiration and both public keys under `visomi-device-pairing-v1`.
- New encrypted recovery delivery uses `visomi-device-key-v1` and binds owner,
  workspace, client, challenge and generation. Only canonical `stack1.` recovery
  material is accepted; wrong recipient, substituted bindings, weak RSA keys,
  malformed encodings and modified ciphertext fail closed.
- These are cryptographic primitives, not enrollment authority. The application
  must still enforce expiration, challenge consumption, membership and revocation.
  Existing encrypted-envelope formats and stored data were not migrated.

### Inbox integration boundaries

- New inbox/preference tables have account/user RLS and matching application
  filters with fresh membership checks. The newest-first HTTP feed is capped at
  100, uncached and contains fixed kinds/read state/UTC timestamps only.
- Durable-operation completion and its generic `service` inbox record commit
  atomically. A failed inbox insert rolls back completion; the same valid lease
  can recover. Replayed/stale workers do not duplicate inbox records.
- OpenAPI, CSRF-protected read/preferences mutations and the localized Angular
  route are integrated. Browser response validation uses Zod Mini. Read mutations
  and feed loads are cancelled on account change, logout and route destruction.
- Angular's resource loader does not abort its previous load when params become
  `undefined` in this installed version. The route uses a null-owner empty load
  to force cancellation; regression coverage asserts transport teardown and
  removal of old-account content.
- The HTTP regression also exposed selected-account membership revocation being
  reported as a service `500`. Passport now treats the specific missing-membership
  result as an invalid session, without swallowing transient database errors or
  switching silently to a different account.
- **Web Push remains disabled** (`pushAvailable: false`). Preference storage is
  intent only, not browser subscription or delivery. Vendor endpoint validation,
  session-bound subscriptions, capped leased retries, revocation, realtime,
  VAPID configuration and preference/subscription UI remain open.

Operator and contract guidance: `docs/template/notifications.md` and
`libs/shared/crypto/README.md`. Migration files were applied only to owned test
databases; no production database or external notification provider was touched.

### Recorded continuation verification

- `shared-crypto:lint`, `shared-crypto:test --runInBand` (58 passed) and build passed.
- Native Chromium vault/worker/sync smoke passed, including pairing proof,
  recovery round trip, wrong-recipient/binding rejection and non-extractable keys.
  Evidence: `tmp/browser-vault-smoke/result.json` and
  `tmp/browser-sync-smoke/result.json`.
- `template:minio-fixture` built successfully under Podman's Docker compatibility
  command and verified the archive checksum. This is build evidence, not restore
  or production deployment certification.
- `template:test` passed 37 tests; `template:lint` and `template:typecheck` passed.
- `shared:test --runInBand --testPathPatterns='notifications|operations'` passed
  13 tests, including non-owner RLS and atomic completion/inbox rollback recovery.
- `app:vite:test --run` passed 200 tests with one pre-existing activation skip
  after adding safe notification return destinations. App lint/typecheck passed.
- `api:test --runInBand --testPathPatterns='notification-router|operation-router|auth-session'`
  passed ten tests. The subsequent notification/session run passed nine tests,
  including an added transient membership-lookup failure/recovery regression.
- Full shared tests passed 162 with seven conditional skips; worker passed eight,
  realtime passed six, and API auth/account passed 182 with nine conditional skips.
- `server:build --configuration production` passed all eleven tasks after fixing
  a literal-type inference mismatch in the empty notification resource. Seven
  dependency tasks were reused from cache; the Angular production compiler ran.
- Native vault/worker/device/sync browser smoke was rerun successfully after the
  smoke script's ESLint statement-spacing autofix. Prettier checks and
  `git diff --check` passed at that point.
- Fresh clean-copy `template:smoke --memory` passed with evidence under
  `tmp/template-smoke-8wQqQs`. No local secrets or persistent services were copied.
- Notification Chromium E2E passed one scenario; durable-operation replay and
  translated shell navigation passed two. The initial launch failed because `/tmp`
  had no free inodes and another process owned port 8081. The retry used workspace
  temporary directories, owned Redis port 26379, gateway port 18081 and local-agent
  port 14318. Unrelated files/processes were left untouched.
- A later hang was traced to the local-agent setup accepting an existing fixture
  when its own child failed with `EADDRINUSE`, then waiting for an already-fired
  exit event during teardown. Setup now rejects an occupied fixture, bounds its
  readiness fetch, captures exit before polling and bounds owned-child shutdown.
  Gateway E2E subsequently completed in seconds, including teardown.
- A separate push-subscription contract now rejects non-vendor endpoints, URL
  aliases, credentials, explicit ports, queries/fragments, malformed base64url and
  invalid/off-curve P-256 public keys. Focused notification contract/storage tests
  passed 31 tests including additional owner-policy checks. This contract remains
  internal: no subscription endpoint or external delivery has been enabled.

## Continuation: authorized notification invalidation

- Added account/user-only committed hints and one session-bound realtime watch
  per socket. Operation completion, trusted direct producers, read mutations and
  preference writes publish after commit; hints contain no content and transport
  failures do not fail committed writes.
- Realtime reloads full persisted authority/membership under its existing lease,
  compares session/account/user/auth-version against the original watch, emits
  only an empty invalidation object and disconnects revoked or changed scopes.
  Invalid/foreign hints, duplicate watches, unwatch/disconnect while waiting for
  authority, and shutdown are covered by focused regressions.
- Angular validates empty invalidations, bounds route callbacks, re-registers on
  reconnect and cancels callbacks/requests on departing owner or route teardown.
  The inbox fetches authorized HTTP state rather than accepting socket content.
- `realtime:test --runInBand` passed nine; `app:vite:test --run` passed 202 with
  the pre-existing activation skip; `app:typecheck` passed. App/realtime/shared
  and E2E lint passed; shared notification/operation tests passed 42 after adding
  transport-failure, recipient validation and content-projection coverage.
- Fresh `server:build --configuration production` passed all eleven tasks (two
  dependency tasks cached). Notification Chromium E2E passed without clicking
  Refresh after production completion; the two operation/shell E2E scenarios
  passed again against that build.
- The mobile Spanish screenshot was inspected: no clipped controls or horizontal
  overflow was observed. Attachment:
  `dist/.playwright/apps/web/app-e2e/test-output/src-app-notifications-spec-ts/app-notifications-persists-3831f-olation-through-the-gateway-chromium/notifications-mobile-es.png`.
- Web Push remains unavailable. Realtime invalidation is not a push-subscription
  registration endpoint, delivery queue, VAPID configuration or provider proof.
- A second notification gateway scenario passed, proving content-free reconnect
  catch-up, preferences retained while disconnected, and no emission after sign-out
  (the socket is disconnected and HTTP reads reject with 401). Its preference
  mutation uses real browser fetch to preserve Origin/CSRF behavior; a request-only
  attempt correctly received 403 rather than bypassing that boundary.
- Final full shared run passed 192 tests with seven conditional skips after adding
  the denied-producer/no-hint regression. `template:test` passed all 37 again;
  API/shared lint, targeted Prettier checks and `git diff --check` passed. Task-owned
  ports 18081, 14318 and 26379 were confirmed free after teardown. No commit, push,
  production migration, deployment or secret rotation was performed.

## Continuation: session-bound push registration foundation

Source: `../nive/apps/web/api/src/notifications/router.ts` and
`../nive/libs/backend/shared/src/lib/db/notification-schema.ts` at `070ec99`.
Adapted rather than copied: the source's user-only/global endpoint rebind is not
retained. Registration binds account, user, full session and auth version; a
foreign endpoint cannot be silently reassigned. No family preference or product
navigation was imported.

- Added `push_subscriptions` with account/user RLS, composite membership foreign
  key, unique endpoint hash, one registration per session/owner, revisioned
  replacements and explicit expiry. Raw SIDs, vendor endpoints and authentication
  bytes remain sensitive infrastructure fields, never public inbox metadata.
- The internal store validates vendor URL/actual P-256 point/canonical keys before
  writing, holds persisted session authority, reloads owner scope and session expiry,
  and checks live database membership/auth version. Capacity is serialized under
  the existing user/session lease and capped at eight per account/user. Endpoint
  conflicts return sanitized errors rather than revealing a foreign registration.
- PostgreSQL cleanup triggers remove registrations atomically with session
  revocation/deletion/scope changes or auth-version updates. Membership deletion
  cascades cleanup. PGlite migration tests exercise triggers and non-owner RLS;
  this is not a real PostgreSQL process/restart certification.
- Memory store revocation/scope-change hooks are configured in API, realtime and
  worker initialization. Cleanup holds the SID lease and precedes scope publication;
  failure tombstones the SID. Late saves and registration queued behind revocation
  cannot revive authority. Account switching or restricted authority removes old
  registrations before the new scope becomes visible.
- Expiry cleanup runs in the operation worker, selects at most 100 expired records
  per pass, and rechecks expiry before removal to preserve refreshed registrations.
- Added uncached, CSRF-protected `DELETE /notifications/subscriptions` for scoped,
  idempotent removal. `POST /notifications/subscriptions` validates the input but
  deliberately returns 503; its OpenAPI contract has no successful-registration
  response. `pushAvailable` stays false and no browser permission prompt is enabled.

Verification for this continuation:

- Shared focused notifications/session suite: 58 passed, seven conditional
  PostgreSQL cases skipped; includes ten new registration/RLS/revocation tests.
- Notification HTTP suite: seven passed, including disabled public registration,
  key/endpoint rejection, CSRF and authoritative idempotent deletion.
- Worker suite: eight passed; realtime suite: nine passed.
- Production `server:build --configuration production`: all 11 tasks passed,
  including API, worker, realtime, Angular, Astro and migration consumers.
- Gateway Chromium notification suite: two passed (including subscription POST
  503/DELETE 204); operation/shell suite: two passed.
- Gateway Chromium sign-in suite: five passed after isolating HTTP mocks from
  service-worker interception. The initially failing retry and second-passkey
  scenarios were fixture interception failures, not accepted as green until rerun.
  Service workers remain enabled in the dedicated PWA suite and real notification
  and operation scenarios. All seven mocked auth suites passed on Chromium:
  sign-in (5), security translations (2), security actions (14), review regressions
  (2), verification feedback (3), signup validation (7), password fallback (2).
  Verification feedback also now selects recovery before entering an email and
  proves the entry route remains email-free while preserving an explicitly entered
  recovery email across Back, passkey failure and password-method selection.
- Dedicated real-worker PWA suite: one passed. Combined with the notification and
  operation suites above, this continuation verified 40 Chromium gateway scenarios.
- Angular one-shot `app:vite:test --run`: 202 passed, one existing skip. `app:test`
  is not configured; the resolved Nx target is `app:vite:test`.
- Fresh renamed clean-copy `template:smoke --memory` passed; evidence is
  `tmp/template-smoke-uCXXiz`. This exercised installation, production builds and
  composed memory runtime without copying local secrets or cached output; it does
  not certify PostgreSQL or production push delivery.
- Full shared suite and template suite passed; focused lint and `git diff --check`
  passed. No commit, push, production migration or deployment was performed.

Bounded leased delivery, delivery-time authority/revocation, VAPID,
preference/subscription UI, application vault/PIN/recovery, durable decrypted sync
consumers and strict tooling remain open. This foundation does not establish a
working Web Push feature or completion of the whole port.

The whole-port gate remains open. This continuation does not complete application
vault/PIN/recovery, durable decrypted sync consumers, full notification delivery,
strict tooling/source refactors or real-provider/restart/restore certification.
