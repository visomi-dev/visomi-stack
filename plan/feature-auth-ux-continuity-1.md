---
goal: Improve authentication continuity, verification feedback, account security navigation, contextual reauthentication, and cross-device approval
version: 1.1
date_created: 2026-09-18
last_updated: 2026-09-18
owner: Visomi Stack
status: 'In progress'
tags: [feature, auth, ux, passkeys, security, accessibility, i18n]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

Implementation and tracking plan for the six authentication UX improvements following commit `75a4a4e` (`fix(auth): enforce verified security operations`). The user authorized implementation after this plan was created. The six behavior improvements are implemented locally. Automated acceptance is passing; human usability evaluation and external-provider/hardware acceptance are still open.

This document is the source of truth for scope, task status, evidence, deviations, and handoff. Version 1.1 preserves all eight phases and all 45 task identifiers, updates proposed paths to actual implementation paths, and records the implementation decisions below. `Yes` means the recorded local task and its focused verification completed; it does not imply deployment or production-provider acceptance. Test log timestamps are UTC and extend into 2026-09-19.

## 1. Requirements & Constraints

### Baseline and delivered behavior

| Recommendation          | Baseline at `75a4a4e`                                                            | Delivered behavior                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP feedback            | `resendAvailableAt` stored but not reflected in the resend control               | Deadline-based countdown, duplicate-submit protection, resend announcement, safe failure mapping, restart, and recovery-email correction.                     |
| Clear copy              | Server-oriented password explanation and passkey-specific shared success message | Method-neutral success, user-centered factor instructions, accurate passkey-storage copy, localized auth/security actions.                                    |
| Passkey fallback        | Error screen offered retry/email recovery only                                   | Full configured selector reachable without another immediate native prompt, preserving email, destination, and focus.                                         |
| Contextual confirmation | Repeated passkey orchestration; standalone route hardcoded `password_change`     | Route-owned coordinator and reusable dialog; server-derived operation methods; distinct recent-passkey adapter; no arbitrary operation on direct route entry. |
| Security overview       | Approval dominated the page; silent overview failure; technical event names      | Sign-in, recovery, and device/activity sections; truthful status; independent loading/error/retry; understandable actions and confirmations.                  |
| Device approval         | Manual ID transfer and fixed polling loop; no review/cancel/deny endpoints       | Local QR/link, authorized review, cancellation/denial, race-safe consumption, lifecycle-owned polling/expiry, and enrollment continuation.                    |

### Product requirements

- **REQ-001**: Show resend cooldown, in-progress state, delivery success, and actionable verification failures using server-owned timing and error contracts.
- **REQ-002**: Localize changed user-facing states in English and Spanish. Use method-neutral completion text and accurate explanations of synced passkeys.
- **REQ-003**: Preserve locale, entered email, and the allowlisted destination when changing sign-in methods. Offer the full configured selector after incomplete passkey authentication.
- **REQ-004**: Organize Security by sign-in methods, account recovery, and trusted devices/activity. Distinguish loading, empty, unavailable, and loaded data.
- **REQ-005**: Provide same-origin approval links and locally generated QR with a text fallback, explicit review, expiry, cancellation/denial, and enrollment continuation.
- **REQ-006**: Explain the pending sensitive action, obtain its required authority, and continue it once. Expired authority requires explicit fresh confirmation; uncertain mutation outcomes are not replayed automatically.
- **REQ-007**: Preserve keyboard operation, visible/restored focus, semantic labels, appropriate announcements, reduced-motion behavior, and responsive layouts.
- **REQ-008**: Record repeatable usability evidence for completion, elapsed time, resend behavior, and method switching. Human evaluation remains TASK-042; automated runtimes are not conversion or human-performance measurements.

### Security requirements

- **SEC-001**: The server owns cooldowns, expiry, factors, session validity, grants, and consumption. Client timers only inform the UI.
- **SEC-002**: Preserve account-enumeration resistance. Unknown API errors and ambiguous native non-completion remain neutral; do not infer missing accounts/passkeys.
- **SEC-003**: Preserve user/session/purpose binding, `authVersion`, verified single-use operations, attempt limits, and TOTP requirements. Email is not a downgrade for TOTP.
- **SEC-004**: QR/link payloads contain a request reference only, never a user code, enrollment grant, session token, password, OTP, or assertion. Scanning does not approve anything.
- **SEC-005**: Review/approve/deny requires the matching full-session user/account. Approval requires a different requester session and fresh passkey proof. Status/cancel/consume remains requester-bound. Expiry and terminal-state predicates are checked atomically.
- **SEC-006**: Approval grants enrollment, not full authentication. Continue through registration and passkey verification before claiming completion.
- **SEC-007**: Permit one active sensitive action/ceremony per owner, ignore stale callbacks, and serialize verification transitions. Do not automatically repeat a possibly completed mutation.
- **SEC-008**: Keep passwords/codes/assertions in active-flow memory only. Clear them on completion/cancellation/navigation. Do not put secrets in URLs, browser storage, screenshots, or evidence.

### Repository and scope constraints

- **CON-001**: Follow `AGENTS.md` and `docs/agents/{frontend,backend,design-system,e2e,workflow}.md`. Repository prose/source strings are English; Spanish belongs in translation resources.
- **CON-002**: Load Node through `fnm`. Export `NX_DAEMON=false` in each shell invocation before Nx or indirect Nx scripts/hooks. Keep `useDaemonProcess: false`; stop only task-owned processes.
- **CON-003**: Use Signal Forms, existing primitives/tokens, strict types, browser/server boundaries, top-level imports, and kebab-case files. New components have external templates/styles and meaningful tests.
- **CON-004**: Extract messages natively, preserve XLF placeholders as XML, and translate touched states rather than rewriting unrelated catalogs.
- **CON-005**: No anonymous approval creation, new identity provider, active-session dashboard, browser fingerprinting, production analytics infrastructure, or general design-system replacement.
- **CON-006**: Preserve conditional/immediate passkey capability behavior and the official Google button. Native credential dialogs remain browser-owned.
- **CON-007**: Use the repository scaffolding workflow for components. No commit, push, PR, or deployment is implied by implementation.

