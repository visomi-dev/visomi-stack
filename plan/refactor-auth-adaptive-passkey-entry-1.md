---
goal: Deliver native passkey suggestions and a responsive authentication action sheet with complete sign-in and account-creation fallbacks
version: 1.0
date_created: 2026-09-17
last_updated: 2026-09-17
owner: Visomi Stack
status: 'In progress'
tags: [auth, passkeys, webauthn, accessibility, i18n, ux]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

### Implementation checkpoint

#### Review corrections

All three review findings were addressed. Discovery now awaits a persisted
identity flow before requesting a session-bound passkey challenge. Concurrent
preparation shares only its in-flight promise; later attempts obtain a fresh
flow. Conditional verification failures after credential selection now show
the existing error/retry screen instead of silently disappearing. Escaped XML
interpolations in the Spanish add/revoke buttons (and the same pattern in the
activation error) are restored as real `<x>` elements.

`app-e2e:e2e` passed **44 tests** after these changes, including saved virtual
passkeys with all cookies cleared for immediate, conditional and explicit
login, injected challenge-expiry feedback followed by a real retry, and Spanish
button interpolation in idle/submitting states. The localized button tests
use deterministic authenticated sessions and a credential-list fixture; they
test interpolation, not registration authority. App unit tests passed **94**
with one existing skip; app and app-E2E lint passed. The final E2E run used
`NX_DAEMON=false`, left the daemon inactive and ports 8080/8081 free.

#### Daemon-free verification and immediate-mode completion

This checkpoint supersedes the disabled-immediate and external-suite blockers in
the historical checkpoints below. All Nx invocations in this pass explicitly used
`export NX_DAEMON=false`. Global OpenCode instructions and repository `AGENTS.md`
now require that export for direct and indirect Nx commands; `nx.json` retains
`useDaemonProcess: false`. The daemon was stopped and verified inactive after
normal graph inspection.

- Immediate UI is implemented using `uiMode: 'immediate'`, `immediateGet`
  detection, a preloaded challenge with server-owned `expiresAt`, explicit user
  activation, no credential allowlist, and no abort signal. Expired/unavailable
  prepared options fall back to the method sheet. Native failure is never treated
  as proof that an account does not exist. No automatic retry loop was added.
- Chromium 153.0.8010.12 reports `immediateGet: true` without experimental flags.
  Real browser calls with a virtual CTAP2 authenticator passed both saved-passkey
  login and empty-authenticator fallback. The focus restoration defect exposed
  when an immediate request temporarily disabled its opener was corrected.
- Chrome's current primary documentation confirms the shipped API:
  https://developer.chrome.com/blog/webauthn-immediate-ui and
  https://developer.chrome.com/docs/identity/immediate-ui-mode . The earlier
  trial API is not used.
- `app-e2e:e2e`: **41 passed** (35 Chromium scenarios and three fallback scenarios
  each in Firefox 155 and WebKit 26.6). Firefox/WebKit coverage is explicitly
  limited to password access, unavailable Google, and registration navigation;
  it does not claim native passkey-provider coverage.
- `site-e2e:e2e`: **4 passed**. Astro's documented manual i18n middleware preserves
  native localized routing while exempting the English-only `/docs/` route. The
  theme test now follows the changed accessible button name and does not reset
  stored preference during every navigation.
- `api-e2e:e2e`: **20 memory-backed HTTP tests plus one durable restart test passed**.
  MinIO now uses a verified, versioned Quay image, configurable via
  `API_E2E_MINIO_IMAGE`. Isolated PostgreSQL/MinIO containers are removed by the
  runner. Evidence was written under `tmp/auth-api-e2e`.
- Unit verification: **94 app tests passed, one existing skipped; 71 API tests
  passed**. App, API, site and app-E2E lint passed. API Jest still reports a
  teardown warning and exits its worker; no continuing process is intended.

Remaining external acceptance: Google credentials on an authorized real account,
physical security keys, synced Apple/Google providers, and Safari on actual Apple
hardware. Headless WebKit on Linux does not verify those providers. The broader
historical translation catalog and full accessibility audit remain separate
unfinished acceptance work; the passing scenarios are not a blanket completion
claim for every earlier auth-plan phase.

#### Latest verified delivery

The conditional-discovery baseline and responsive native dialog are implemented.
Passkey requests carry abort ownership and attempt tokens; method switches cancel
discovery. The sheet renders the official Google button only for configured flows,
handles completion errors and rejects stale callbacks. Password/signup retain
explicit intentions; login destinations use an internal route allowlist. Sign-in
and signup copy received Spanish translations and native extraction was run.

