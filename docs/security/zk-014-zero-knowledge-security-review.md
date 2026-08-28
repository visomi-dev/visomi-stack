# ZK-014 Zero-Knowledge Security Review

**Review status: BLOCKED for production architecture and pending independent sign-off**
**Current disposition run:** `RUN-197` (evidence-gap correction; functional evidence is reused from `RUN-196`)
**User-mandated constraint:** this review is intentionally conducted with **no sprint**. The absence of a sprint is not an acceptance defect, planning gap, or release finding.
**Scope:** Phase 0, envelope/crypto proof, local vault, opaque sync, device lifecycle, migration, product visibility, capabilities, execution, MCP/secret broker, telemetry, and release controls.

## Executive decision

The reviewed slices demonstrate useful fail-closed proofs, but they do not establish a production zero-knowledge trust boundary. Production release remains blocked by the unresolved critical/high findings below, legacy plaintext containment, release advisory disposition, and the open architecture decisions. This report records review evidence and disposition only; it does not implement remediations.

The cloud/API path returns metadata-only project projections and rejects new protected text writes (`libs/projects/src/lib/projects-service.ts:45-75,147-153,226-235,274-280`). The opaque sync router validates envelope shape and device authorization without decoding ciphertext (`apps/web/api/src/sync/opaque-sync-router.ts:204-263`). These are positive transition controls, not proof that legacy plaintext has been deleted. `SEC-001` is now independently accepted for its capability-signature, authenticated visibility handshake, protected-data policy, redaction, and nonce/key lifecycle controls (`RUN-172` / `REVW-131`). `WEB-001` is independently accepted for the read-only operational backlog visibility slice (`RUN-182` / `REVW-136`). `SYNC-001` remains in progress because its latest run records missing durable API restart and opaque-sync integration prerequisites (`RUN-181`). Legacy plaintext/tombstone closure and production sign-off remain blocked.

## Current implementation and evidence disposition (`RUN-197`)

The accepted `SEC-001` evidence confirms that the gateway sends a nonce/origin/session-bound challenge, verifies the Ed25519 response before forwarding JSON, rejects forged or replayed responses, and fails closed when the agent key is unavailable (`RUN-172`, `REVW-131`). The accepted `WEB-001` evidence confirms the protected, read-only backlog/workspace route and its state/deep-link/screenshot coverage (`RUN-182`, `REVW-136`). These accepted slices are evidence of bounded controls, not production approval of the complete encrypted workspace architecture.

The `SYNC-001` gate remains **unresolved**. Its latest run (`RUN-181`, failed) records that the durable API restart fixture lacks `DATABASE_URL` and `OPAQUE_SYNC_S3_ENDPOINT`, and that durable integration fails MinIO bucket setup with HTTP 403. The fresh `RUN-184` durable integration rerun reproduces the HTTP 403. Until those prerequisites are supplied in an isolated runtime and the real multi-user/multi-device API lifecycle is independently verified, durable sync, restart, revocation/recovery propagation, and ciphertext-only storage remain unproven. The zero-plaintext migration/tombstone gate remains release-blocking until independently reviewed redacted inventory evidence is current. `RUN-196` is reused for the completed functional matrix and is not used to infer security closure.

The fresh app/API checks also do not clear the gate. The OpenAPI contract command completed its selected 76/76 cases but retained authentication warnings; the required sync restart/durable API check failed at MinIO bucket setup. The full app E2E command did not complete within the 120-second execution window, so its result is **incomplete/blocked**, not passed; the focused visibility rerun is separate evidence and does not substitute for the full route matrix. Security remains **FAILED/BLOCKED** because durable storage, zero-plaintext/tombstone, recovery, and release-control closure are not independently evidenced.

## Accepted and unresolved work-item map

