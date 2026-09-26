---
goal: Repair passwordless identity and add secure new-device and Google fallback paths
version: 1.0
date_created: 2026-09-07
last_updated: 2026-09-07
owner: Visomi Stack
status: 'In progress'
tags: [auth, passkeys, webauthn, google, recovery, security, refactor]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

This plan replaces the broken identity implementation with one explicit server-owned state machine. It keeps passkeys as the preferred phishing-resistant authority, requires proof of account control before enrolling a credential, and adds Sign in with Google as a federated fallback without silently linking accounts by email.

## 1. Requirements & Constraints

- **REQ-001**: `/app/{locale}/auth/identity` MUST expose one primary Continue action that starts discoverable passkey authentication.
- **REQ-002**: A successful assertion from an active passkey MUST establish a full session for the account bound to that credential.
- **REQ-003**: A cancelled or unavailable discoverable ceremony MUST allow email identification without claiming that the server can silently detect whether a passkey exists.
- **REQ-004**: A new email identity MUST verify the email, create the user and personal account atomically, create a discoverable passkey, verify that passkey with a second assertion, and only then establish a full session.
- **REQ-005**: An existing user without an available passkey MUST authorize a new credential through an active passkey on another device, a previously linked Google identity, or an explicit email recovery flow.
- **REQ-006**: Existing-device approval MUST produce a short-lived, one-time enrollment grant bound to user, account, requesting browser session, and new credential enrollment.
- **REQ-007**: Email recovery MUST be presented as a lower-assurance recovery path, not as passkey authentication, and MUST notify the account after use.
- **REQ-008**: Sign in with Google MUST be available when WebAuthn is unavailable and SHOULD remain available as an explicit alternative when WebAuthn exists but no usable provider is configured.
- **REQ-009**: Google identities MUST be keyed by the immutable `(issuer, sub)` pair. Email MUST NOT be used as the persistent federated identifier.
- **REQ-010**: A Google identity MUST NOT be automatically linked to an existing Visomi user based only on matching email. Linking requires an authenticated session, an existing-device approval grant, or the explicit recovery policy.
- **SEC-001**: WebAuthn challenges MUST be single-use, short-lived, session-bound, RP-ID-bound, origin-bound, ceremony-typed, and credential-bound when a specific credential is expected.
- **SEC-002**: Passkeys MUST be discoverable credentials (`residentKey: 'required'`) with user verification required.
- **SEC-003**: Newly attested credentials MUST remain `pending` and unusable for ordinary authentication until the verification assertion activates both credential and enrollment.
- **SEC-004**: Authentication MUST resolve the account from the verified credential, never from a user's default membership.
- **SEC-005**: Google ID tokens MUST be verified server-side for signature, `iss`, `aud`, `exp`, and nonce/CSRF binding. The backend MUST reject unverified email claims.
- **SEC-006**: Email, Google, passkey, approval, and recovery endpoints MUST preserve enumeration resistance and have independent rate limits.
- **SEC-007**: Recovery and federated linking transitions MUST emit durable audit events.
- **CON-001**: Angular SSR MUST not access browser globals directly. Browser-only Google and WebAuthn adapters MUST use `DOCUMENT.defaultView`.
- **CON-002**: Google configuration is optional. Missing `GOOGLE_AUTH_CLIENT_ID` MUST disable the provider without breaking passkey or email bootstrap.
- **CON-003**: The feature MUST preserve account tenancy and selected-account context through Passport serialization and deserialization.
- **CON-004**: All schema, API, UI, test, and documentation artifacts MUST be written in English.
- **GUD-001**: Use Google Identity Services with FedCM support rather than the deprecated Google Sign-In platform library.
- **GUD-002**: Use an explicit Google button. Do not add automatic One Tap sign-in in this refactor.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Restore passkey ceremony, account binding, and session invariants before adding another authority.