| Phase | Current evidence/status                                                                                              | Remaining gap                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Repository inventory and compatible toolchain verified                                                               | Broader historical auth-plan audit remains separate.                                                                                       |
| 2     | Implemented UI captured at 360/768/1440 in both locales and themes; mobile dark and desktop light captures inspected | No separate approved static prototype; screenshots are evidence, not a human approval record.                                              |
| 3     | Implemented; 33 application E2E pass, including real virtual-authenticator signup and explicit/conditional login     | Physical providers and cross-browser validation remain outstanding.                                                                        |
| 4     | Disabled/not implemented                                                                                             | Immediate-mode implementation compatibility has not been proven; baseline does not depend on it.                                           |
| 5     | Native extraction and localized sign-in/signup completed                                                             | Older settings/recovery resources outside these routes still contain English targets; no full-catalog completion claim.                    |
| 6     | App, focused auth HTTP and gateway checks pass                                                                       | Broad API suite blocked by MinIO image access; site smoke has unrelated failures; real-device matrix and full accessibility audit pending. |

Verification commands and observed results:

- `pnpm exec nx run app-e2e:e2e`: 33 passed, Chromium 153 / Playwright virtual CTAP2 authenticator. Includes registration email gating, wrong-code/replay rejection, real explicit and conditional assertions, cancellation, password/email access, Google unavailable fallback, and 12 responsive locale/theme cases.
- `pnpm exec nx run api-e2e:test --testFile=auth-rework.spec.ts`: 3 passed against the real gateway, including pending password authority and TOTP/no-email-downgrade behavior.
- `pnpm exec nx run server-e2e:e2e`: 5 passed. The obsolete signup endpoint test was migrated to the current pending-password contract and strict rejection of client-supplied proof flags.
- `pnpm exec nx run app:vite:test`: 92 passed, 1 existing skipped test.
- `pnpm exec nx run app:typecheck`, `app:lint`, `app-e2e:lint`: passed before the final signup localization; production build and application E2E passed after it.
- `pnpm exec nx run app:extract-i18n`: passed; source catalog generated natively.
- `pnpm exec nx run api-e2e:e2e`: blocked before assertions because `docker.io/minio/minio:latest` could not be pulled (access denied). Focused auth HTTP tests above do not require that unrelated object-storage fixture.
- `pnpm exec nx run site-e2e:e2e`: 2 passed, 2 failed: `/docs/` is not successful and the theme test retains the old button name after toggling. No site implementation changes were made.

Visual evidence is generated at `tmp/auth-captures/method-sheet-{en,es}-{360,768,1440}-{light,dark}.png` and attached to Playwright results. These are captures with layout/focus assertions, not approved pixel-diff baselines. Google production sign-in and physical/OS passkey providers were not exercised. Test gateway processes were torn down; ports 8080/8081 were checked free after the suite.

#### Historical checkpoints

Dependency blocker resolved in the subsequent compatibility pass: Nx 23.2.1 and
TypeScript 7.0.2 were retained with the official TypeScript 6 API alias. App
typecheck, app/shared lint, the full server build and unit suites passed (app: 81
passed, 1 skipped; shared: 135; API: 71). API Jest reported a worker teardown
warning. This clears the toolchain blocker described below, not the outstanding
auth UX/E2E acceptance work. Native extraction and visual review still need to
be performed when resuming the feature.

The user authorized implementation and UI composition using repository guidelines. Initial unverified changes add conditional capability detection and abort signals to `Passkey`, route-owned cancellation/attempt tracking to `SignIn`, a visible WebAuthn autofill field, and a native responsive method dialog. Seven new messages have Spanish targets and browser capability unit tests were added. These changes are not an accepted or completed delivery slice.

Verification is blocked by an independently updated TypeScript 7.0.2 dependency. `pnpm exec nx run app:typecheck` fails while generating the project graph: Playwright reports missing `ES2018`, ESLint reports missing `Intrinsic`, and the Angular Vite integration reports `ts.createPrinter is not a function`. The user explicitly requested preserving that dependency update. No dependency rollback was performed. Formatting and `git diff --check` passed; compilation, tests, native extraction, screenshots and browser acceptance remain unverified.

Resume by restoring a compatible toolchain through the separate dependency work, then run `app:typecheck`, `app:lint`, `app:vite:test` and native `app:extract-i18n`. Complete the coordinator/session race tests, official Google rendering, safe destination continuity, dialog visual/accessibility review, prototype evidence, and full Spanish catalog repair before declaring phase 3 or 5 complete. Immediate mode remains unimplemented and disabled. No auth backend or production deployment was changed for this checkpoint.