### Traceability and current phase status

| Phase | Recommendation / explicit sub-scope                          | Depends on  | Status  | Remaining gap                                                  |
| ----- | ------------------------------------------------------------ | ----------- | ------- | -------------------------------------------------------------- |
| PH-01 | Baseline, state contracts, prototypes                        | None        | done    | Human baseline timing remains explicitly assigned to TASK-042. |
| PH-02 | Recommendation 1: OTP feedback/cooldown                      | PH-01       | done    | None in the implemented local slice.                           |
| PH-03 | Recommendation 2: copy/localization                          | PH-02       | done    | Unrelated historical translation catalog is outside scope.     |
| PH-04 | Recommendation 3: passkey-error continuity                   | PH-03       | done    | Real OS/provider acceptance belongs to PH-08.                  |
| PH-05 | Recommendation 6: contextual reauthentication                | PH-04       | done    | Actual Google account acceptance belongs to PH-08.             |
| PH-06 | Recommendation 4: security information architecture          | PH-05       | done    | No inferred device identities or session-management claims.    |
| PH-07 | Recommendation 5: link/QR approval                           | PH-06       | done    | Physical QR scan and external authenticators belong to PH-08.  |
| PH-08 | Integrated, accessibility, usability, real-device acceptance | PH-02–PH-07 | blocked | TASK-042, TASK-043, and final closure TASK-045.                |

Milestones: **M1** = PH-01–PH-04, **M2** = PH-05–PH-06, **M3** = PH-07, **M4** = PH-08. M1–M3 are implemented and locally verified. Do not change the plan status to `Completed` until M4 is accepted.

### Recorded implementation decisions

1. **Prototype lifecycle:** The three planned HTML prototypes were authored and previewed with `ui-designer:build-css`; 36 captures include expanded translation-length text. After Angular promotion, source prototypes were archived under ignored `tmp/auth-prototypes/`, as required by the prototype skill. Their original filenames are retained there.
2. **Baseline evaluation:** The existing 44-case browser suite supplied automated baseline evidence. No human timing study was available. That acceptance remains TASK-042, rather than being claimed from automation.
3. **Test placement:** Approval/overview persisted-session regressions extend `auth-middleware.spec.ts`; real HTTP reauthentication/overview assertions share `security-overview.spec.ts`. Separate proposed files would duplicate the same setup. Phase and scenario coverage remains explicit below.
4. **Migration:** Added the append-only SQL migration `drizzle/20260918170000_device_approval_cancellation/migration.sql`, following the existing SQL-only migration history. A blanket snapshot diff would include unrelated historical schema changes, so no historical snapshot/migration was rewritten. Real PostgreSQL and PGlite runs applied the new migration.
5. **Enrollment contract:** A validated, unconsumed, unrevoked, unexpired `device_approval` enrollment grant can authorize registration from its bound full requester session. Other full-session registration still requires fresh local passkey confirmation. Without this narrow integration, the QR journey would still demand a passkey on the device being enrolled.
6. **Durable coverage:** The full API E2E runner now includes `device-approval.spec.ts` in its PostgreSQL stage alongside restart verification. The existing OpenAPI target remains narrowly filtered and is not used as a substitute for HTTP coverage.
7. **Rate-limit isolation:** New browser scenario groups reset only their memory-backed test fixture via `DELETE /api/test/auth/rate-limits`. The router is mounted only with `ENABLE_TEST_API`, and this operation rejects non-memory drivers. No application threshold or durable/production counter is changed.
8. **Dependencies:** Local QR encoding uses pinned `qrcode@1.5.4` (MIT, registry unpacked size 135,364 bytes), loaded only through `Deps`. Its browser build chunk was approximately 24.6 kB / 8.3 kB transfer. `@types/qrcode@1.5.6` and `@axe-core/playwright@4.13.0` are development dependencies. CommonJS optimization warnings are recorded, not suppressed.
9. **Shared dialog:** Reused the existing overlay. Added scroll-lock cleanup on destruction and a localized close label, with focus restoration verified through browser tests.

## 2. Implementation Steps

Task completion values are `Yes`/`No`; dates are ISO dates or `—` until complete. Every phase remains represented. Run tasks in order within a phase unless a task explicitly describes independent verification. Evidence references refer to section 6.

### Implementation Phase 1

- **GOAL-001**: Establish source/contract baseline and inspect prototypes before production UI work.
- Entry: documented worktree/base. Exit: baseline, prototype captures, and implementation decisions recorded. Human evaluation stays observable in PH-08.