| Task     | Description                                                                                                                                                                | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-001 | Set `req.session.authority` during restricted and full transitions in `apps/web/api/src/auth/auth-router.ts` and `apps/web/api/src/auth/passkey-router.ts`.                | ✅        | 2026-09-07 |
| TASK-002 | Authenticate the selected restricted account and deserialize the serialized account in `apps/web/api/src/auth/passport.ts`.                                                | ✅        | 2026-09-07 |
| TASK-003 | Mark existing users' email as verified after a valid OTP in `apps/web/api/src/auth/auth-service.ts`.                                                                       | ✅        | 2026-09-07 |
| TASK-004 | Make passkeys discoverable, store new credentials as pending, bind verification challenges to the credential and enrollment, and activate only after the second assertion. | ✅        | 2026-09-07 |
| TASK-005 | Verify SimpleWebAuthn assertions with the external credential ID and resolve the full session from the credential's account.                                               | ✅        | 2026-09-07 |
| TASK-006 | Set the session-presence cookie after full authentication and force Angular to refresh `/api/auth/session`.                                                                | ✅        | 2026-09-07 |
| TASK-007 | Apply `drizzle/20260907090000_auth_passkey_session_fix/migration.sql` to permit account-less discoverable challenges and reconcile passkey indexes.                        | ✅        | 2026-09-07 |
| TASK-008 | Add focused API and Angular regression tests for all Phase 1 invariants and replace the misleading app E2E bootstrap helper with a real virtual-authenticator ceremony.    |           |            |

### Implementation Phase 2

- GOAL-002: Replace component-local branching with an explicit identity-flow contract.

| Task     | Description                                                                                                                                                                                                                                                      | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-009 | Add an opaque `auth_identity_flows` record with state, expiry, session binding, normalized email hash, user/account references, authorization method, and terminal timestamps in `libs/shared/src/lib/db/schema.ts`.                                             | ✅        | 2026-09-07 |
| TASK-010 | Add `/api/auth/identity/start`, `/identify`, and `/status` schemas and handlers. Return generic next actions so known-email responses do not enumerate accounts.                                                                                                 | ✅        | 2026-09-07 |
| TASK-011 | Refactor `apps/web/app/src/app/auth/identity/identity.ts` to consume server states: `passkey`, `identify`, `verify_new_email`, `authorize_existing_account`, `enroll_passkey`, and `complete`.                                                                   |           |            |
| TASK-012 | Detect WebAuthn capability using `PublicKeyCredential`, `navigator.credentials`, secure context, and platform-authenticator capability where available. Treat platform availability as a UX hint, not proof that no roaming or cross-device credential can work. |           |            |
| TASK-013 | Add route restoration so a restricted flow survives refresh without exposing verified email or account choices to an unrelated browser session.                                                                                                                  |           |            |

### Implementation Phase 3

- GOAL-003: Authorize a new device from an already authenticated device.

| Task     | Description                                                                                                                                                                     | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-014 | Add `auth_device_approval_requests` with hashed user code, requester session hash, account/user binding, expiry, attempts, approval credential, and consumed/denied timestamps. | ✅        | 2026-09-07 |
| TASK-015 | Add requester endpoints to create, poll, approve, and consume an approval request; use generic responses before email ownership is verified.                                    | ✅        | 2026-09-07 |
| TASK-016 | Add an authenticated approval page that requires a fresh active-passkey assertion and displays account, approximate device, location context, and expiry before approval.       |           |            |
| TASK-017 | Convert an approved request into a one-time passkey enrollment grant bound to the requesting session and selected account.                                                      | ✅        | 2026-09-08 |
| TASK-018 | Deliver approval status through polling first; add realtime fanout only if latency requirements justify the additional runtime dependency.                                      | ✅        | 2026-09-08 |

### Implementation Phase 4

- GOAL-004: Add explicit email recovery for users who cannot access any active passkey or approved device.

| Task     | Description                                                                                                                                    | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-019 | Separate `new_email_verification` from `existing_account_recovery` purposes, templates, rate limits, and audit events.                         | ✅        | 2026-09-07 |
| TASK-020 | Require a new one-time recovery code for existing accounts, bind it to the identity flow and requester context, and consume it atomically.     | ✅        | 2026-09-07 |
| TASK-021 | Issue a short-lived enrollment-only grant after recovery; do not issue a full session until the new pending passkey is asserted and activated. | ✅        | 2026-09-08 |
| TASK-022 | Notify the account after recovery, revoke outstanding recovery grants, and expose recent recovery events in security settings.                 | ✅        | 2026-09-08 |

### Implementation Phase 5

- GOAL-005: Add Sign in with Google as a federated fallback and enrollment authority.

