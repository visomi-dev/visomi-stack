# Real-device authentication validation

Status: **NOT RUN — pending human execution.** This runbook complements
[authentication lifecycle verification](auth-lifecycle-verification.md). Automated
WebAuthn emulation and mocked Google tokens do not establish physical-device or
live-provider acceptance.

## Preconditions and operator inputs

Use an existing, approved test environment and disposable test identities. Record
the deployed revision, operator, UTC time, public URL, and device/browser versions.
Preparing this document does not authorize deployment, configuration changes, or
account/credential mutations. The human operator must approve the test identities
and enrollment, linking, removal, and revocation steps before executing them.

Confirm the following existing settings with the environment owner; never paste
secret values into evidence:

| Setting                                                                                       | Required check                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`                                                                                | Public HTTPS application base, including its app path (for example `https://auth.example.test/app`). Use the environment's actual localized app URL when navigating.                                                 |
| `WEBAUTHN_ORIGIN`                                                                             | Exact browser origin, including a non-default port if used; no path or trailing slash. Defaults to the origin of `APP_BASE_URL`. This value also gates authentication mutation origin checks.                        |
| `WEBAUTHN_RP_ID`                                                                              | Stable hostname without scheme, port, or path. Use the origin hostname, or a deliberately approved registrable parent domain permitted by WebAuthn. The implemented default is `localhost`, not the public hostname. |
| `COOKIE_SECURE`                                                                               | `true` for this HTTPS exercise; defaults to true with `NODE_ENV=production`. Confirm session cookies actually persist through the gateway.                                                                           |
| `GOOGLE_AUTH_CLIENT_ID`                                                                       | Existing Google OAuth **Web application** client ID. The same ID is sent to Google Identity Services and checked as the ID-token audience by the API. Empty disables Google.                                         |
| `MAIL_TRANSPORT`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, optional `MAILGUN_URL` | Existing working mail delivery for verification/password flows. `MAIL_TRANSPORT=memory` sends no real email. Record delivery readiness, not credentials.                                                             |
| `SESSION_SECRET`, `SESSION_MAX_AGE_MS`, `REDIS_URL`                                           | Existing stable session configuration and healthy managed session storage. Do not rotate these during verification.                                                                                                  |
| `AUTH_TOTP_ENROLLMENT_ENABLED`, `AUTH_TOTP_ENCRYPTION_KEY`                                    | If testing password plus authenticator, confirm enrollment availability and existing key continuity; do not reveal or replace the key.                                                                               |
| `ENABLE_TEST_API`                                                                             | Keep false for real-provider/device acceptance; production rejects enabling it.                                                                                                                                      |

All devices must reach the same trusted HTTPS origin with a valid certificate.
A phone's `localhost` is the phone itself; HTTP LAN addresses are not a substitute
for a secure WebAuthn origin. Changing RP ID makes existing credentials unsuitable
for the new RP; do not change it to make a test pass.

Ask the Google client owner to confirm that the exact public origin is already in
Authorized JavaScript origins and the test accounts are eligible under its consent
screen/test-user and organization policies. This integration loads
`https://accounts.google.com/gsi/client` and exchanges an ID token via a JavaScript
callback; it implements no Google client-secret setting or OAuth redirect callback
requirement. Confirm provider script/network access and record browser popup,
tracking-protection, and FedCM behavior without weakening security settings globally.

Required human inputs: approved URL/revision and configuration confirmation; test
identity A with a verified mailbox and independently tested fallback; matching
Google account A and a different Google account B; Android, iOS, and macOS devices;
a FIDO2 key supporting discoverable credentials and PIN/biometric verification;
available USB/NFC transports; and an approved evidence location. Reuse existing
fixtures where possible. Mark unavailable device/fixture cases **NOT RUN**.

## Physical passkey matrix

For each row, run P1–P4 and record exact OS/browser, passkey provider, device model,
and transport. A synchronized credential is not evidence of an independently
enrolled second credential.