Extend the existing authentication refactor with browser-owned credential suggestions and an application-owned responsive method chooser. Deliver the familiar experience of returning through a saved passkey and, when authentication is not completed, choosing another sign-in method or explicitly creating an account.

This document is a proposal based on repository inspection and web research, not implementation or acceptance evidence. It refines the entry UX of `plan/refactor-auth-passkey-google-password-1.md`; its security requirements remain applicable. Approval of this proposal supersedes that plan's fixed method ordering only where described below. It does not mark its eight phases complete or replace the remaining password, TOTP, recovery, management, and rollout work.

## 1. Requirements & Constraints

### Observed baseline

| Area                        | Evidence inspected                                                                                           | State and gap                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passkey browser adapter     | `apps/web/app/src/app/shared/auth/passkey.ts`, `isSupported`, `getCredential`, `createCredential`            | Only checks existence of `PublicKeyCredential`; `get()` has no conditional mediation or abort signal. No capability model or ceremony coordinator.                                                            |
| Sign-in                     | `apps/web/app/src/app/auth/sign-in/sign-in.ts`, `authenticateWithPasskey`, `showGoogle`, constructor         | Explicit modal passkey flow, inline recovery/enrollment/password states, separate Google reveal action, navigation to `APP_URL`. Automatic conditional suggestions and safe destination continuity need work. |
| Sign-up                     | `apps/web/app/src/app/auth/sign-up/sign-up.ts`, `createPasskey`, `verifySignUp`                              | Passkey creation followed by email verification; password mode already exists. Several validation/error strings are unmarked English. Do not replace this flow with sign-in inference.                        |
| Routing                     | `apps/web/app/src/app/app.routes.ts`                                                                         | Dedicated sign-in, signup, email verification, password reset and security routes exist. Legacy identity redirects to sign-in; the earlier plan's proposed identity component path is stale.                  |
| Discoverable authentication | `apps/web/api/src/auth/passkey-router.ts:436`, authentication begin/complete handlers                        | No-email begin already generates discoverable options and a session-bound challenge; UV is required. Email-specific branch has credential allowlists and must not be used for automatic discovery.            |
| Registration                | `passkey-router.ts`, `passkey-signup.ts`                                                                     | Resident credentials are requested; registration verification and signup email verification are separate flows. Preserve each flow's authority checks.                                                        |
| Other methods               | `apps/web/api/src/auth/password.ts`, `totp.ts`, `auth-session.ts`; corresponding route files and tests exist | Significant implementation is present despite the earlier plan's all-Planned inventory. Presence is not proof of production readiness or complete security coverage.                                          |
| Overlay primitive           | `apps/web/app/src/app/shared/ui/overlays/dialog/dialog.ts`                                                   | Existing dialog uses CDK focus trapping, Escape handling and body scroll locking. Audit focus restoration, inert background, teardown and overlapping dialogs before reusing for auth.                        |
| Tests                       | `apps/web/app-e2e/src/auth/` and `apps/web/api-e2e/src/api/auth-rework.spec.ts`                              | Existing sign-in, password fallback, registration and regression coverage is a starting point; no new acceptance suite was run for this plan.                                                                 |
| Localization                | `apps/web/app/src/locales/messages.es.xlf`, native `app:extract-i18n`                                        | Previous merge filled missing entries with English and escaped XML placeholders. Successful build and matching IDs do not demonstrate Spanish translation quality. This is unfinished work.                   |
| Local runtime               | Process inspection and `ss -ltnp '( sport = :8080 )'`                                                        | No gateway/worker process from the prior run and no listener on 8080 at planning time. Prior runtime fix and i18n changes remain uncommitted.                                                                 |

### Product and platform contract