| Task     | Description and implementation location                                                                                                                                           | Completed | Date       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-001 | Confirm `75a4a4e`, clean baseline except this plan, route constants in `shared/constants/routes.ts`, and resolved Nx app/API/E2E targets. Evidence E-001.                         | Yes       | 2026-09-18 |
| TASK-002 | Inspect `SignIn`, `SecurityAuth`, `Security`, `DeviceApproval`, `auth-router.ts`, and `auth-middleware.ts`; record state/event contract and actual authority/timing fields below. | Yes       | 2026-09-18 |
| TASK-003 | Author `auth-verification-feedback.html`, `account-security-overview.html`, and `device-approval-review.html` through the prototype workflow; archive after Angular promotion.    | Yes       | 2026-09-18 |
| TASK-004 | Capture prototypes at 360/768/1440, light/dark, including expanded translation-length text; inspect wrapping/hierarchy. Production keyboard/AXE validation follows in E-006.      | Yes       | 2026-09-18 |
| TASK-005 | Record supported baseline scenarios and unavailable external journeys. Baseline E-002 is automated; retain human task timings and comparison in TASK-042.                         | Yes       | 2026-09-18 |

### Implementation Phase 2

- **GOAL-002**: Make OTP waiting, resend, verification failure, and restart behavior understandable.
- Entry: PH-01. Exit: countdown/error/restart behavior, unit coverage, browser coverage, and build pass.

| Task     | Description and implementation location                                                                                                                                                                                                               | Completed | Date       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-006 | In `auth/sign-in/sign-in.ts`, derive resend seconds from the server timestamp, own the browser clock during email-factor display, refresh on visibility, and dispose on state exit/destruction. Invalid timestamps do not permanently disable resend. | Yes       | 2026-09-18 |
| TASK-007 | Guard `resendPasswordCode()` against early/duplicate requests; update deadline, announce successful delivery once, and honor numeric/date `Retry-After` when supplied. Do not announce each countdown tick.                                           | Yes       | 2026-09-18 |
| TASK-008 | Map known terminal verification codes to restart, network failures to retry, and unknown errors to safe text. Preserve TOTP selection and server attempt limits.                                                                                      | Yes       | 2026-09-18 |
| TASK-009 | Add recovery change-email and factor restart controls; clear abandoned code/flow and guard late responses. Preserve email draft, locale, and destination. Serialize password-factor navigation during submitted verification.                         | Yes       | 2026-09-18 |
| TASK-010 | Reuse existing password resend timing and recovery APIs. Recovery restart creates a new authorized flow; no invented recovery resend deadline or delivery success, and no timing API extension was necessary.                                         | Yes       | 2026-09-18 |
| TASK-011 | Extend `sign-in.spec.ts` and add `app-e2e/src/auth/verification-feedback.spec.ts`; retain full password/TOTP regression coverage. E-004/E-006/E-007 cover the local slice.                                                                            | Yes       | 2026-09-18 |

### Implementation Phase 3

- **GOAL-003**: Localize accurate, user-centered content for the changed auth/security experience.
- Entry: PH-02. Exit: native extraction, localized build, and translated-state checks pass.

| Task     | Description and implementation location                                                                                                                                                                                            | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-012 | Replace server-oriented password copy and passkey-specific shared success in `sign-in.html`; password/Google/passkey completion now share accurate identity-confirmed text.                                                        | Yes       | 2026-09-18 |
| TASK-013 | Correct synced-passkey descriptions and connected-account terminology in `security.html`; update password/authenticator, recovery-code, Google-link, and standalone confirmation copy.                                             | Yes       | 2026-09-18 |
| TASK-014 | Use stable `@@` IDs and `$localize`; extract through `app:extract-i18n`; translate touched XLF entries and retain XML interpolation. Busy passkey labels are translated strings rather than English ternaries inside placeholders. | Yes       | 2026-09-18 |
| TASK-015 | Verify Spanish idle/busy labels and responsive localized screenshots in `security-translations.spec.ts` and `security-actions.spec.ts`; production localized build passed.                                                         | Yes       | 2026-09-18 |

### Implementation Phase 4

- **GOAL-004**: Return from passkey failure to the complete selector without losing context or triggering another native prompt.
- Entry: PH-03. Exit: explicit retry, alternate methods, keyboard restoration, and existing immediate/conditional regressions pass.

| Task     | Description and implementation location                                                                                                                                                    | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------- |
| TASK-016 | Add `SignIn.useAnotherMethod()` and its error-screen action; restore `ready` and the existing dialog after render, bypassing immediate UI for this transition.                             | Yes       | 2026-09-18 |
| TASK-017 | Reuse credential ownership/attempt guards; preserve email and allowlisted navigation; retain official configured Google, password, recovery, and explicit registration choices.            | Yes       | 2026-09-18 |
| TASK-018 | Restore focus to the enabled Continue control when needed and use neutral text for ambiguous native non-completion; keep server verification errors actionable.                            | Yes       | 2026-09-18 |
| TASK-019 | Verify error → selector → password, retained email, Escape/focus, and fresh retry using `verification-feedback.spec.ts`, `sign-in.spec.ts`, and the preserved adaptive-entry suite. E-006. | Yes       | 2026-09-18 |

### Implementation Phase 5

- **GOAL-005**: Reuse contextual confirmation while preserving operation-grant versus recent-passkey authorization.
- Entry: PH-04. Exit: coordinator/dialog integration, verified single-use authority, and focused unit/HTTP/browser checks pass.