| ID  | Physical case                                                                                                                                             | Result  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| D1  | Android + Chrome, Google Password Manager or the selected credential provider; screen lock/biometric verification                                         | NOT RUN |
| D2  | iPhone/iPad + Safari, iCloud Keychain or the selected provider; Face ID/Touch ID/device passcode                                                          | NOT RUN |
| D3  | macOS + Safari, platform passkey with Touch ID or supported local verification                                                                            | NOT RUN |
| D4  | macOS + Chrome, repeat sign-in with the available platform/provider credential                                                                            | NOT RUN |
| D5  | Physical FIDO2 key over USB on desktop, then NFC on a supported phone/browser; record each transport separately                                           | NOT RUN |
| D6  | Provider-synchronized credential on a second physical device in the same provider account; separately record cross-device QR/Bluetooth sign-in if offered | NOT RUN |

1. **P1 — Enrollment and activation.** Sign in as A and open Security → Add passkey.
   Follow the offered authorization path (existing passkey, linked Google, first
   password-passkey setup, or approved-device setup as applicable). Complete native
   creation and the app's subsequent verification steps. Confirm the credential is
   active, has its chosen label, and survives a page reload. Merely accepting the
   native creation dialog is not proof of completed enrollment. Registration requires
   both a discoverable credential and user verification; touch-only/U2F keys are not
   equivalent to a compatible FIDO2 key.
2. **P2 — Fresh sign-in.** Sign out, start a fresh sign-in at the same origin, and
   choose the passkey. Complete biometric/PIN verification; confirm A's expected
   workspace and an authenticated page. Check the credential's last-used value.
   For D6, identify whether this was provider sync or a cross-device assertion;
   neither should silently enroll a duplicate credential.
3. **P3 — Cancel and retry.** Cancel native registration before creation, cancel an
   assertion, and cancel Google/native authorization when offered. Confirm no false
   success, no authenticated session from a canceled sign-in, and a usable retry.
   Repeat with a key absent or unplugged. Record timeout/unsupported errors and
   recovery UI; do not deliberately exhaust hardware PIN retries.
4. **P4 — Protected action.** Rename the test passkey through Security, completing
   fresh confirmation. Confirm the intended action resumes and persists. Start
   another protected action, cancel confirmation, and verify no mutation occurs.
   Reconfirm when prompted; a previous action's confirmation must not authorize an
   unrelated action automatically.

## Access preservation and credential revocation

Before successful removal, prove a separate sign-in method in another browser
session and keep it available. TOTP, recovery codes, email possession, trusted-device
records, and a still-open session do not count as ordinary replacement sign-in
methods for the implemented last-access guard.

- **A1 — Last method:** On approved sole-method fixtures, attempt to revoke the
  only active passkey, remove the only password, or disconnect the only Google
  identity. Expect blocked removal and unchanged access. A server attempt should
  report `409 last_access_method`; UI prevention may stop the request earlier.
- **A2 — Scope:** For an existing multi-workspace fixture, removing a global
  password/Google method must preserve usable access in every membership. A passkey
  only covers its own workspace. Do not treat a passkey in workspace A as a fallback
  for workspace B.
- **A3 — Successful revocation:** With the fallback verified, revoke a disposable
  passkey and attempt a fresh sign-in using that exact credential, including its
  synchronized copy if available. It must not authenticate. Provider storage may
  still display it; server revocation does not delete the provider's copy. Confirm
  the independently enrolled fallback still works.

## Live Google flows

Use real Google UI, not injected tokens. Begin a new flow after cancellation or
failure so the browser receives a fresh session-bound nonce.