- **REQ-001**: Distinguish an active server session, a stored passkey, a saved password, and a device hint. Only verified server authority signs a user in. A passkey may be available through a synced provider without a prior login in this browser.
- **REQ-002**: On direct page entry render a usable sign-in surface immediately. Check the session through existing auth/guards; a valid full session follows the validated destination without a credential prompt.
- **REQ-003**: Detect capabilities after browser rendering through a browser-specific adapter. Use `getClientCapabilities()` when available and `isConditionalMediationAvailable()` as fallback. Record unknown, supported, unsupported and failed detection explicitly. SSR must never access `navigator`.
- **REQ-004**: Start conditional authentication only when supported and a visible, labeled `autocomplete="username webauthn"` input is mounted. It must not block other methods or show a blocking modal on page load. A pending promise is not evidence that no passkey exists.
- **REQ-005**: Provide a primary `Continue` action. Where verified immediate-mode support exists, invoke it from a fresh user gesture; otherwise open the application method sheet. On unsuccessful immediate completion, open the sheet with neutral copy. Never claim `No account found` from capability detection, timeout, cancellation, or `NotAllowedError`.
- **REQ-006**: The native credential chooser belongs to the browser/OS/password manager and cannot be styled or populated by the application. The application sheet offers `Use a passkey`, configured Google, `Use a password`, and a visually distinct `Create an account` action. Registration is a suggestion, never an automatic side effect of failed login.
- **REQ-007**: The sheet is bottom-aligned below 768px and a centered compact dialog at 768px and above. Keep one semantic implementation, accessible title, close action, Escape, focus trapping/restoration, inert background, scroll containment, safe-area spacing and reduced-motion handling. Preserve a full-page route when opened through a direct URL.
- **REQ-008**: Keep explicit modal passkey access for phone/security-key/private-browsing users. Lack of a platform authenticator does not mean WebAuthn cannot use an external authenticator. Unknown capabilities must retain explicit access.
- **REQ-009**: Account creation requires explicit intent, email ownership and existing server proofs. Google is offered only when configured, rendered once using the official SDK. Password still requires the server-selected email/TOTP second step; recovery cannot downgrade TOTP.
- **REQ-010**: Preserve locale, safe return path, non-secret email input, and explicit back navigation. Never store passwords, codes, assertions, or inferred credential inventories in browser storage or URLs.
- **REQ-011**: The first deliverable is the Angular auth entry. Keep Astro public links pointing to that route. Do not assume transient activation survives navigation from the public site; an immediate native prompt on the public page itself is a separate integration requiring its own adapter and review.
- **SEC-001**: Discovery uses the no-email authentication-begin endpoint, required UV, existing RP/origin checks, session binding, expiry, single-use consumption, active credential checks and credential-bound membership. Add no credential-existence lookup endpoint.
- **SEC-002**: Only one credential ceremony may be active per entry owner. Abort conditional/modal operations before another method; ignore stale completions after route/state changes. A backend verification already sent can still mutate the session: serialize method transitions until it resolves, then reconcile server session state.
- **SEC-003**: Browser modal cancellation is not authorization. Prevent double submit, double session completion, stale challenges and creating accounts from abandoned login attempts. Bound challenge issuance and preserve server abuse limits.
- **CON-001**: Immediate mode is optional progressive enhancement. The current W3C explainer uses `uiMode: 'immediate'`; the 2025 Chrome trial used `mediation: 'immediate'`. Capability detection alone does not prove which experimental syntax is implemented. Do not send an unknown dictionary field to a legacy browser and assume it worked: it may silently behave as a normal modal request.
- **CON-002**: Enable immediate mode only after the current browser implementation/API spelling is verified by primary documentation and a real-browser test. Keep the adapter disabled by default until then. Do not guess UA versions, use timing probes, or attempt sequential syntaxes that may show two prompts.
- **CON-003**: Current immediate proposal requires transient activation, no allowlist and no `signal`. Preload one fresh session-bound challenge before the button is ready; if expired/not ready, fetch and require a new explicit click rather than relying on activation after a network round trip. Do not apply conditional cancellation mechanics to immediate mode; defer competing actions and discard stale results locally.
- **GUD-001**: Use existing Angular Signal Forms, browser/server provider conventions, Tailwind tokens and domain folders. Prototype through `themis-ui-prototype` before production UI work; follow frontend, design-system and E2E guidance.
- **GUD-002**: Extract through `pnpm exec nx run app:extract-i18n`, translate XLF targets manually, preserve placeholders as XML, and use native localized build validation. No replacement extraction/merge script.

### Entry state/event contract

| State / event                                         | Behavior                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `checking-session` → full session                     | Follow validated local destination; no automatic native ceremony.                                                               |
| Anonymous → `entry-ready`                             | Show usable entry, email/autofill field, Continue and Create account; start supported conditional request in background.        |
| Conditional assertion selected                        | Verify server-side once; reconcile session; navigate only after full authentication.                                            |
| Continue + verified immediate support + fresh options | End conditional request; start `immediate-pending` inside user gesture. No application dialog competing for focus.              |
| Continue without immediate availability               | End conditional request; open `method-sheet`. No simulated credential detection.                                                |
| Immediate rejected/dismissed                          | Show `method-sheet`; neutral explanation and explicit signup suggestion.                                                        |
| Choose passkey from sheet                             | Close/suspend sheet, acquire fresh options and start explicit modal; retain external-device path.                               |
| Explicit modal cancelled                              | Return to method sheet and prior input; do not open signup automatically or immediately reprompt.                               |
| Choose Google/password/signup                         | End cancellable ceremony, invalidate stale callbacks, route to chosen intention with locale/destination preserved.              |
| Close sheet                                           | Return to usable entry and opener focus; no automatic modal restart. Conditional may resume once on explicit field interaction. |
| Session/challenge expires or network fails            | Offer retry and other methods; keep account existence unknown.                                                                  |