| Task     | Description and implementation location                                                                                                                                                                                      | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-020 | Add route-scoped `shared/auth/security-action.ts` with discriminated action context, purpose, target ID, summary, single pending operation, and owner-destruction cleanup.                                                   | Yes       | 2026-09-18 |
| TASK-021 | Update `/reauth/start`, schemas, and `SecurityAuth` to return enrolled methods, grant expiry, and password/TOTP requirement from persisted state. Google is not invented as a reauthentication method.                       | Yes       | 2026-09-18 |
| TASK-022 | Generate and implement `shared/auth/security-confirmation/` using the existing dialog and Signal Forms. Render only permitted methods; recent-passkey actions remain passkey-only.                                           | Yes       | 2026-09-18 |
| TASK-023 | Implement operation-grant and recent-passkey adapters in `SecurityAction`; the owning mutation follows server verification once, without replacing middleware authority checks.                                              | Yes       | 2026-09-18 |
| TASK-024 | Integrate password management, recovery codes, Google linking, and passkey management. Direct standalone reauthentication now explains missing action context rather than authorizing a hardcoded purpose.                   | Yes       | 2026-09-18 |
| TASK-025 | Handle cancellation, failure, expiry, late callbacks, and uncertain mutation outcomes without automatic replay. Clear form secrets, refresh session after password changes, and guard stale/duplicate Google-link callbacks. | Yes       | 2026-09-18 |
| TASK-026 | Add coordinator/dialog tests and browser cancellation/focus cases; extend persisted middleware tests and real HTTP reauthentication coverage in `security-overview.spec.ts`. E-004–E-007.                                    | Yes       | 2026-09-18 |

### Implementation Phase 6

- **GOAL-006**: Present truthful account-security status and recoverable partial failures.
- Entry: PH-05. Exit: typed overview, grouped UI, localization, AXE, responsive screenshots, and HTTP isolation checks pass.

| Task     | Description and implementation location                                                                                                                                                                                    | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-027 | Move overview access/types into `SecurityAuth`; return server-derived password/TOTP status, unused recovery-code count, and Google-link availability. Never expose password hashes, TOTP secrets, or recovery-code values. | Yes       | 2026-09-18 |
| TASK-028 | Group `security.html` into sign-in, recovery, and devices/activity; link existing management routes and the approval route. Google linking is shown only when configured.                                                  | Yes       | 2026-09-18 |
| TASK-029 | Separate passkey and overview loading/error/retry; keep usable sections available. Guard removals, explain effects before confirmation, and report outcomes without presenting uncertain failures as success.              | Yes       | 2026-09-18 |
| TASK-030 | Translate recovery-event labels with an unknown-event fallback; show available dates and device-trust expiry. Do not fabricate device names or equate trusted-device records with active sessions.                         | Yes       | 2026-09-18 |
| TASK-031 | Use Signal Forms for passkey names, retain server last-passkey protection, translate new states, and make confirmation/rename/revoke actions readable.                                                                     | Yes       | 2026-09-18 |
| TASK-032 | Verify overview isolation/counts over HTTP, partial-failure UI, localized busy states, AXE checks, and 360/768/1440 screenshots in both themes/locales. E-006/E-007.                                                       | Yes       | 2026-09-18 |

### Implementation Phase 7

- **GOAL-007**: Complete session-bound approval through link/QR, explicit remote proof, and requester enrollment.
- Entry: PH-06. Request creation keeps its existing authenticated-context requirement; anonymous onboarding is outside scope.
- Exit: local two-session WebAuthn journey and durable approval race tests pass. Physical scanning/provider acceptance remains TASK-043.

| Task     | Description and implementation location                                                                                                                                                                                               | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-033 | Add typed `/device-approval/review`, `/cancel`, and `/deny` routes with `{ requestId }`, scoped authorization, safe metadata, and distinct cancelled/denied statuses.                                                                 | Yes       | 2026-09-18 |
| TASK-034 | Enforce expiry/user/account/session/terminal predicates for mutations; require fresh different-session approval; transactionally consume and create the enrollment grant; add `cancelledAt` migration and request/code limits.        | Yes       | 2026-09-18 |
| TASK-035 | Give `DeviceApproval` precise request/status/review/terminal/consume response types. Replace fixed loops with single-flight visible-page polling, bounded expiry timers, and cleanup on terminal state/navigation.                    | Yes       | 2026-09-18 |
| TASK-036 | Generate `security/device-approval/`, register its guarded route, validate UUID references, and extend `authDestination()` only for this exact local route/query. Visiting or authenticating never auto-approves.                     | Yes       | 2026-09-18 |
| TASK-037 | Generate QR locally through lazy `Deps.approvalQr()`, expose a same-origin link and copy fallback, and display expiration. The payload excludes user codes and grants.                                                                | Yes       | 2026-09-18 |
| TASK-038 | Render requester/approver roles and pending/approved/denied/cancelled/consumed/expired states. Reuse contextual fresh-passkey confirmation for approval, with explicit denial and cancellation.                                       | Yes       | 2026-09-18 |
| TASK-039 | Consume using requester-memory code, then register and verify a passkey through existing APIs. A reload with a lost code offers cancellation/restart. Reconcile the server session before completion navigation.                      | Yes       | 2026-09-18 |
| TASK-040 | Extend persisted unit/API and new real HTTP/browser suites for isolation, self-approval, expiry, attempts, terminal races, replay, lost-code reload, QR/link behavior, and enrollment. PostgreSQL coverage runs in the durable stage. | Yes       | 2026-09-18 |

### Implementation Phase 8

- **GOAL-008**: Close with auditable integrated evidence, human evaluation, and actual provider/hardware acceptance.
- Entry: PH-02–PH-07 implemented and focused checks passed.
- Exit: all required local and external criteria accepted. This phase remains blocked, not silently completed by virtual-authenticator tests.