| Item       | Current evidence                                                                                                                                                                                                                                     | Disposition                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SEC-001`  | Accepted `RUN-172` / `REVW-131`: unit 125/125; API/OpenAPI 76/76; app E2E 96/96; gateway 5/5; visual PASS; security/raw scans PASS; lint/typecheck/production builds/plan fidelity PASS; clean release gate PASS and expected tamper rejection PASS. | Accepted implementation slice; it does not close `SYNC-001`, migration, or production sign-off.                                |
| `WEB-001`  | Accepted `RUN-182` / `REVW-136`: real OpenAPI 76/76; broad app E2E 96/96; gateway 5/5; visual 12/12; targeted security 5/5; affected lint/typecheck/build PASS; site E2E N/A because no public Astro behavior changed.                               | Accepted read-only visibility slice; it does not establish encrypted sync durability or production readiness.                  |
| `SYNC-001` | Failed `RUN-181`: restart lacks `DATABASE_URL` and `OPAQUE_SYNC_S3_ENDPOINT`; durable integration fails MinIO bucket setup with HTTP 403.                                                                                                            | Unresolved and release-blocking. Keep the item in progress; do not replace the failed evidence with earlier passing summaries. |

The current report matrix is recorded below. `RUN-197` preserves the failed/incomplete observations rather than converting them to passes, while reusing `RUN-196` only for its completed functional evidence. Security remains failed/blocked because `SYNC-001` evidence is unresolved; no critical finding is accepted as risk.

## Current eight-category validation matrix

| Category    | Exact command/check                                                                                                                                                                                                                                                                                                                      | Observed result and artifact/evidence location                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `pnpm exec nx run shared:test --skip-nx-cache -- --runInBand`                                                                                                                                                                                                                                                                            | **PASS**, 21 suites / 125 tests. Report: `coverage/libs/shared`; command run in `RUN-184`. This proves reviewed shared controls only and does not close durable sync.                                                                                                                                                                                                                                                                                                                                         |
| API         | `pnpm exec nx run api-e2e:openapi --skip-nx-cache`; `pnpm exec nx run api-e2e:durable-integration --skip-nx-cache`                                                                                                                                                                                                                       | OpenAPI **PASS**, 76/76, with 2 authentication warnings; JUnit/HAR: `dist/test-results/api-e2e/openapi/junit-20260824T015343Z.xml`, `dist/test-results/api-e2e/openapi/har-20260824T015343Z.json`. Required durable API/storage check **FAILED**: `Opaque object bucket setup failed (403)` after migrations; report: `dist/test-results/api-e2e/durable-integration/`. The category is **FAILED/BLOCKED** for the sync lifecycle. Commands run in `RUN-184`.                                                 |
| App E2E     | `pnpm exec nx run app-e2e:e2e --skip-nx-cache`                                                                                                                                                                                                                                                                                           | **INCOMPLETE/BLOCKED**: the full 96-test command exceeded the 120-second execution window while running; no full-suite pass is claimed. Output/report: `playwright-report/`, `dist/.playwright/apps/web/app-e2e/`; focused `--grep @visibility` rerun passed separately but cannot substitute for the incomplete full matrix. Command run in `RUN-184`.                                                                                                                                                       |
| Gateway E2E | `pnpm exec nx run server-e2e:e2e --skip-nx-cache`                                                                                                                                                                                                                                                                                        | Composed gateway checks passed for accepted `SEC-001` (5/5) and `WEB-001` (5/5), but this does not clear the failed sync durable-runtime prerequisite. Playwright report: `playwright-report/`; Themis evidence: `RUN-172`, `RUN-182`.                                                                                                                                                                                                                                                                        |
| Site E2E    | Exact check: no public Astro route or behavior changed in this review                                                                                                                                                                                                                                                                    | Not applicable, with written reason preserved in `RUN-172` and `RUN-182`; no site behavior is being claimed.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Visual      | `pnpm exec nx run app-e2e:e2e --skip-nx-cache -- --grep @visual`                                                                                                                                                                                                                                                                         | **BLOCKED/INCOMPLETE** under the fresh full app run: the full Playwright process exceeded the execution window before deterministic visual completion. Existing accepted snapshots remain historical evidence (`RUN-172`, `RUN-182`) and are not a fresh production sync sign-off. Snapshots: `apps/web/app-e2e/src/__snapshots__/`; report: `playwright-report/`.                                                                                                                                            |
| Security    | `THEMIS_RUN_ID=RUN-197 node --experimental-strip-types scripts/retain-raw-corpus-scan.ts dist/test-results dist/apps dist/logs dist/queues dist/telemetry dist/evidence playwright-report apps/web/app-e2e/playwright-report apps/web/app-e2e/src/__snapshots__ artifacts .themis`; plus the prior security checks recorded in `RUN-196` | Raw corpus scan **PASS**: observed `filesScanned=777`, `findings=[]`, exit 0. Manifest: `dist/test-results/e2e-001-security/raw-corpus-scan.json`; checked-in copy: `docs/security/zk-014-raw-corpus-scan.json`. The manifest enumerates every artifact with surface, path, byte count, and SHA-256, and records absent-by-design PostgreSQL/S3 export surfaces. This closes the prior evidence-retention gap only; durable sync, zero-plaintext/tombstone, recovery, and release controls remain unresolved. |
| Build       | `node --experimental-strip-types --test scripts/plan-fidelity.test.ts`; `pnpm exec prettier --check docs/security/zk-014-zero-knowledge-security-review.md`; `pnpm run release:gate`                                                                                                                                                     | Plan fidelity **PASS**, 5/5; report formatting **PASS**. Release gate **FAILED** (fail-closed output); expected tamper rejection remains a required PASS condition and is not relabeled as a validation failure. Artifacts: `dist/test-results/release/`; commands run in `RUN-184`. This report does not clear production release.                                                                                                                                                                           |

The focused plan-fidelity check for this report contract is: `node --experimental-strip-types --test scripts/plan-fidelity.test.ts`. It must be rerun by the verifier after this artifact update; it does not override the unresolved security result.

## Retained raw corpus scan (`RUN-197`)

The complete pre-sanitization corpus was rescanned in `RUN-197` with the exact command shown in the Security matrix. The observed result was `PASS`, `filesScanned=777`, `findings=[]`, and exit code `0`. The manifest records the run ID, start and finish timestamps, command, every scanned artifact, surface membership, byte count, SHA-256 checksum, and explicit absent-by-design reasons for external PostgreSQL and S3 exports. Attach and inspect the exact paths, not a summary or count-only evidence:

- `dist/test-results/e2e-001-security/raw-corpus-scan.json`
- `docs/security/zk-014-raw-corpus-scan.json` (checked-in reviewer-visible copy)

The functional app/API/gateway/unit/visual/build evidence is reused from `RUN-196`; this scan rerun addresses only the missing reviewer-visible raw corpus artifact and does not convert any unresolved security or release control into a pass.

## Severity-ranked findings and closure gates

The following findings preserve the approved severity model while reflecting the
current disposition. Earlier proof-only wording is historical context and is
not a current claim that these controls are absent or production-approved.

### CRITICAL-01 — Capability signatures are not verified

**Evidence:** Accepted `SEC-001` evidence (`RUN-172` / `REVW-131`) verifies issuer-bound Ed25519 signatures, key rotation/revocation, expiry, replay, and fail-closed behavior. The production gate still requires durable custody and independently reviewed deployment configuration.

**Reproduction/closure check:** run the `SEC-001` signature and forged/replay negative suite and inspect the raw security report before sanitization; the accepted result is recorded in `RUN-172` security evidence.

**Disposition:** implementation slice accepted by `SEC-001`; production release remains blocked until custody, rotation, and deployment provenance are independently approved. Critical findings are not accepted risks.

### CRITICAL-02 — Browser visibility transport has no authenticated local-agent handshake

**Evidence:** Accepted `SEC-001` evidence (`RUN-172` / `REVW-131`) covers origin/session/nonce/device binding, response proof, forged/replay rejection, and fail-closed gateway forwarding. `WEB-001` visibility evidence is accepted separately (`RUN-182` / `REVW-136`).

**Reproduction/closure check:** run the accepted gateway/app negative cases for forged, replayed, unavailable, and origin/session-mismatched responses; retain the raw reports referenced by `RUN-172`.

**Disposition:** `SEC-001` control accepted; complete production sign-off remains withheld pending the unresolved sync, migration, and release gates below.

### HIGH-01 — Sync, device, session, and revocation state is process-local

**Evidence:** `SYNC-001` remains unresolved. Its latest failed run (`RUN-181`) records blocked durable API restart configuration and MinIO bucket setup HTTP 403. Earlier passing summaries do not close this finding because the latest required durable-runtime evidence is failed.

**Reproduction/closure check:** run the real HTTP multi-user/device lifecycle and independent API restart fixture with `DATABASE_URL` and `OPAQUE_SYNC_S3_ENDPOINT` supplied from a redacted configuration source; verify restart, revocation, recovery, replay, tombstone, and tenant isolation.

**Disposition:** release-blocking and unresolved under `SYNC-001`; keep the work item in progress until the failed prerequisites and complete lifecycle evidence are independently closed.

### HIGH-02 — MCP output classification cannot distinguish protected plaintext

**Evidence:** Accepted `SEC-001` evidence (`RUN-172` / `REVW-131`) adds protected-data classification and deny-by-default MCP/projection enforcement, with negative disclosure checks.

**Reproduction/closure check:** run the accepted protected-projection and disclosure-negative suite and inspect raw responses/logs; the accepted result is recorded in `RUN-172` security evidence.

**Disposition:** implementation slice accepted by `SEC-001`; durable audit and complete production release controls remain gates.

### HIGH-03 — External-AI approval is a broad boolean

**Evidence:** Accepted `SEC-001` evidence (`RUN-172` / `REVW-131`) requires named provider, projection, fields, purpose, retention, consent, and local output validation. No external provider was introduced.

**Disposition:** implementation slice accepted by `SEC-001`; external-AI remains default-deny and no provider integration is approved by this report.

### HIGH-04 — Recovery is unavailable and all-device key loss is unrecoverable

**Evidence:** `LocalEncryptedVault.recover()` throws `VaultRecoveryBlockedError` (`libs/shared/src/lib/crypto/local-encrypted-vault.ts:150-152`); ADR 004:110-112 leaves recovery actors/quorum open.

**Disposition:** accepted only for the proof; production-blocking and assigned to `SYNC-001` (in progress). `SYNC-001` must produce approved recovery actors/quorum, key rotation, all-device-loss, deletion, and re-enrollment behavior with durable restart and stale-device evidence. `DEPLOY-001` must then verify the production configuration and rollback/recovery boundary. No recovery decision is accepted by this report.

### HIGH-05 — Legacy server-readable plaintext remains in durable columns

**Evidence:** the schema still defines `projects.summary`, `project_documents.content_markdown`, and `async_jobs.input_json`, `result_json`, and `error_message` as text (`libs/shared/src/lib/db/schema.ts:120-174`). The migration inventory identifies these as protected fields and says they are retained with their tables (`docs/architecture/system/encrypted-product-migration.md:7-12`). `libs/projects/src/lib/projects-service.ts:125-183,195-235` still accepts/queries project summaries, and document/job services and seed/runtime paths remain the owning legacy seams. Metadata-only response mapping is containment, not deletion.

**Reproduction (static, no secret data required):**

```sh
pnpm exec nx graph --file=/tmp/themis-zk014-project-graph.html
rg -n "summary: text\('summary'\)|content_markdown|input_json|result_json|error_message" libs/shared/src/lib/db/schema.ts
rg -n "projects\.summary|project_documents\.content_markdown|async_jobs\.(input_json|result_json|error_message)|summary: data\.summary" libs apps
```

The first search proves the durable plaintext-shaped columns exist; the second proves their legacy ownership/read-write seams remain. A deployed database check must additionally run against a production-like snapshot without printing values:

```sql
SELECT 'projects.summary' AS column_name, count(*) AS rows_with_value
FROM projects WHERE summary IS NOT NULL AND length(summary) > 0
UNION ALL SELECT 'project_documents.content_markdown', count(* )
FROM project_documents WHERE content_markdown IS NOT NULL AND length(content_markdown) > 0
UNION ALL SELECT 'async_jobs.input_json', count(*) FROM async_jobs WHERE input_json IS NOT NULL
UNION ALL SELECT 'async_jobs.result_json', count(*) FROM async_jobs WHERE result_json IS NOT NULL
UNION ALL SELECT 'async_jobs.error_message', count(*) FROM async_jobs WHERE error_message IS NOT NULL AND length(error_message) > 0;
```

**Deletion/containment gate:** production release and migration closure are blocked until (a) all protected writers are frozen and the durable migration ledger is transactional, (b) an account/project-scoped inventory records zero protected values in these columns and in secondary queues, realtime payloads, logs, fixtures, and backups after the approved verification window, (c) deletion/tombstone evidence is independently reviewed without exposing values, and (d) the approved retention/deletion and recovery policy records the final exception handling. Until then, keep metadata-only reads, reject protected plaintext writes, quarantine malformed/unavailable rows, and treat every non-zero query result as a release-blocking finding. No deletion or product remediation is implemented by ZK-014.

**Disposition:** release-blocking migration finding. Closure is jointly mapped to `ZK-008` (destructive migration, writer freeze, ledger, tombstones, and redacted inventory), `SEC-001` (redaction, disclosure, and protected-data enforcement), `SYNC-001` (durable deletion/revocation/recovery propagation and non-resurrection), and `DEPLOY-001` (production migration, backup/restore, release provenance, and deployment configuration). Every protected location must have independently reviewed zero/absent-by-design evidence; any non-zero or unverified result remains blocking. This report implements none of those remediations.

### MEDIUM-01 — Migration ledger can be process-local

`MigrationLedger` defaults to a `Map` (`libs/shared/src/lib/crypto/encrypted-project-migration.ts:130-152`). It is documented as test-only, but production construction does not enforce durable persistence. **Disposition:** remediate before historical deletion.

### MEDIUM-02 — Runtime error logging is not proven content-safe

`libs/shared/src/lib/http.ts:64-80` logs the complete unknown error object. Release fixture scans do not prove runtime redaction. **Disposition:** remediate before production; add stable error-class and correlation-ID logging tests.

### MEDIUM-03 — AEAD nonce uniqueness is not integrated with the vault

The opt-in in-memory `NonceReuseGuard` is not used by vault random-nonce writes (`crypto-proof-harness.ts:104-119`, `local-encrypted-vault.ts:154-181`). **Disposition:** remediate or approve a durable nonce-generation invariant before cryptography sign-off.

## Concrete blocker-to-work-item disposition

This actionable map addresses `REVW-137`; statuses are current Themis
statuses, not claims that a dependency is complete.

| Blocker/control                                                  | Concrete work item(s)                                                               | Current disposition                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL-01 capability signatures/custody                        | `SEC-001` (done), `DEPLOY-001` (planned)                                            | Control proof accepted in `SEC-001`; production custody/provenance remains a deployment gate.                                                     |
| CRITICAL-02 authenticated browser/local-agent handshake          | `SEC-001` (done), `SYNC-001` (in progress)                                          | Handshake slice accepted; durable sync/session/device propagation remains unresolved.                                                             |
| HIGH-01 durable sync/device/session/revocation/audit             | `SYNC-001` (in progress), `DEPLOY-001` (planned)                                    | Release-blocking; latest restart and opaque-sync integration evidence failed in `RUN-181`.                                                        |
| HIGH-02 protected MCP/projection classification                  | `SEC-001` (done)                                                                    | Accepted control slice; durable audit and production release controls remain open.                                                                |
| HIGH-03 named external-AI projection/consent                     | `SEC-001` (done), `DEPLOY-001` (planned)                                            | Default-deny control accepted; no provider or production approval is granted.                                                                     |
| HIGH-04 recovery, quorum, rotation, and all-device-loss          | `SYNC-001` (in progress), `DEPLOY-001` (planned)                                    | Unresolved production blocker; recovery is not accepted by this report.                                                                           |
| HIGH-05 plaintext migration, tombstones, and secondary locations | `ZK-008` (done), `SEC-001` (done), `SYNC-001` (in progress), `DEPLOY-001` (planned) | Migration/control slices exist, but current durable sync evidence and independently reviewed production-like zero inventory are unresolved.       |
| MEDIUM-01 durable migration ledger                               | `ZK-008` (done), `SYNC-001` (in progress)                                           | Proof exists; production durability/restart evidence remains tied to the failed sync gate.                                                        |
| MEDIUM-02 runtime redaction and retention                        | `SEC-001` (done), `DEPLOY-001` (planned)                                            | Focused redaction proof accepted; deployment telemetry/retention approval remains open.                                                           |
| MEDIUM-03 nonce/key lifecycle                                    | `SEC-001` (done), `DEPLOY-001` (planned)                                            | Focused invariant proof accepted; custody and production configuration remain release gates.                                                      |
| RELEASE-01 dependency advisory disposition                       | `ZK-013` (done), `DEPLOY-001` (planned)                                             | Untriaged critical/high advisories require authorized triage, owner, deadline, and any approved time-bounded exception; no exception is recorded. |
| RELEASE-02 provenance and production key custody                 | `ZK-013` (done), `DEPLOY-001` (planned)                                             | Release provenance, catalogue attestation, signing-key custody, and distribution/rollback evidence remain required and unapproved.                |
| RELEASE-03 telemetry retention and runtime redaction             | `SEC-001` (done), `ZK-013` (done), `DEPLOY-001` (planned)                           | Focused redaction proof exists, but production telemetry retention and deployment evidence remain open.                                           |

## ZK-001 decisions and open items

| ZK-001 decision/open item                                      | Evidence                                                    | Owner                               | Disposition at RUN-197                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Local agent is root of trust; cloud is ciphertext orchestrator | ADR 004:7-11,21-30; ZK-006 opaque sync                      | Security architect / agent owner    | Adopted target; production proof blocked by HIGH-01/02 and legacy plaintext.                             |
| Metadata visibility/minimization                               | ADR 004:49,56; ADR 005:44-46; migration:66-72               | Product + security owner            | Open: approve exact IDs, names, timestamps, sizes, status, labels, padding, and readers.                 |
| Recovery actors/quorum and all-device loss                     | ADR 004:47,51,110-112; ADR 007                              | Security owner                      | Open; HIGH-04 production blocker.                                                                        |
| Product read architecture/offline/browser compromise           | ADR 004:71-73,112; repository map:43                        | Product + platform owner            | Local-agent-mediated direction accepted; handshake/packaging/offline behavior open; CRITICAL-02 blocker. |
| Device enrollment and revocation                               | ADR 004:113; ADR 007; ZK-007                                | Device/platform owner               | Process-local proof only; durable/offline semantics open; HIGH-01 blocker.                               |
| Activity privacy and approved projections                      | ADR 004:45,114; migration:68-72                             | Product + security owner            | Metadata-only containment; field-level policy open.                                                      |
| External-AI providers, consent, retention                      | ADR 004:79-81,115; ADR 009                                  | Security + product owner            | Default deny; named-provider/projection policy open; HIGH-03 blocker.                                    |
| Retention, deletion, tombstones, cryptographic deletion        | ADR 004:48-51,116; migration:33-36,62-64; opaque-sync:16-21 | Data lifecycle owner                | Open; HIGH-05 and deletion gate block closure.                                                           |
| Key hierarchy, rotation, historical versions                   | ADR 004:47,117; ADR 006; ADR 011:51-62                      | Key-management/security owner       | Open; proof vectors are not production custody or rotation.                                              |
| Cloud search and indexing                                      | ADR 004:118; ADR 005:75; opaque-sync:8-18                   | Product/search + security owner     | Open; no plaintext indexing approved; choose local projection, blind index, or reduced metadata.         |
| Phase 0 acceptance authority                                   | ADR 004:119,121-131                                         | Named human security/product owners | Open; this report is blocked pending independent sign-off and does not claim it.                         |

## ZK-001–ZK-013 artifact, evidence, owner, and disposition map

| Item/artifact                | Evidence reviewed                                                                                            | Owner                         | Disposition                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ZK-001 / ADR 004             | ADR 004; RUN-001/REVW-001                                                                                    | Security architect            | Accepted Phase 0 foundation; open decisions above remain gates.                                                                |
| ZK-002 / repository seam map | `docs/architecture/system/zero-knowledge-repository-map.md`; RUN-002/REVW-002                                | Architecture owner            | Accepted map; unresolved seams remain review inputs.                                                                           |
| ZK-003 / envelope contract   | ADR 005; `encrypted-envelope.ts` and specs; RUN-004/REVW-004                                                 | Crypto/contract owner         | Accepted contract proof; metadata, retention, tombstones, and product-read choices open.                                       |
| ZK-004 / crypto vectors      | ADR 006; crypto proof harness/specs; RUN-005 and verifier evidence                                           | Crypto owner                  | Proof pass only; production KDF, nonce lifecycle, custody, rotation, and recovery open.                                        |
| ZK-005 / local vault         | `local-encrypted-vault.ts` and specs; RUN-006/REVW-006                                                       | Agent/vault owner             | Proof accepted; recovery/key-loss and durable storage block production.                                                        |
| ZK-006 / opaque sync         | `opaque-sync.ts`, router/specs, `opaque-sync.md`; RUN-007/REVW-007                                           | Cloud sync owner              | Opaque boundary accepted; process-local durability/revocation blocks production.                                               |
| ZK-007 / device lifecycle    | `device-identity.ts`, router/specs, ADR 007; RUN-008/REVW-008                                                | Device owner                  | Lifecycle proof accepted; durable audit and offline revocation open.                                                           |
| ZK-008 / encrypted migration | `encrypted-project-migration.ts`, migration spec/system doc; RUN-009/REVW-009                                | Data migration owner          | Transition containment accepted; legacy columns and deletion gate remain HIGH-05.                                              |
| ZK-009 / product visibility  | local-agent visibility adapter/specs; RUN-010/REVW-010                                                       | Angular/platform owner        | Cloud fallback removed; unauthenticated loopback handshake is CRITICAL-02.                                                     |
| ZK-010 / capability security | ADR 008; `capability-policy.ts`/specs; RUN-011/REVW-011                                                      | Capability/security owner     | Structural policy proof only; signature verification is CRITICAL-01.                                                           |
| ZK-011 / MCP and broker      | ADR 010; MCP/broker sources/specs; RUN-012/REVW-012                                                          | Agent integrations owner      | Secret-return denial useful; protected-plaintext classification and durable audit open.                                        |
| ZK-012 / execution policy    | ADR 009; `execution-policy.ts`/specs; RUN-013/REVW-013                                                       | Execution/security owner      | Default-deny proof; external projection/consent and retention controls open.                                                   |
| ZK-013 / release assurance   | ADR 011; `scripts/release-verification.ts`, `release-gate-fixture.ts`, CI workflow, RUN-027–031/REVW-021–025 | Release/build/security owners | Gate integration accepted; audit advisories, provenance attestation, key custody, telemetry retention remain release blockers. |

The RUN/REVW identifiers above are repository-control-plane evidence references, not claims that ZK-014 itself received independent sign-off. ZK-014 remains blocked until an independent reviewer validates this report.

## Reproducible release audit and advisory disposition evidence

The aggregate count is not used as clearance. Reproduce the audit from the locked dependency tree with:

```sh
pnpm audit --json
pnpm audit --json > /tmp/themis-zk014-pnpm-audit.json
node -e "const r=require('/tmp/themis-zk014-pnpm-audit.json'); console.log(JSON.stringify({metadata:r.metadata,vulnerabilities:Object.fromEntries(Object.entries(r.vulnerabilities||{}).filter(([id])=>id.startsWith('GHSA-')).map(([id,v])=>[id,{severity:v.severity,via:v.via}]))},null,2))"
```

The recorded 2026-08-18 result was **2 critical, 46 high, 52 moderate, and 11 low across 2,276 resolved packages**. Critical advisory disposition is explicit: `GHSA-23hp-3jrh-7fpw` and `GHSA-xv26-6w52-cph6` are **untriaged and release-blocking**, owned by the security owner with a 2026-08-25 deadline and no exception. The high advisory IDs and release-blocking/untriaged disposition are recorded in ADR 011:87-103; release owner/build owner triage is due 2026-09-01, with only a documented, compensating, time-bounded security-approved exception permitted after triage. This report attaches the command and advisory mapping rather than treating counts as evidence of safety.

The reproducible, redacted audit disposition is checked in at [`release-audit-2026-08-18.json`](./release-audit-2026-08-18.json). It contains the command, package total, severity totals, unique critical/high advisory IDs, owners, deadlines, and blocking/exception policy without package paths or secrets.

Also reproduce the configured generated-artifact gate:

```sh
pnpm release:gate
pnpm exec nx run server:build
pnpm exec nx run shared:test -- --runInBand
```

The gate is fail-closed for malformed manifests, invalid signatures, catalogue failures, protected plaintext in generated inputs, and artifact mismatch. CI intentionally runs a tamper/protected-plaintext failure case; those failures are expected security evidence, not a passed release. Production remains blocked pending real provenance attestation, production key custody/distribution, telemetry retention approval, and advisory dispositions.

## Control-by-control conclusion

| Control                   | Result                              | Disposition                                                                                                                                                                                     |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud plaintext authority | Partial pass / blocked              | New paths are metadata-only/opaque; legacy durable columns require HIGH-05 deletion gate.                                                                                                       |
| Envelope/crypto proof     | Proof pass, production pending      | Vectors pass; key custody, nonce lifecycle, and capability authentication open.                                                                                                                 |
| Local vault               | Blocked                             | Recovery and production KDF/key custody absent.                                                                                                                                                 |
| Sync/device/revocation    | Failed / blocked                    | `SYNC-001` latest run `RUN-181` lacks durable API restart configuration and fails MinIO bucket setup with HTTP 403; durable lifecycle closure is unresolved.                                    |
| Migration                 | Blocked                             | Legacy values remain; deletion/tombstone evidence and durable ledger pending.                                                                                                                   |
| Product visibility        | Accepted slice / production pending | `WEB-001` read-only visibility is accepted by `RUN-182`; complete production release remains gated by sync and migration evidence.                                                              |
| Capabilities/execution    | Accepted slice / production pending | `SEC-001` signature, handshake, protected classification, bounded policy, redaction, and nonce/key controls are accepted by `RUN-172`; provenance/custody and remaining release gates are open. |
| External AI/MCP/broker    | Blocked                             | Default deny helps, but protected classification and projection controls are insufficient.                                                                                                      |
| Telemetry/logging         | Blocked                             | Runtime redaction and retention are not proven/approved.                                                                                                                                        |
| Release gate              | Blocked                             | Gate is wired and reproducible; audit, provenance, key, telemetry, and advisory blockers remain.                                                                                                |

## Sign-off and release gate

**Production architecture: BLOCKED.** At minimum CRITICAL-01, CRITICAL-02, HIGH-01 through HIGH-05 require remediation or explicit owner decisions; critical findings are not eligible for accepted risk. Release provenance remains blocked by ADR 011's key-custody, catalogue, attestation, telemetry, and advisory-triage decisions.

**Independent sign-off:** withheld. `SEC-001` (`REVW-131`) and `WEB-001` (`REVW-136`) are accepted slices, not ZK-014 production approval. ZK-014 requires a new independent review after `SYNC-001` and all release/migration blockers are closed; this run does not request or claim that sign-off.

**Proof-milestone limitations:** unresolved durable sync/restart and MinIO integration, recovery/revocation lifecycle closure, legacy plaintext/tombstone inventory, release provenance/key custody, telemetry retention, and advisory disposition remain incomplete controls, not accepted risks. No capability, sync, migration, recovery, UI, or deployment remediation was implemented by ZK-014; this run updates only the security report/disposition artifact.

**Re-review entry point:** after `SYNC-001` supplies a successful independently reviewable durable API restart/integration run, rerun the complete eight-category matrix, refresh the zero-plaintext/tombstone and release-control evidence, and request independent ZK-014 review. Until then, production architecture and production sign-off remain withheld.