### Earlier plan traceability

| Earlier phase | Explicit retained sub-scope                | Status                                        | Gaps                                                                                                     |
| ------------- | ------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PH-01         | Credential/security/deployment inventory   | Reconciliation required                       | Existing code exceeds documented progress; verify against tests rather than resetting or declaring done. |
| PH-02         | Complete auth prototype                    | Revised entry proposal                        | Add native-vs-application surfaces and responsive chooser; keep second-step/recovery/settings screens.   |
| PH-03         | Persistence and authority foundations      | Implementation present, acceptance unverified | Check discovery challenge lifetime, method races, grants and version invalidation.                       |
| PH-04         | Password/email/signup/reset                | Implementation present, acceptance unverified | Preserve branches and complete localized copy/destination continuity.                                    |
| PH-05         | TOTP/recovery/no downgrade                 | Implementation present, acceptance unverified | Retain full security matrix; not replaced by passkey UX testing.                                         |
| PH-06         | Google/passkey/method management           | Partially observed                            | Google rendering and first-method authorization need reconciliation.                                     |
| PH-07         | Cross-browser/security/visual verification | Pending                                       | Native provider checks and conditional/immediate matrix added here.                                      |
| PH-08         | Rollout/documentation                      | Pending                                       | Immediate path gated independently; production prerequisites remain.                                     |

## 2. Implementation Steps

All tasks are unimplemented in this proposal. PRs are self-contained slices based on current main or rebased after predecessors merge. No database migration is expected solely for the entry UI; introduce one only for a demonstrated persistence gap with separate review.

### Implementation Phase 1

- GOAL-001: Reconcile the old plan with code and establish a working cross-browser baseline.
- Dependencies: none. Exit: recorded inventory, reproducible tests and immediate API compatibility decision.

| Task     | Description                                                                                                                                                                                                                                                               | Completed | Date        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| TASK-001 | Update an evidence appendix in this plan for every PH-01–PH-08 row after inspecting `auth-router.ts`, `password.ts`, `totp.ts`, `auth-session.ts`, `passkey-signup.ts`, auth adapters and E2E assertions. Classify implemented, partial, missing and verified separately. | No        | Not started |
| TASK-002 | Record baseline results for app/API unit and existing auth E2E targets; inspect `docs/agents/e2e.md` before starting gateway dependencies. Preserve prior uncommitted runtime/i18n changes.                                                                               | No        | Not started |
| TASK-003 | Verify immediate API spelling, activation, cancellation and browser support against current primary documentation and real browsers. Record browser/OS/provider/version; default to conditional + sheet if immediate cannot be demonstrated without experimental flags.   | No        | Not started |

### Implementation Phase 2

- GOAL-002: Approve the complete interaction before implementation.
- Dependencies: phase 1. Exit: reviewed prototype in both locales, light/dark and desktop/mobile.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                      | Completed | Date        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| TASK-004 | Create `apps/web/ui-designer/src/prototypes/auth-adaptive-entry.html` using the prototype skill and existing sign-in reference. Include entry, method sheet, signup choice, conditional suggestion annotation, native prompt annotation, cancellation, loading, expiry and unsupported states. Browser-owned surfaces must be labeled illustrations, not fake app account lists. | No        | Not started |
| TASK-005 | Specify copy, focus destination and back behavior for each state above. Keep passkey use separate from passkey creation; show password/Google access without requiring a passkey failure.                                                                                                                                                                                        | No        | Not started |
| TASK-006 | Capture 360/768/1440px light/dark states, 320px overflow and mobile keyboard behavior. Record user approval and deviations in this document before phase 3 UI changes.                                                                                                                                                                                                           | No        | Not started |

### Implementation Phase 3