| Task     | Description and implementation location                                                                                                                                                                                       | Completed | Date       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-041 | Run the local matrix: units, lint/typecheck, localized production builds, browser/AXE/screenshots, real HTTP/durable races, and gateway smoke. Record actual coverage and reviewed captures. E-004–E-009.                     | Yes       | 2026-09-18 |
| TASK-042 | Perform a human usability study using the scripted scenarios below; record sample size, per-task elapsed time, repeated clicks/help, and baseline comparability. Automation did not supply these measurements.                | No        | —          |
| TASK-043 | Validate authorized real Google sign-in/linking, physical security key, synced Apple/Google passkeys, Safari on actual Apple hardware, and physical QR scanning. Record platform/browser/provider/date and redacted evidence. | No        | —          |
| TASK-044 | Audit changed copy, secret handling, QR payload, stale callbacks, one-time authority, timer cleanup, and the PostgreSQL/PGlite race results. Record warnings and implementation adjustments.                                  | Yes       | 2026-09-18 |
| TASK-045 | After TASK-042/TASK-043 acceptance, record remaining deviations, close PH-08, and change front matter/badge to `Completed`. Current handoff is recorded below; final acceptance is not yet claimed.                           | No        | —          |

### State/event contract

| Owner / state            | Event                      | Required behavior                                                                         |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| Email-factor cooldown    | Tick / visible-tab return  | Recompute server deadline; no automatic resend or per-second live announcement.           |
| Email-factor ready       | Resend                     | One request, disabled duplicate action, server deadline update, one success announcement. |
| OTP editable             | Invalid code               | Safe correction feedback retaining the required factor.                                   |
| OTP terminal             | Restart                    | Abandon old flow/code, return to permitted start, retain server limits.                   |
| Recovery OTP             | Change email               | Clear old context and code, preserve email draft/locale/destination, focus email.         |
| Passkey incomplete       | Use another method         | Show existing selector after render without another immediate native prompt.              |
| Sensitive action         | Confirm                    | Obtain purpose-bound authority or required fresh passkey proof, then execute once.        |
| Sensitive action expired | Explicit retry             | Obtain new authority for the same pending action; do not reuse/replay automatically.      |
| Action owner exits       | Destroy / session loss     | Clean local state, ignore stale callbacks, never treat cancellation as proof.             |
| Approval pending         | Approve/deny/cancel/expire | Atomic valid state transition; no later use after denied/cancelled/expired state.         |
| Approval approved        | Requester continues        | Consume once in bound session and enroll/verify; not an inferred full session.            |
| Approval uncertain       | Network failure            | Recover through authoritative status rather than inventing success.                       |

### PR and handoff boundaries

Changes remain local and uncommitted. Suggested review order is M1 access continuity, M2 contextual security, then M3 approval lifecycle. Keep each behavior's tests/translations with it. Share the coordinator before reviewing its device-approval consumer. Do not split the producer/consumer or migration/route contracts into unusable commits merely to meet a line-count heuristic.

Prefer self-contained branches on current `main` after prerequisite merges. If stacking is required, document merge order and rebase remaining branches after base merges. No PR URLs or merge approvals exist for this execution.

## 3. Alternatives

- **ALT-001**: Replace the entire entry flow. Rejected; existing conditional/immediate entry and selector are retained.
- **ALT-002**: Infer account/passkey absence from native errors. Rejected; explicit fallback remains neutral.
- **ALT-003**: Client-only rate limiting. Rejected; server policies remain unchanged.
- **ALT-004**: One generic permission for all sensitive actions. Rejected; operation grants and recent-passkey actions keep distinct contracts.
- **ALT-005**: Secret-bearing QR for one-step approval. Rejected; the link is a reference, not authority.
- **ALT-006**: New WebSocket/SSE approval transport. Deferred; lifecycle-owned 5-second polling fits the existing ten-minute window.
- **ALT-007**: Security score, guessed device names, or active-session dashboard. Deferred; unsupported by current data and outside scope.
- **ALT-008**: Production analytics platform. Deferred; TASK-042 retains usability measurement without adding infrastructure.

## 4. Dependencies

- **DEP-001**: Verified-operation/session controls from `75a4a4e` and its migrations.
- **DEP-002**: Existing Angular Signal Forms, overlay primitives, `Auth`, `Passkey`, `SecurityAuth`, and localized routing.
- **DEP-003**: Server-derived timing, factor availability, security overview, and session-bound approval state.
- **DEP-004**: New cancellation migration plus PostgreSQL transaction support. Migration application was verified in isolated test storage.
- **DEP-005**: `qrcode@1.5.4`, `@types/qrcode@1.5.6`, and `@axe-core/playwright@4.13.0` recorded in the package manifest/lockfile.
- **DEP-006**: Playwright browsers, Redis, available gateway ports, and Docker/Podman with isolated PostgreSQL/MinIO for the durable runner.
- **DEP-007**: Human participants and real-provider credentials/hardware for remaining TASK-042/TASK-043.

## 5. Files

All paths are repository-relative. Braced filenames denote companions, not literal filenames.