| Task     | Description                                                                                                                                                                                              | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-023 | Add `user_federated_identities` with provider, issuer, subject, user ID, email-at-link, linked/last-used/revoked timestamps, and unique `(issuer, subject)` constraint.                                  | ✅        | 2026-09-07 |
| TASK-024 | Add optional validated `GOOGLE_AUTH_CLIENT_ID` configuration and a public provider-capabilities response that exposes only whether Google auth is enabled and its client ID.                             | ✅        | 2026-09-07 |
| TASK-025 | Add the Google Identity Services browser adapter under `apps/web/app/src/app/shared/auth/`, loaded through the repository's `Deps` boundary, and render the official button on identity fallback states. | ✅        | 2026-09-08 |
| TASK-026 | Add `POST /api/auth/google/complete` to verify the ID token server-side and bind it to the initiating browser using nonce and CSRF state.                                                                | ✅        | 2026-09-07 |
| TASK-027 | For a known `(issuer, sub)`, establish a full session for the linked account. For a new Google subject, create a new user only after policy checks. Never silently attach it to an existing email match. | ✅        | 2026-09-07 |
| TASK-028 | Permit an explicitly linked Google identity to authorize a new passkey enrollment, then encourage passkey creation after federated sign-in.                                                              | ✅        | 2026-09-08 |
| TASK-029 | Update CSP, COOP, privacy documentation, consent configuration, and local/production authorized origins for Google Identity Services and FedCM.                                                          |           |            |

### Implementation Phase 6

- GOAL-006: Complete management, observability, and release validation.

| Task     | Description                                                                                                                                                  | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------- |
| TASK-030 | Add passkey, trusted-device, federated-identity, and recovery-event management to `/security`.                                                               | ✅        | 2026-09-08 |
| TASK-031 | Add durable `auth_audit_events` for all successful and rejected authority transitions without storing raw tokens, PINs, credential payloads, or precise PII. |           |            |
| TASK-032 | Add API, app E2E, gateway E2E, visual, accessibility, security, and production-build evidence for every terminal path.                                       |           |            |
| TASK-033 | Update `docs/product/auth-flow.md` and `docs/architecture/backend/auth.md`; remove stale password-era endpoint descriptions.                                 | ✅        | 2026-09-07 |

## 3. Alternatives

- **ALT-001**: Create a passkey before asking for email and attach it later. Rejected because an unbound credential does not prove ownership of an existing account and complicates replay-safe enrollment.
- **ALT-002**: Treat any email OTP as equivalent to an active passkey. Rejected as the default because email recovery is phishable and would reduce account security to the weakest fallback.
- **ALT-003**: Automatically link Google to an existing account when emails match. Rejected because Google documents `sub`, not email, as the stable identifier and is not authoritative for every third-party email domain.
- **ALT-004**: Show Google only when `PublicKeyCredential` is absent. Rejected because Firefox on Linux may expose WebAuthn while lacking a convenient configured platform passkey provider; capability detection cannot prove credential availability.
- **ALT-005**: Use the deprecated Google Sign-In platform library. Rejected in favor of Google Identity Services with FedCM support.

## 4. Dependencies

- **DEP-001**: `@simplewebauthn/server` remains the WebAuthn server implementation.
- **DEP-002**: Google OAuth consent branding and a Web OAuth client ID with every deployed and local JavaScript origin configured.
- **DEP-003**: A server-side Google ID-token verifier such as `google-auth-library`, added only in Phase 5.
- **DEP-004**: Mail delivery for new-email verification, recovery codes, and post-recovery notifications.
- **DEP-005**: PostgreSQL migrations for identity flows, approvals, federated identities, and audit events.

## 5. Files

- **FILE-001**: `apps/web/api/src/auth/auth-router.ts`, `auth-service.ts`, `passport.ts`, `passkey-router.ts`, `passkey-schemas.ts`, and focused specs.
- **FILE-002**: `apps/web/api/src/types/express.d.ts` for authority and flow session bindings.
- **FILE-003**: `apps/web/app/src/app/auth/identity/*` and `apps/web/app/src/app/shared/auth/*` for orchestration and browser adapters.
- **FILE-004**: `libs/shared/src/lib/db/schema.ts` and new `drizzle/*/migration.sql` files.
- **FILE-005**: `apps/web/api-e2e`, `apps/web/app-e2e`, and `apps/web/server-e2e` auth scenarios.
- **FILE-006**: `docs/product/auth-flow.md` and `docs/architecture/backend/auth.md`.

## 6. Testing