| ID  | Procedure and expected result                                                                                                                                                                                                                                                    | Result  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| G1  | With A's existing application identity not yet linked, select matching Google A at sign-in. Expect `409 google_link_required`, not an automatic email-based merge.                                                                                                               | NOT RUN |
| G2  | Sign in as A through an existing method. Security → Connect Google; complete identity confirmation, then select matching verified Google A. Confirm one connected identity and fresh Google sign-in to A's existing workspace.                                                   | NOT RUN |
| G3  | While linking as A, select Google B with a different email. Expect `401 google_token_invalid`, no link, and A's original session/identity preserved. Cancel and retry with A.                                                                                                    | NOT RUN |
| G4  | For a protected action, reauthenticate with linked Google A. Expect the intended action to resume. Repeat using unlinked Google B: expect `401 reauthentication_failed` and no protected mutation.                                                                               | NOT RUN |
| G5  | If an already-approved fixture has a changed application email, reauthenticate using its original linked Google account. Acceptance must follow the active issuer/subject link, not current email equality. Do not change email solely to satisfy this runbook without approval. | NOT RUN |
| G6  | Cancel the Google chooser; navigate away while it is open; retry from a fresh flow. Expect no stale callback mutation, no false success, and usable recovery. Record blocked popup/FedCM/provider-script behavior per browser.                                                   | NOT RUN |
| G7  | With an independently verified fallback, disconnect Google A. Google reauthentication must no longer be offered for that link. A fresh Google sign-in matching A's unchanged application email must require explicit linking again (`google_link_required`).                     | NOT RUN |

The backend validates signature/audience plus verified email, nonce, and issuer
`https://accounts.google.com`. Initial linking also matches the current application
email; reauthentication instead requires the active linked `issuer` + `subject`.
Choosing B at ordinary sign-in can legitimately sign into B or create a new identity;
it is not a wrong-account rejection test. Run wrong-account checks in linking or
reauthentication to avoid unintended signup. Do not fabricate token claims or change
Google accounts to simulate a same-email/different-subject case; document that case
as unavailable unless an approved fixture exists.

## Session revocation

1. **S1:** Sign in as A in two independent browsers/devices (S-A and S-B). Open
   Security → Manage active sessions; confirm the current-session marker and the
   second session. Trusted devices are a separate list.
2. **S2:** From S-A, revoke S-B with fresh confirmation. On S-B, reload a protected
   page and trigger a protected API-backed action: expect authentication rejection
   or sign-in routing, even if cached content was visible. S-A must remain usable.
3. **S3:** Create approved additional test sessions and use revoke-other-sessions
   from S-A. Confirm each other session loses access on its next protected request,
   S-A survives, and refreshed session lists agree.
4. **S4:** Verify fresh sign-in with a retained credential succeeds after session
   revocation. Removing a passkey/Google link or trusted-device record is not a
   substitute for revoking active sessions. Do not infer that every open session
   closes just because an access method was removed.

## Evidence and completion

Copy this template per case/device. All cases above remain **NOT RUN** until a human
records observations. Use PASS, FAIL, BLOCKED, or NOT RUN; include unavailable cases
and prerequisites rather than converting them to passes.

```text
Case/device ID:
Status: NOT RUN — pending human execution
Operator / UTC timestamp:
Environment URL / deployed revision:
OS / browser / hardware / provider / transport:
Test identity alias / workspace alias (no personal identifiers):
Preconditions and configuration confirmed (no secrets):
Steps actually performed:
Expected result:
Observed UI and protected-request result:
HTTP status / safe error code / x-request-id (if available):
Redacted screenshot or evidence reference:
Blocker / defect / follow-up owner:
Fallback sign-in verified / approved cleanup completed:
```

Do not attach raw HAR files, cookies, ID tokens, passwords, PINs, recovery codes,
TOTP secrets, or QR enrollment payloads. Use sanitized observations and the response
`x-request-id` for correlation; see [operational telemetry](observability.md).
Summarize actual device/provider coverage and outstanding cases alongside the
integration checkpoint. Human execution and evidence review are required before
claiming real-device or live-Google acceptance.