| ID       | Actual implementation path                                                                                                 | Purpose                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| FILE-001 | `apps/web/app/src/app/auth/sign-in/sign-in.{ts,html,spec.ts}`                                                              | OTP state, safe errors, alternate methods, focus, and regression tests.               |
| FILE-002 | `apps/web/app/src/app/shared/auth/security-action{,.spec}.ts`                                                              | Route-owned sensitive-action coordinator.                                             |
| FILE-003 | `apps/web/app/src/app/shared/auth/security-confirmation/security-confirmation.{ts,html,css,spec.ts}`                       | Reusable contextual confirmation UI.                                                  |
| FILE-004 | `apps/web/app/src/app/shared/auth/{security-auth,device-approval,google-identity,google-identity.spec}.ts`                 | Typed endpoints and guarded Google callbacks.                                         |
| FILE-005 | `apps/web/app/src/app/auth/{password-management,recovery-codes,google-link,reauthentication}/`                             | Action integrations, contextual behavior, feedback, localization, and relevant tests. |
| FILE-006 | `apps/web/app/src/app/security/security.{ts,html,spec.ts}`                                                                 | Grouped overview, independent states, passkey and removal flows.                      |
| FILE-007 | `apps/web/app/src/app/security/device-approval/device-approval.{ts,html,css,spec.ts}`                                      | Requester/approver route, polling, QR, and enrollment.                                |
| FILE-008 | `apps/web/app/src/app/{app.routes.ts,shared/constants/routes.ts,shared/constants/routes.spec.ts,shared/deps.ts}`           | Safe routing and optional QR loading.                                                 |
| FILE-009 | `apps/web/app/src/app/shared/ui/overlays/dialog/dialog.{ts,html}`                                                          | Owned scroll-lock cleanup and localized close label.                                  |
| FILE-010 | `apps/web/app/src/locales/messages{,.es}.xlf`                                                                              | Native English catalog and manually translated Spanish entries.                       |
| FILE-011 | `apps/web/api/src/auth/{auth-router,auth-schemas,passkey-router,passkey-security,auth-middleware.spec}.ts`                 | Server metadata, authorization, lifecycle, schemas, and persisted regressions.        |
| FILE-012 | `libs/shared/src/lib/db/schema.ts`; `drizzle/20260918170000_device_approval_cancellation/migration.sql`                    | Append-only cancellation state.                                                       |
| FILE-013 | `apps/web/app-e2e/src/auth/{verification-feedback,security-actions,device-approval,security-translations,sign-in}.spec.ts` | New journeys, AXE/screenshots, and adapted existing expectations.                     |
| FILE-014 | `apps/web/api-e2e/src/api/{security-overview,device-approval}.spec.ts`; `src/support/run-api-e2e.ts` in the same project   | Real HTTP, durable approval races, and runner integration.                            |
| FILE-015 | `apps/web/api/src/testing/test-router.ts`                                                                                  | Memory-only test rate-limit isolation behind the existing test-API gate.              |
| FILE-016 | `package.json`; `pnpm-lock.yaml`                                                                                           | QR and accessibility test dependencies.                                               |
| FILE-017 | `tmp/auth-prototypes/`; `tmp/auth-captures/`; `tmp/auth-ux-api-e2e/`                                                       | Ignored local prototype, visual, and runtime evidence.                                |
| FILE-018 | `plan/feature-auth-ux-continuity-1.md`                                                                                     | Live completion tracker and acceptance/handoff record.                                |

## 6. Testing

### Scenario inventory

- **TEST-001**: Server-deadline cooldown, visibility refresh, no early resend, single delivery announcement, and retry feedback.
- **TEST-002**: Invalid/expired/exhausted/network verification states, complete six-digit input with leading zeros, restart, and duplicate-submit protection.
- **TEST-003**: Recovery email correction/old-flow clearing, stale response ownership, and preserved factor selection; existing API TOTP no-email-downgrade regressions remain enabled.
- **TEST-004**: Method-neutral success, accurate storage guidance, translated errors/actions/busy states, and XML interpolation.
- **TEST-005**: Incomplete passkey → full method selector → password, with email/destination preservation and explicit registration intent.
- **TEST-006**: Dialog keyboard/Escape/restoration, fresh retries, conditional/immediate authentication, and owner teardown.
- **TEST-007**: Server method availability, required password/TOTP metadata, and passkey-only recent-security operations.
- **TEST-008**: User/session/purpose-bound, verified single-use grants; no mutation before proof; cancellation and duplicate confirmation.
- **TEST-009**: No automatic replay after uncertain mutation; session reconciliation and secret clearing after password actions; one-time recovery codes.
- **TEST-010**: Persisted overview fields, recovery-code counts, user/account isolation, no secret fields, and configured Google visibility.
- **TEST-011**: Independent overview failure, usable passkey controls, empty state, unknown event fallback, understandable removals, and last-passkey server protection.
- **TEST-012**: Scoped approval review/status/mutation, CSRF, same-session rejection, expiry, attempts, and reference-only QR/link payloads.
- **TEST-013**: Approve versus deny, consume versus cancel, and duplicate consume races on PostgreSQL. Exactly one applicable winner; no replay.
- **TEST-014**: Two browser contexts, real virtual-passkey proof, bound consume, requester registration/verification, and lost-code reload/cancellation. Physical scanning remains TASK-043.
- **TEST-015**: Single-flight polling, visibility/terminal/navigation cleanup, server-deadline UI expiry, and recoverable network status.
- **TEST-016**: Localized production build/SSR, responsive screenshots, keyboard focus, reduced-motion configuration, and scoped WCAG-tagged AXE checks.

### Validation matrix

