# Persistence milestone implementation review

Reviewed 2026-11-16: VIS-65 through VIS-74, milestone **Persistencia SaaS,
zero-knowledge e híbrida**. All ten descriptions, relations and comment lists were
read after their 07:03–07:04 UTC update. A later refresh confirmed their descriptions
were unchanged. The user authorized autonomous implementation and reversible
technical decisions in this branch. Linear issues remain Todo; no remote status or
comment was changed. Independent security/product/privacy acceptance is a release
boundary, not a per-decision development approval requirement.

Branch: `codex/persistencia-saas-zero-knowledge-e-hibrida`, from updated `main`
commit `6f4582a9a38d95b627f819198d79670692a2548a`. The follow-up authorization permits commits, push and a ready-for-review PR for
Michael/Luma. Merge, deployment, live migrations, provider changes and public
privacy publication remain excluded. Reference repositories were read only.

## Implementation by issue

| Issue                                            | Implemented branch deliverable                                                                                                                                                                                                                                                                  | Acceptance/release boundary                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [VIS-65](https://linear.app/visomi/issue/VIS-65) | Strict neutral policies, classification/metadata/retention/quotas, compatibility rules, inventory, threat model and provisional ADR.                                                                                                                                                            | Product policy and protocol review; synthetic recovery does not select Nive policy.                                                                                     |
| [VIS-66](https://linear.app/visomi/issue/VIS-66) | Current verified sessions, separate memberships, inherited tenant/group/resource grants and blocks, additional record predicates, serialized mutations and composite FKs.                                                                                                                       | RLS is not claimed. Unimplemented external object/realtime/job adapters remain disabled.                                                                                |
| [VIS-67](https://linear.app/visomi/issue/VIS-67) | Opt-in Postgres/Drizzle SaaS CRUD, bounded list/search/export, CAS/idempotency/quotas, active-age filtering, scrubbed deletion, bounded physical purge/receipt expiry and actual isolated SQL restore.                                                                                          | Owner-only maintenance is explicit; scheduling, provider erasure/backups and live invocation remain operational release work.                                           |
| [VIS-68](https://linear.app/visomi/issue/VIS-68) | AES-GCM/HKDF, RSA-OAEP/P-256, strict contextual bytes and public independent Node fixtures, including recipient approvals.                                                                                                                                                                      | APIs may share an underlying crypto provider. Independent protocol review and native execution are not inferred.                                                        |
| [VIS-69](https://linear.app/visomi/issue/VIS-69) | PRF-only unlock, ciphertext IndexedDB, independently scoped keys/units, local budget, account/version/abort guards, cross-tab lock, SSR isolation and English/Spanish UI.                                                                                                                       | Physical authenticators and additional browser/OS combinations need device evidence. Cleanup is best effort.                                                            |
| [VIS-70](https://linear.app/visomi/issue/VIS-70) | Possession proof, five-minute consumed challenges, current device approval, recipient wrapping, signed client-verifiable witnesses, isolated local device custody, revocation/rotation, explicit synthetic user-held recovery, encrypted backup/restore and key deletion.                       | Recipient signing pins require a trusted approval channel. Product-specific recovery actors/consent remain unselected.                                                  |
| [VIS-71](https://linear.app/visomi/issue/VIS-71) | Private Postgres ciphertext transport, per-target streams, versions/CAS/idempotency/checkpoints/events/snapshots/tombstones, authenticated client pins, atomic IndexedDB commits, encrypted offline outbox, explicit conflicts and bounded history compaction with retained floors/gravestones. | Expired clients fail closed without resetting pins/outboxes. Automatic trusted-state bootstrap, external object storage and realtime are not enabled.                   |
| [VIS-72](https://linear.app/visomi/issue/VIS-72) | Fixed synthetic hybrid manifest, capability validation, compiled gateway integration, development/test-only example, separate readable operational note/private resource and explicit migration/disclosure guidance.                                                                            | No end-user mode switch or automatic migration. The example does not provide every administrative lifecycle UI; ports/API and consumer responsibilities are documented. |
| [VIS-73](https://linear.app/visomi/issue/VIS-73) | Real PostgreSQL/HTTP, native Chromium PRF/IndexedDB, two independent web clients, signed approvals, bidirectional ciphertext sync, old SQL restore rejection, privacy audits and application E2E.                                                                                               | Implementer testing is not independent security acceptance. Native platforms, production SLOs and provider operations remain unverified.                                |
| [VIS-74](https://linear.app/visomi/issue/VIS-74) | Consumer integration guide, unpublished privacy/onboarding/recovery template and localized functional blocking/limits copy.                                                                                                                                                                     | Processors, physical retention, contacts and applicable product/legal text require configuration and review before publication.                                         |

Dependency order was preserved: policy/authority and primitives preceded client
custody/lifecycle, opaque sync and hybrid composition. No old approval gate was
used to stop branch implementation.

## Executed evidence

### Luma follow-up: new-device enrollment after rotation

Luma's hypothesis was reproduced against commit
`2a1665e9b1a8961ca36da7f7597ab349e1fdff81` using the real authenticated API,
isolated PostgreSQL, native Chromium PRF/device custody, IndexedDB and `SyncReplica`.
A generation-one record, rotation to a distinct generation-two DEK, and a new
approved device receiving only generation two failed its initial pull with
`VaultError: corrupt`. The current-key-only vault and example validation could
not authenticate historical events. This was a confirmed development defect,
separate from the documented compacted-history release gate.

The reversible resolution is an explicit historical-key grant within the existing
signed recipient approval. Every retained replay generation must be granted to
that exact recipient or approval fails with `device_history_required`; bindings,
ordering, current sharing/device authority and the signed body are checked before
enrollment commits. The server stores only recipient ciphertext. Local historical
keys remain PRF-wrapped and are installed without allocating an old-generation
write budget. The example accepts supported, correctly scoped older envelopes
only through actual key authentication. A replica's explicit known minimum
generation/epoch prevents an initial rollback that historical AEAD alone cannot
detect. Full history authentication, durable checkpoints, revision fences and
explicit outbox acknowledgement are retained.

An authenticated snapshot was considered. It would additionally need trusted
complete-state enumeration, tombstone/revision completeness, fresh recipient-bound
attestation and atomic bootstrap rules. The existing retained-history path already
supports contextual replay, so explicitly authorized historical keys solve this
case with a smaller protocol change. No snapshot is trusted merely because it
came from the server, no ciphertext is re-encrypted/deleted by the server and no
live database or provider configuration changes are part of this fix.

The regression covers live old-generation data, an old tombstone, current-generation
data, missing history grants/keys, generation and epoch rollback, unchanged pending
ciphertext, a legitimate new-device write with authenticated acknowledgement,
and subsequent revocation/rotation excluding that device from generation three.
Additional tests cover multiple required historical generations, wrong/duplicate/
future recipient grants, unsigned or substituted ciphertext, trusted signing pins,
persisted read-only wrappers, and clearing plaintext/raw key bytes during lock races.
Three Angular consumer tests retain explicit future-generation/schema failures.
Active local binding selection rejects a server-selected historical wrapper when
a higher-generation wrapper is already present in the same local scope. The
native store test covers both allowed current selection and that rejection; the
Angular session test preserves the explicit error without falling back to an old
wrapper. No new database schema or live migration is needed for this check.
An additional native-browser regression reproduced a concurrent authentication
failure allowing another in-flight read to finish after the vault entered its
corrupt state. Non-quota authentication failures now invalidate the operation
epoch and cancel the unlock ceremony, so the original explicit error is preserved
and the concurrent read fails stale while clearing its plaintext/raw key copies.
The independent Node historical-grant fixture publishes exact signed body/label
bytes and distinct current/historical keys; both Node and WebCrypto verify it.

Initial fixture errors and one concurrent-load browser timeout were failed checks,
not passing evidence. No existing test, assertion, coverage threshold or test-body
deadline was removed or relaxed. The corrected complete local suites passed API
354 (all required coverage dimensions 100%), vault 65 and Angular 165. The complete
final workspace run passed **1,133 tests across all 12 projects** (20 test/dependency
tasks, 11 cached). All 41 static-check tasks passed (14 cached), including vectors,
and all six application builds passed (eight build/dependency tasks, four cached).
Final publication checks and exact-head CI evidence are recorded in the PR.

Release limits remain separate: these grants expose the history encrypted under
the explicitly granted scope keys, including older revisions. Products requiring
selective current-state disclosure need an authenticated complete-state bootstrap.
Compacted history still fails closed, delivery installation must precede its
supersession by rotation (otherwise fresh enrollment is needed), and distinct
historical wrapping credentials are not automatically recovered. No Nive recovery
policy, independent crypto audit, native client, production acceptance, merge,
deployment or live migration is claimed. See the
[full grant and custody contract](../architecture/contracts/persistence-keys-sync.md#enrollment-after-rotation).

Green evidence includes:

- Two actual Chromium clients against the authenticated API/private PostgreSQL:
  recipient possession/approval, trusted signing pin, key installation, writes in
  both directions, explicit stale-head conflict resolution, persisted-content and
  in-memory telemetry audits, and an older actual SQL dump/restore. The surviving
  newer checkpoint rejects the restored server. This is included in the final
  full API run, not just a mocked transport test.
- Actual Chromium PRF, independent device custody, two storage replicas, encrypted
  backup/recovery, explicit conflict resolution and a fresh rotated DEK delivered
  to multiple recipients with one unlock request. Public Node fixtures additionally
  verify exact signed-approval framing and recipient decryption.
- Application E2E: a real verified account, cloud note, PRF provisioning, offline
  encrypted queue, synchronization, locked reload, unlock/lock, sign-out, English
  and Spanish, keyboard activation and 390px layout passed in Chromium. Local
  screenshots were inspected. They show representative scroll positions inside
  the application shell, not a claim to capture every scroll state.
- Production Angular builds (both configured locales), standalone build, API and
  compiled gateway builds passed. Type/lint checks have been rerun as source evolved.

Earlier failures exposed a host PostgreSQL-client mismatch, strict-schema proof
projection, a default browser-test timeout under concurrent load, scoped CLI
argument/translation issues and an outdated compiled-export expectation. They were
fixed; failed attempts are not counted as passing checks. SQL tools now run in the
owned container, browser integration has an explicit bounded timeout, and
native/private fixture material is synthetic.

### Baseline verification before follow-up review

Historical checks on 2026-11-16 before the retention follow-up (superseded by the final follow-up evidence below):

| Suite                | Passed tests | Required coverage result                       |
| -------------------- | -----------: | ---------------------------------------------- |
| `web-api`            |          344 | 100% statements, branches, functions and lines |
| `web-shared-vault`   |           58 | No coverage certification claimed              |
| `web-app`            |          161 | No coverage certification claimed              |
| `shared-persistence` |           37 | No coverage certification claimed              |
| `backend-shared`     |           35 | 100% statements, branches, functions and lines |
| `web-gateway`        |          154 | 100% statements, branches, functions and lines |
| `dev-testing`        |           79 | 100% statements, branches, functions and lines |

All seven suites passed: 868 tests in total. The separate Chromium application
E2E passed one hybrid scenario covering the states above. Types passed all 14
configured targets across eight projects; lint passed those eight projects.
`vectors-check` passed. Drizzle generation reported **no schema changes** after
the two additive migrations, and isolated migration tests passed. No live database
was migrated. Final formatting, local documentation links and `git diff --check`
were checked; formatting-only changes do not alter the tested behavior.

Reproduction commands (the workspace supplies installed executors/versions):

```sh
pnpm nx run web-api:test --maxWorkers=2 --hookTimeout=120000 --output-style=static
pnpm nx run web-shared-vault:test --maxWorkers=2 --output-style=static
pnpm nx run web-app:test --output-style=static
pnpm nx run-many -t test -p shared-persistence,backend-shared,web-gateway,dev-testing --parallel=2 --maxWorkers=1 --hookTimeout=120000 --output-style=static
pnpm nx run-many -t typecheck,typecheck-tests -p shared-persistence,web-shared-vault,backend-shared,web-api,web-gateway,web-app,web-app-e2e,dev-testing --parallel=3 --output-style=static
pnpm nx run-many -t lint -p shared-persistence,web-shared-vault,backend-shared,web-api,web-gateway,web-app,web-app-e2e,dev-testing --parallel=3 --output-style=static
pnpm nx run web-shared-vault:vectors-check --output-style=static
pnpm nx run backend-shared:db-generate --output-style=static
pnpm nx run web-app-e2e:e2e:auth --args='--project=auth-chromium --grep=hybrid' --output-style=static
```

The E2E run also built both configured Angular locales, standalone/API and the
compiled gateway. Relevant final runner logs were retained locally in
`/tmp/visomi-*-final-verification*.log`; synthetic UI screenshots remain under
`dist/.playwright/apps/web/app-e2e/auth-output/`. These are local development
artifacts, not published evidence or a substitute for independent review.

## Follow-up implementation review

Michael authorized Luma to coordinate independent review and authorized publication
of commits and a PR for review. This review is still by the implementer, not an
independent cryptographic audit. All original test cases/assertions were preserved;
fixture operation IDs and migration/export expectations were updated to the actual
provisional contract. No coverage thresholds, security assertions or failing cases
were removed to obtain a pass.

| Finding                                                       | Priority | Resolution and evidence                                                                                                                                               |
| ------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deleting receipts can execute an old create again             | High     | Immutable UUIDv7 issuance time, bounded retry window and conservative receipt expiry; expired, future, legacy and exact-retry cases tested                            |
| Compaction can erase a client's proof of continuity           | High     | Atomic monotonic floor/checkpoint, contiguous aged-prefix checks, explicit `sync_history_expired`, no pin/outbox reset; PostgreSQL and native Chromium negative tests |
| Removing tombstones can revive deleted object revisions       | High     | Ciphertext is scrubbed only behind the retained floor/horizon; minimal revision gravestones remain and reject stale creates                                           |
| Opaque `activeDays` was accepted without authenticated expiry | High     | Composition now rejects it; the server never fabricates a client-authenticated tombstone                                                                              |
| SaaS expiry hid content without physically removing it        | Medium   | Explicit owner-only bounded scrub/grace/purge, exact scope/domain predicates and no client retention override                                                         |
| Unit/API native browser tests need their own CI browser       | Medium   | Install the pinned Playwright Chromium in the verification job; execute public vector checks in CI                                                                    |

The [retention contract](../architecture/contracts/persistence-retention.md)
records alternatives, limits, compatibility and why an expired client cannot trust
a server-supplied reset. The chosen expired-horizon behavior is a functional block,
not an automatic full-replica bootstrap. A product needing fresh-device sync after
compaction must supply independently trusted complete state before enabling that
operation. No trusted full-replica transfer UI is claimed. This is an explicit
adapter limitation, not an invented Nive policy or an independent-audit finding.

Final commit verification also exposed extra blank lines emitted by import
fixers after the hook's initial Prettier pass. A final file-scoped Prettier pass
now follows ESLint in lint-staged. This preserves both checks and makes committed
bytes match CI formatting; hooks were not bypassed.
The two new source aliases are also classified explicitly in import ordering,
matching the existing testing-alias convention, so root hooks and project tasks
resolve their groups consistently. No import or module-boundary rule was disabled.

The first authenticated push attempt ran the existing pre-push hook and exposed
a migration-test timeout under default concurrent file execution. It did not
publish the branch. The previously green bounded-worker commands were not the
hook's execution profile. Heavy PostgreSQL/browser suites now explicitly cap file
workers at two, matching their verified profile; the existing 60-second migration
budget and all assertions remain unchanged. The migration test also forwards
Vitest cancellation to its owned PostgreSQL setup and child migration process.
No hook, test case, timeout failure or coverage gate was bypassed.
The subsequent default-profile run passed all 352 API assertions but exposed two
legacy teardown hooks using Vitest's 10-second default. Only those disposable
container cleanup hooks now share their existing setup budget of 120 seconds;
test-body deadlines and security assertions remain unchanged. A timed-out cleanup
is still a failed suite, not a pass.
The repeated push then passed all 20 test/build tasks, but its E2E phase did not
publish the branch. A separate gateway run confirmed the existing 600-second
container-readiness timeout. An isolated streamed build exposed a 556.7 MB build
context containing local caches, including 735 MB of allocated Angular cache.
Excluding `.angular`, `.codegraph` and `.qmd` reduced the next context to 1.237 MB.
The interrupted diagnostic/push attempts are not counted as green E2E evidence;
the final per-project and published-head results are recorded separately in the PR.

After the context fix, the push hook passed all 16 compiled API E2E cases and all
six compiled gateway E2E cases. It then stopped on the site's performance-intake
assertion: background reports from the preceding pages exhausted the unchanged
120-request global budget, returning 429 instead of 202. The isolated case passed.
The site's existing telemetry cases now run in a prerequisite Playwright project
before the remaining pages generate that background traffic. All 99 cases and
their assertions remain; the production intake limiter and its rejection tests
are unchanged. The failed full-suite attempt is not recorded as a pass.
The next full run confirmed the telemetry cases but found the same 429 in the
native-button case's unchanged empty-console assertion. That case now uses the
existing `disablePerformanceCapture` fixture, as the shell/catalog/bundle-budget
checks already do, so dedicated telemetry cases own the opt-in traffic. No
console error is filtered or ignored.
The complete repeated site suite passed all 99 cases with those fixtures.

### Final follow-up verification

The following counts describe the earlier retention follow-up. The later Luma
enrollment review and its final verification are recorded above and in the PR.

Full local suites after the retention fixes passed **1,121 tests** across all
12 projects with a test target: API 352, web vault 59, neutral contracts 40,
Angular application 161, frontend UI 14, backend shared 35, gateway 154,
development testing 79, web backend shared 169, browser observability 34,
realtime 4 and edge 20. API/backend/gateway/development and the other configured
coverage gates passed unchanged; the API reports 100% statements, branches,
functions and lines. No native-app coverage or independent audit is inferred.

All 41 configured static-check tasks (lint, application/test types, email artifacts,
deployment scripts and vectors) across 14 projects passed. All six configured
application builds passed, including both Angular locales and compiled API/gateway.
Drizzle generation reported no remaining schema changes; the isolated migration
suite applied/reapplied all eight migrations, including the three from this branch.
Formatting and local documentation links were checked. No live migration ran.

The complete authentication/E2E matrix passed **279 tests with 20 configured
skips** in 8.7 minutes (`--fail-on-flaky-tests`), across Chromium/Firefox/WebKit.
The new private PRF scenario runs only in Chromium; the existing browser/capability
skips are not claims of private-adapter compatibility elsewhere. Local synthetic
screenshots remain under the test output directory. Exact published-head GitHub
Actions results are recorded separately in the PR after remote verification; local
success is not a substitute for that check.

Final local runner evidence is retained in `/tmp/visomi-publish-*.log` (tests,
static checks, builds and auth E2E). The full-suite API run also includes the
missing-cursor compaction negative case. The earlier filtered API attempt passed
its 17 selected tests but intentionally could not satisfy whole-project coverage;
only the subsequent full green run is counted. Formatting/blank-line failures
were corrected without relaxing lint. Nx's transient lint-flakiness label followed
an overlapping formatting pass; the stable full static run passed.

Reproduce the full local checks with:

```sh
pnpm nx run-many -t lint,typecheck,typecheck-tests,emails-check,deployment-check,vectors-check --parallel=2 --output-style=static
pnpm nx run-many -t build --parallel=2 --output-style=static
pnpm nx run-many -t test -p web-shared-observability,dev-testing,shared-persistence,web-backend-shared,web-shared-vault,backend-shared,web-realtime,web-gateway,web-edge,web-api --parallel=2 --maxWorkers=2 --hookTimeout=120000 --output-style=static
pnpm nx run-many -t test -p web-frontend-ui,web-app --parallel=2 --output-style=static
pnpm nx run web-app-e2e:e2e --configuration=auth --args='--fail-on-flaky-tests' --output-style=static
```

CI installs the workspace's pinned Chromium before native vault/API unit tests;
the E2E job installs its own browsers independently. Public vector verification
now runs in the affected static-check phase. Published-head CI, including container
and selected E2E jobs, must be checked independently of these local results.

## Limits and rollout/rollback

Unresolved decisions and evidence have explicit owners; none authorizes a live
action or silently changes the implemented confidentiality model:

| Boundary                       | Missing decision or evidence                                                                                                                  | Resolution owner                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Protocol acceptance            | Independent review of framing, delivery witnesses, recovery, nonce accounting and rollback; severity/findings must be recorded before release | Security reviewer independent of this implementation                                   |
| Nive recovery                  | Recovery actors, custody, consent and authority after loss of every signing identity                                                          | Product owner; synthetic interfaces do not select these                                |
| Live operation and public text | Provider retention/backups, production configuration, processor identities and applicable privacy wording                                     | Authorized operations/product/privacy owners, with separately granted live permissions |
| Additional clients/devices     | Physical authenticators, browser/OS coverage and any future native implementation                                                             | Maintainers of the actual supported runtime                                            |

The first adapter uses private PostgreSQL rather than provisioning an object store.
Authorization is checked on every read/write; there are no public object URLs or
unprotected domain notifications. Background jobs, external storage and realtime
are unsupported composition capabilities until implemented with the same checks.

Current hard budgets include 1 MiB plaintext per crypto unit, a 2 MiB encrypted
HTTP request/pull-page ceiling, bounded page/roster/challenge counts, per-domain
scope bytes/units, 100 units/16 MiB per encrypted backup batch, and a local 2^20
per-generation encryption reservation counter. Restored/recovered wrappers are
read-only until rotation, preventing an honest restore from resetting that local
counter. Independent review must settle the global multi-device nonce/accounting
bound; no unlimited random-nonce safety or measured production throughput is claimed.

For review, keep the example off by default and use only synthetic isolated
resources. Deployment would require reviewed policy/crypto, actual compatible
clients, provider/retention configuration, backup/restore rehearsal and monitoring
capture policy. This task does not authorize those live actions.

Rollback disables the example/composition without downgrading readers or deleting
ciphertext. Additive schemas can remain while the feature is off. Do not run a
reverse migration that destroys encrypted data or discard client pins/outboxes to
make an older restore appear current. Test restoration into an isolated DB, then
reconcile generations, membership, receipt history and trusted checkpoints before
any separately authorized promotion.

First use or total loss of every trusted client anchor cannot prove server freshness.
A compromised served web bundle/device can access unlocked content. Revocation
cannot erase copied keys/plaintext. Native Swift/Kotlin/desktop applications do not
exist here and were neither implemented nor declared compatible. Hardware devices,
screen readers and all browser/OS combinations have not been certified.

See the [ADR](../architecture/adr/persistence-saas-zk-hybrid.md),
[crypto framing](../architecture/contracts/persistence-v1.md),
[key/sync contract](../architecture/contracts/persistence-keys-sync.md),
[consumer guide](../persistence.md) and
[unpublished privacy draft](../privacy/persistence-template.md).