- GOAL-003: Ship conditional suggestions plus a complete method sheet as the cross-browser baseline.
- Dependencies: phases 1–2. Exit: saved discoverable passkey can authenticate through autofill; other users can sign in or explicitly register immediately.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                              | Completed | Date        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------- |
| TASK-007 | Introduce proposed `apps/web/app/src/app/shared/auth/passkey-browser.ts` and `passkey-server.ts` implementations bound through `app.config.ts` and the server configuration. Keep `Passkey` HTTP operations, delegate capability queries and credential calls, return typed capability snapshots. Tests cover absent methods, rejected probes, insecure context and SSR. | No        | Not started |
| TASK-008 | Add proposed `auth/sign-in/sign-in-access.ts` route-owned coordinator with typed states/events, attempt tokens, abort ownership and session reconciliation. Extend `Passkey.getCredential` through the adapter for conditional/modal mode and signal. Never run side effects from hidden components or eagerly instantiate browser APIs during SSR.                      | No        | Not started |
| TASK-009 | Update `sign-in.ts` and `sign-in.html` with visible username/autofill input and browser-only initialization. Start conditional get with discoverable options; abort before another method and on destruction, prevent stale navigation and preserve input after cancellation. Test server completion races as well as browser cancellation.                              | No        | Not started |
| TASK-010 | Implement proposed `auth/access-sheet/access-sheet.ts`, `.html`, `.css` using audited `shared/ui/overlays/dialog/` mechanics. Add the narrow responsive variant and necessary focus/inert/cleanup fixes with regression tests for existing dialog callers. One semantic dialog, no nested application/native prompts.                                                    | No        | Not started |
| TASK-011 | Connect sheet choices to existing signup/password/recovery routes and `GoogleIdentity`; render one official Google action when enabled. Centralize validated return-path completion and preserve localized legacy redirects. Add HTTP coverage if capability/flow contracts must change.                                                                                 | No        | Not started |

### Implementation Phase 4

- GOAL-004: Add immediate native credential suggestions as an independently gated enhancement.
- Dependencies: phase 3 and successful TASK-003 compatibility evidence. Exit: real supported browser shows saved credential; all other cases keep phase 3 behavior.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                       | Completed | Date        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| TASK-012 | Extend the browser adapter with the verified immediate API contract using a narrow typed extension if TypeScript lacks it; no `any` or speculative multiple calls. Gate using verified implementation support plus `immediateGet`; keep baseline enabled if compatibility is unknown.                                                                                             | No        | Not started |
| TASK-013 | Add a bounded fresh-challenge preload in `sign-in-access.ts`, tied to the session and server expiry. If expiry metadata is absent, extend `passkey-schemas.ts` and the no-email begin response with `expiresAt`, plus schema/OpenAPI/client tests. Invoke immediate get synchronously from Continue with prepared options, no allowlist and no signal under the current contract. | No        | Not started |
| TASK-014 | Cover NotAllowedError, private mode, dismissal, unsupported capability, stale challenge and stale completion. Offer the sheet once; no automatic loops, timing inference, hidden credential inventories or auto-registration. Maintain explicit external-device passkey access.                                                                                                   | No        | Not started |

### Implementation Phase 5

- GOAL-005: Complete registration continuity and authentic bilingual copy.
- Dependencies: phase 3; can proceed while phase 4 compatibility work is blocked. Exit: both locales complete every available method with correct copy and placeholders.

| Task     | Description                                                                                                                                                                                                                                                                                                   | Completed | Date        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| TASK-015 | Update `sign-up/sign-up.*` to receive explicit creation intent from the sheet and retain direct-route support, password fallback and existing email verification. Preserve pending-versus-active credential semantics in `passkey-signup.ts`; do not change proof order without separate security acceptance. | No        | Not started |
| TASK-016 | Mark previously unlocalized validation/errors in touched auth routes with custom i18n IDs and `$localize`. Reconcile visible password policy with `password.ts` and the earlier plan instead of introducing another client-only policy.                                                                       | No        | Not started |
| TASK-017 | Run native `app:extract-i18n`; translate all active Spanish targets including earlier English fallbacks, repair escaped `<x>` placeholders, and review rendered interpolation/link output. Keep native missing-translation errors; source/target count alone is insufficient.                                 | No        | Not started |

### Implementation Phase 6

- GOAL-006: Verify the journey, reconcile remaining refactor gaps, and record rollout evidence.
- Dependencies: phases 3 and 5; phase 4 remains disabled if unverified. Exit: required matrix below is green, or clearly blocked with exact evidence; no blanket assertion that all auth is finished.

| Task     | Description                                                                                                                                                                                                                                                                                                                           | Completed | Date        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| TASK-018 | Extend `apps/web/app-e2e/src/auth/sign-in.spec.ts`, `registration-options.spec.ts`, `password-fallback.spec.ts`, `review-regressions.spec.ts` and proposed `adaptive-entry.spec.ts`. Test real virtual-authenticator authentication separately from mocked capability/negative states. Add deterministic application-sheet snapshots. | No        | Not started |
| TASK-019 | Extend `passkey-router.spec.ts`, `apps/web/api-e2e/src/api/auth-rework.spec.ts` and durable tests as needed for session binding, expiry, replay, double completion, pending credential rejection, membership selection and password/TOTP non-downgrade.                                                                               | No        | Not started |
| TASK-020 | Execute the validation matrix; record screenshots, commands and real-provider browser evidence. Update every earlier phase row with observed gaps, document immediate disable/fallback behavior and recommended next refactor slice. Do not deploy as part of this plan.                                                              | No        | Not started |