| Phase | Unit                      | API                                                  | App E2E        | Gateway E2E                              | Site E2E                   | Visual                                   | Security                               | Build             |
| ----- | ------------------------- | ---------------------------------------------------- | -------------- | ---------------------------------------- | -------------------------- | ---------------------------------------- | -------------------------------------- | ----------------- |
| PH-01 | N/A: discovery/prototypes | N/A: no contract                                     | Baseline E-002 | N/A: no runtime change                   | N/A: site unchanged        | Prototype E-003                          | Contract inspection                    | Preview CSS build |
| PH-02 | E-004                     | No new timing contract; existing factor checks E-007 | E-006          | N/A: proxy unchanged                     | N/A: site unchanged        | Auth/prototype states                    | Limits/no downgrade E-005/E-007        | E-009             |
| PH-03 | N/A: text-only behavior   | N/A: copy only                                       | E-006          | N/A: proxy unchanged                     | N/A: site unchanged        | Locales/themes E-006                     | Safe copy review                       | E-009             |
| PH-04 | E-004                     | N/A: existing contracts                              | E-006          | N/A: proxy unchanged                     | N/A: site unchanged        | Selector matrix                          | Context/focus E-006                    | E-009             |
| PH-05 | E-004/E-005               | E-007                                                | E-006          | N/A: proxy unchanged                     | N/A: site unchanged        | Confirmation matrix E-006                | Bound/single-use authority             | E-009             |
| PH-06 | E-004/E-005               | E-007                                                | E-006          | N/A: proxy unchanged                     | N/A: site unchanged        | Security matrix E-006                    | Data isolation/no secrets              | E-009             |
| PH-07 | E-004/E-005               | E-007, including PostgreSQL                          | E-006          | E-008 and real deep-link browser journey | N/A: site unchanged        | Approval matrix E-006                    | Terminal/concurrency rules             | E-009             |
| PH-08 | E-004/E-005               | E-007                                                | E-006          | E-008                                    | N/A: site source unchanged | Captures reviewed; human evaluation open | Local checks pass; real providers open | E-009             |

AXE checks are scoped to changed Security, confirmation-dialog, and device-approval surfaces with `wcag2a`, `wcag2aa`, `wcag21aa`, and `wcag22aa`. Passing scoped scans are not a claim of whole-application WCAG certification. Browser E2E uses the real gateway; presentation-only fixture cases do not substitute for the separate real approval journey.

### Command environment

Before **each shell invocation** containing Nx or a script/hook that can invoke Nx:

```sh
export NX_DAEMON=false && eval "$(fnm env --shell zsh)" && fnm use default
```

The installed default resolved to Node `v24.14.1`; bare `fnm use` had no version dotfile to read. Do not change the repository's TypeScript aliases to work around unrelated warnings.

| ID    | Command / inspection                                                                                    | Last observed result                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-001 | `pnpm exec nx show project app --json`, `app-e2e`, `api-e2e`, `ui-designer`                             | Resolved targets inspected with daemon disabled.                                                                                                                    |
| E-002 | Baseline `pnpm exec nx run app-e2e:e2e`                                                                 | 44 passed, 31.6-second Playwright runtime.                                                                                                                          |
| E-003 | `pnpm exec nx run ui-designer:build-css`; local one-shot Playwright capture                             | Build passed; 36 prototype captures at three widths/two themes, including expanded text. No horizontal overflow.                                                    |
| E-004 | `pnpm exec nx run app:vite:test`; `pnpm exec nx run shared:test`                                        | 107 app tests passed, one existing skip; 135 shared tests passed.                                                                                                   |
| E-005 | `pnpm exec nx run api:test`                                                                             | 84 tests passed in 13 suites. Existing Jest worker-teardown warning persists.                                                                                       |
| E-006 | `pnpm exec nx run app-e2e:e2e`                                                                          | 62 passed in the latest complete run; real two-session enrollment, localized actions, focus, and scoped AXE scans included. Latest Playwright runtime 56.7 seconds. |
| E-007 | `PZS005_ARTIFACT_DIR=tmp/auth-ux-api-e2e pnpm exec nx run api-e2e:e2e`                                  | 24 memory-backed HTTP tests plus four durable tests passed; durable stage includes PostgreSQL approval races and restart verification.                              |
| E-008 | `pnpm exec nx run server-e2e:e2e`                                                                       | Five composition/gateway tests passed.                                                                                                                              |
| E-009 | `pnpm exec nx run app:typecheck`; `app:extract-i18n`; production builds from E2E dependencies           | Typecheck, native extraction (390 messages), localized app/API/shared/server builds passed.                                                                         |
| E-010 | `pnpm exec nx run-many -t lint --projects=app,api,app-e2e,api-e2e,shared`; formatting/whitespace checks | Project lint passed during execution; final handoff rechecks remain recorded in the session output.                                                                 |

Focused device journey was also verified with the discovered target `pnpm exec nx run app-e2e:e2e-ci--src/auth/device-approval.spec.ts`. New inferred target names must be obtained from `nx show project`, not guessed. The `api-e2e:openapi` target still filters passkey registration/authentication and cannot replace E-007.

### Visual artifacts and evaluation limits

- `tmp/auth-captures/security-{en,es}-{360,768,1440}-{light,dark}.png`.
- `tmp/auth-captures/confirmation-{en,es}-{360,768,1440}-{light,dark}.png`.
- `tmp/auth-captures/approval-{en,es}-{360,768,1440}-{light,dark}.png`.
- Existing method-sheet capture matrix is retained in the adaptive-entry suite.
- Security/confirmation/approval presentation captures mask the generated account email; QR fixtures use a fixed public request ID and deadline. Security screenshots are also attached to Playwright results.
- Reviewed desktop Security/light, mobile Security/Spanish/dark, mobile contextual confirmation/Spanish/dark, and mobile QR/Spanish/dark, alongside the prototype captures. No horizontal overflow or unreadable action labels was observed in those reviews. Scrollable app-shell content continues below the viewport.
- Virtual CTAP2 authenticators prove the tested WebAuthn/API flow, not Apple/Google synchronization, physical-key compatibility, physical QR scanning, or real Google authorization.

### Open human evaluation script

For TASK-042, run: password/email OTP with resend, password/TOTP, passkey cancellation → password, recovery-email correction, finding recovery settings, cancelling/completing a sensitive action, and link/QR device setup. Record device/browser, sample size, completion, per-task elapsed time, repeated clicks, and help requested. Use comparable baseline conditions; previously unavailable journeys are new-feature acceptance, not before/after performance comparisons.