- **TEST-001**: Unit: challenge hash, session binding, ceremony type, external credential ID, pending-to-active transition, account preservation, and replay rejection.
- **TEST-002**: API: new email bootstrap through full session using a virtual authenticator.
- **TEST-003**: API: discoverable active passkey authentication and rejection of pending, revoked, wrong-origin, wrong-RP, expired, replayed, and cross-session credentials.
- **TEST-004**: App E2E: passkey success, cancellation, unsupported browser, new email, existing account approval, email recovery, and Google fallback.
- **TEST-005**: Gateway E2E: session and hint cookies survive same-origin composition and restore the selected account after refresh.
- **TEST-006**: Visual: deterministic light/dark screenshots for every identity state at mobile and desktop widths.
- **TEST-007**: Security: enumeration parity, rate limits, CSRF, Google token validation, nonce replay, account-linking conflict, and recovery audit events.
- **TEST-008**: Build: `pnpm nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production`.

Validation matrix:

| Category    | Requirement    | Command or evidence                                                                             |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------- |
| unit        | Required       | `pnpm nx run-many -t test --projects api,app --skipNxCache`                                     |
| api         | Required       | `pnpm nx run api-e2e:e2e --skipNxCache` and `pnpm nx run api-e2e:openapi --skipNxCache`         |
| app-e2e     | Required       | `pnpm nx run app-e2e:e2e --skipNxCache`                                                         |
| gateway-e2e | Required       | `pnpm nx run server-e2e:e2e --skipNxCache`                                                      |
| site-e2e    | Not applicable | The auth route is owned by Angular and the gateway; the Astro site receives no behavior change. |
| visual      | Required       | `pnpm nx run app-e2e:e2e --skipNxCache -- --grep visual` plus snapshot review                   |
| security    | Required       | Negative API scenarios in TEST-003 and TEST-007 plus OpenAPI contract verification              |
| build       | Required       | TEST-008                                                                                        |

## 7. Risks & Assumptions

- **RISK-001**: Email recovery weakens phishing resistance. Product copy, audit events, notifications, rate limits, and optional cooling periods must make that downgrade explicit.
- **RISK-002**: Browser support is not equivalent to local passkey availability. The UI must offer alternatives after cancellation or provider failure without asserting that no credential exists.
- **RISK-003**: Multi-account users can be signed into the wrong tenant if account ID is not preserved through every challenge and Passport serialization boundary.
- **RISK-004**: Existing production migrations differ from the Drizzle schema. Every migration must be tested against both an empty database and an upgraded database.
- **RISK-005**: Google popup/FedCM behavior depends on CSP, COOP, authorized origins, browser privacy settings, and provider configuration.
- **ASSUMPTION-001**: Email OTP remains an accepted account-recovery method despite being lower assurance than passkeys or a linked federated identity.
- **ASSUMPTION-002**: Initial existing-device approval may poll; realtime delivery is optional.

Phase traceability:

| Phase                | Work-item ID(s) or explicit sub-scope | Status      | Gaps                                                                          |
| -------------------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `passkey-foundation` | `TASK-001` through `TASK-008`         | in_progress | Regression and real-ceremony E2E tests remain.                                |
| `identity-contract`  | `TASK-009` through `TASK-013`         | in_progress | Angular server-state rendering and refresh restoration remain.                |
| `device-approval`    | `TASK-014` through `TASK-018`         | in_progress | Approval context display and full browser flow coverage remain.               |
| `email-recovery`     | `TASK-019` through `TASK-022`         | in_progress | Production notification delivery and full browser flow coverage remain.       |
| `google-fallback`    | `TASK-023` through `TASK-029`         | in_progress | CSP/origins, explicit linking UI, and provider-console setup remain.          |
| `release-hardening`  | `TASK-030` through `TASK-033`         | in_progress | Broader E2E, visual, accessibility, security, and production evidence remain. |

## 8. Related Specifications / Further Reading

- [Existing passwordless identity plan](../docs/specs/2026-09-01-auth-passwordless-identity/plan.md)
- [MDN Passkeys](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys)
- [MDN Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)
- [FIDO Alliance synced passkey deployment practices](https://fidoalliance.org/wp-content/uploads/2024/05/Synced-Passkey-Deployment_-Emerging-Practices-for-Consumer-Use-Cases_2024-Final.pdf)
- [Google passkey user journeys](https://developers.google.com/identity/passkeys/ux/user-journeys)
- [Google Identity Services supported browsers](https://developers.google.com/identity/siwg/supported-browsers)
- [Verify Google ID tokens server-side](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