## 3. Alternatives

- **ALT-001**: Launch modal WebAuthn on every page load. Rejected: disruptive, cross-device prompts for users without passkeys, and poor activation compatibility.
- **ALT-002**: Infer no account from `isSupported`, UVPAA, a timeout or cancellation. Rejected: all conflate capability/availability/intent with account existence.
- **ALT-003**: Implement only immediate mode. Rejected: evolving API and support; native/mobile APIs are not interchangeable with web APIs.
- **ALT-004**: Show an application-built list of saved passkeys before authentication. Rejected: browser-owned discovery and privacy; no pre-auth credential inventory.
- **ALT-005**: Require a passkey provider SDK, native mobile app or new auth platform. Rejected for this slice: existing WebAuthn backend and standard browser integration suffice.
- **ALT-006**: Move all auth into the Astro header now. Deferred: expands application ownership and user-activation/session coordination; direct localized auth entry addresses the requested first journey.

## 4. Dependencies

- **DEP-001**: Existing SimpleWebAuthn server verification, session store, PostgreSQL and Redis infrastructure.
- **DEP-002**: Stable HTTPS origin/RP ID, with localhost development behavior tested separately. Do not change RP ID as a UI refactor; existing credentials are RP-bound.
- **DEP-003**: Angular browser/server DI, Signal Forms, CDK accessibility and shared dialog primitives.
- **DEP-004**: Google runtime configuration and SDK availability; unavailable Google must not block other methods.
- **DEP-005**: Prototype approval and real-device/provider access. Playwright cannot prove native OS chooser appearance or provider synchronization.
- **DEP-006**: Remaining earlier-plan security/deployment prerequisites stay required; this plan creates no Themis work items and assumes no prior phase approval.

## 5. Files

- **FILE-001**: `apps/web/app/src/app/auth/sign-in/sign-in.*` and proposed `sign-in-access.ts`: entry/state orchestration.
- **FILE-002**: `apps/web/app/src/app/shared/auth/passkey.ts`, proposed `passkey-browser.ts`/`passkey-server.ts`, app provider configuration: typed browser capabilities and ceremonies.
- **FILE-003**: Proposed `apps/web/app/src/app/auth/access-sheet/access-sheet.*` and existing `shared/ui/overlays/dialog/`: responsive accessible method selection.
- **FILE-004**: `auth/sign-up/sign-up.*`, `shared/auth/google-identity.ts`, `shared/auth/auth.ts`, `app.routes.ts`, route constants: intention and session/destination continuity.
- **FILE-005**: `apps/web/api/src/auth/passkey-router.ts`, `passkey-schemas.ts` and associated tests: only demonstrated challenge/API gaps.
- **FILE-006**: `apps/web/app/src/locales/messages.xlf` and `messages.es.xlf`: native extraction and real translations.
- **FILE-007**: Existing auth browser/API tests, proposed `adaptive-entry.spec.ts`, and proposed prototype: regression and review evidence.

## 6. Testing

Nx targets below were verified using `nx show project` during planning. Load Node with fnm first. Inspect executor help before adding file-selection flags; follow the full-server E2E playbook rather than inventing standalone gateway setup.

| Category    | Required                                   | Commands / evidence                                                                                                                                                           |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit        | Yes                                        | `pnpm exec nx run app:vite:test`; `pnpm exec nx run api:test`; capability matrix, abort ownership, stale callbacks, session reconciliation and SSR.                           |
| api         | Yes if contract/challenge behavior changes | `pnpm exec nx run api-e2e:e2e`; `pnpm exec nx run api-e2e:openapi`; durable target for mutation/concurrency changes.                                                          |
| app-e2e     | Yes                                        | `pnpm exec nx run app-e2e:e2e`; existing auth specs plus proposed adaptive-entry scenarios.                                                                                   |
| gateway-e2e | Yes                                        | `pnpm exec nx run server-e2e:e2e`; localized SSR routes, sessions, redirect continuity.                                                                                       |
| site-e2e    | Yes                                        | `pnpm exec nx run site-e2e:e2e`; public Sign in/Create account links reach matching locale and intention.                                                                     |
| visual      | Yes                                        | App-owned entry/sheet/error/signup screenshots at 360/768/1440, light/dark and both locales; 320px overflow check. Native UI requires separate real-device evidence.          |
| security    | Yes                                        | Replay/expiry/wrong-session/revoked/pending credential rejection; no account enumeration; required UV; password/TOTP fallback unchanged; double-submit and method-race tests. |
| build       | Yes                                        | `pnpm exec nx run app:build:production`; `pnpm exec nx run server:build`; `pnpm exec nx run app:lint`; `pnpm exec nx run api:lint`.                                           |
| i18n        | Yes                                        | `pnpm exec nx run app:extract-i18n` and localized build; rendered Spanish assertions and XML placeholder review, not only successful extraction.                              |