Targets: no dead ends, no resend request before its displayed deadline, preserved safe destinations, no keyboard trap, and no duplicate sensitive mutation. Do not claim a conversion uplift from test fixtures or compare the 44-case and 62-case suite runtimes as user-performance measurements.

### Append-only execution log

| Entry   | Observation                                                                                                                      | Resolution / remaining action                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| LOG-001 | Baseline only had this untracked plan; source revision was `75a4a4e`.                                                            | No unrelated work was overwritten.                                                                                    |
| LOG-002 | First dialog unit test encountered jsdom's missing `showModal`.                                                                  | Added a unit-only stub; native behavior is verified in real browser E2E.                                              |
| LOG-003 | New API response envelopes reused one schema ID and prevented OpenAPI bootstrap.                                                 | Assigned distinct envelope IDs; real gateway and `/api/openapi.json` checks subsequently passed.                      |
| LOG-004 | QR namespace import did not expose the CommonJS encoder in the browser.                                                          | Used its default export through `Deps`; real QR generation and enrollment journey passed.                             |
| LOG-005 | Expanded browser suites exhausted the shared in-memory passkey limiter and affected later signup cases.                          | Added memory-only fixture reset around new groups; production thresholds remain unchanged; full 62-case suite passed. |
| LOG-006 | Existing English ternaries survived Spanish interpolation, and authenticator recovery codes were hidden after success.           | Localized busy labels directly and moved generated codes into a visible post-confirmation section.                    |
| LOG-007 | Approval needed a validated-grant registration path and atomic terminal-state handling.                                          | Added the narrow grant integration, cancellation migration, and passing PostgreSQL races.                             |
| LOG-008 | New test setup initially accumulated MemoryStore listeners.                                                                      | Added per-test fixture listener/session cleanup. Baseline Jest teardown warning remains separate.                     |
| LOG-009 | Real Google, physical/synced authenticators, human task timing, and hardware Safari are not available in this automated session. | TASK-042/TASK-043 remain open; TASK-045 cannot close the plan yet.                                                    |

## 7. Risks & Assumptions

- **RISK-001**: Native WebAuthn failure causes remain ambiguous; neutral fallback is intentional.
- **RISK-002**: Client clock drift/background throttling can affect display. Server expiry/rate checks remain authoritative.
- **RISK-003**: Recent-passkey actions deliberately remain passkey-only. This plan does not redesign first-passkey or anonymous-device onboarding policy.
- **RISK-004**: Password mutations can invalidate the session. The owner refreshes session state and returns to sign-in when required.
- **RISK-005**: The cancellation column must exist before deploying the new API. Isolated migration runs passed; no production migration or deployment was performed.
- **RISK-006**: Test-only reset support is restricted to the existing enabled test router and memory driver; never use `ENABLE_TEST_API` for an ordinary production environment.
- **RISK-007**: QR adds a lazy CommonJS chunk and build optimization warnings. It does not block entry or send data to a remote encoding service.
- **RISK-008**: Native extraction and scoped translation checks do not repair every unrelated historical translation resource.
- **RISK-009**: The existing API Jest worker-teardown warning persists despite passing tests; it was not represented as fixed.
- **RISK-010**: Real-provider/hardware and human evaluation are required to close this plan. Linux headless coverage is not substituted for them.
- **ASSUMPTION-001**: Existing account/session/factor policy remains the baseline; no new provider or identity-policy redesign is authorized here.
- **ASSUMPTION-002**: English/Spanish, both themes, and three widths are the implemented presentation matrix.
- **ASSUMPTION-003**: Implementation is local and uncommitted. Deployment, publication, and final external acceptance require subsequent actions.

### Current handoff

- Final local recheck: Prettier passed for changed/new TypeScript, HTML, CSS, Markdown, and JSON files; lint passed for app/API/app-E2E/API-E2E/shared; app typecheck and 107 app tests passed again after the final callback/timer changes. Whitespace checks passed.
- Cleanup confirmed: ports 4300, 8080, 8081, and 8091 have no listeners; no task-owned `themis-api-e2e` containers remain. `nx.json` still has `useDaemonProcess: false`.
- Local implementation: M1–M3 delivered; automated portion of M4 passing.
- Current phase: PH-08, blocked on human evaluation and external-provider/hardware access.
- Next tasks: TASK-042 and TASK-043; then TASK-045 closes the plan.
- Remaining required equipment/access: an authorized Google account/configuration, physical security key, Apple/Google synced-passkey devices, Safari on actual Apple hardware, and a second device for camera-based QR acceptance.
- Preserve current passing automation while performing external acceptance. Record failures by platform/provider/state and add a focused regression when reproducible.
- No commit, push, PR, production migration, or deployment was performed in this implementation session.

## 8. Related Specifications / Further Reading

- [Adaptive passkey entry plan](refactor-auth-adaptive-passkey-entry-1.md): read the newest checkpoint before historical status tables.
- [Repository instructions](../AGENTS.md), [frontend](../docs/agents/frontend.md), [backend](../docs/agents/backend.md), [design system](../docs/agents/design-system.md), [workflow](../docs/agents/workflow.md), and [E2E playbook](../docs/agents/e2e.md).
- [Google: Communicating passkeys](https://developers.google.com/identity/passkeys/ux/communicating-passkeys).
- [Google: Passkey UI design](https://developers.google.com/identity/passkeys/ux/user-interface-design).
- [FIDO Passkey Central principles](https://www.passkeycentral.org/design-guidelines/principles).
- [W3C: Accessible Authentication (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html).
- [Chrome: Immediate UI mode](https://developer.chrome.com/docs/identity/immediate-ui-mode).