- **TEST-001**: Known discoverable credential completes conditional login; empty authenticator leaves fallback usable indefinitely.
- **TEST-002**: Capabilities absent/false/rejected and SSR produce usable pages; UVPAA false does not suppress external passkeys.
- **TEST-003**: Password submit, Google, signup, route destroy and retry end conditional ownership; no stale callback changes route or authenticates a different intended account.
- **TEST-004**: Immediate supported with credential, no credential, private mode and cancellation; no duplicate prompts; expired options require fresh explicit activation. Verify actual API spelling and no accidental modal fallback.
- **TEST-005**: Phone/security key path remains accessible after immediate failure; browsers without immediate mode still complete login/signup.
- **TEST-006**: Keyboard/screen reader focus, Escape/back, inert background, mobile keyboard, scroll-lock teardown, zoom and reduced motion work for the sheet.
- **TEST-007**: Existing account collision during signup never overwrites credentials or creates an unauthorized membership; refresh/back does not skip email/credential verification.
- **TEST-008**: Real-provider checks cover Safari iOS/macOS, Chrome Android/desktop, Windows Hello and Firefox/Linux without a platform passkey provider. Record precise tested versions and unavailable combinations; do not infer coverage from emulation.

## 7. Risks & Assumptions

- **RISK-001**: Browser support and proposal syntax evolve. The current W3C explainer differs from older Chrome examples. Immediate mode remains independently gated and cannot block baseline release.
- **RISK-002**: Conditional requests may outlive backend challenges. Renewal must be bounded, expiry-aware and tied to deliberate interaction; avoid continuous challenge issuance or server session rotation on every focus.
- **RISK-003**: Browser abort does not roll back submitted server verification. Session reconciliation and serialized transitions are necessary, not just ignored UI promises.
- **RISK-004**: Existing Google `showGoogle` can start a new identity flow; audit whether this invalidates passkey preloaded state or rotates session binding before sharing an entry coordinator.
- **RISK-005**: Prior Spanish catalog repairs are incomplete; missing translation errors do not detect English targets or escaped placeholder text. Treat the earlier completion statement as insufficient evidence.
- **RISK-006**: Earlier plan contains stale component paths and Planned statuses while code already exists. Reconcile instead of rebuilding or declaring all remaining auth complete.
- **ASSUMPTION-001**: The desired product resemblance concerns low-friction saved-credential access and responsive alternatives, not pixel-identical browser UI or identical Amazon/Revolut internals.
- **ASSUMPTION-002**: Account creation is prominently offered when the native path does not complete, but existing users retain equally discoverable alternative access. User approval confirms the prototype's precise hierarchy.

## 8. Related Specifications / Further Reading

Research date: 2026-09-17. Search results are discovery aids; implementation decisions use primary documentation and real-browser evidence.

- Existing contract: [Passkey, Google and password refactor](refactor-auth-passkey-google-password-1.md).
- Historical direction: `docs/specs/2026-09-01-auth-passwordless-identity/` and `plan/refactor-passwordless-identity-federated-fallback-1.md`.
- [WebAuthn immediate-mode current explainer](https://github.com/w3c/webauthn/blob/main/explainers/immediate-mediation.md): `uiMode`, activation, no allowlist, no signal, privacy/fallback limitations.
- [Chrome 2025 origin trial](https://developer.chrome.com/blog/webauthn-immediate-mediation-ot): historical `mediation` syntax, not proof of current universal availability.
- [Passkey form autofill](https://web.dev/articles/passkey-form-autofill): conditional requests and visible username field.
- [Client capability detection](https://web.dev/articles/webauthn-client-capabilities): features, not credential inventory.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/): normative platform behavior.
- [Amazon About Passkey](https://www.amazon.com/gp/help/customer/display.html?nodeId=TPphmhSWBgcI9Ak87p): provider-synced credentials; does not establish an identical entry UI across all clients.
- [Revolut passkeys](https://help.revolut.com/en-US/help/profile-and-plan/log-in-issues/what-are-passkeys/) and [lost passkey access](https://help.revolut.com/en-DE/help/profile-and-plan/log-in-issues/i-lost-access-to-my-passkey/): passkey use and retained alternative access, not evidence of private implementation details.
- [Angular translation files](https://angular.dev/guide/i18n/translation-files): extraction and actual translation are distinct tasks.
