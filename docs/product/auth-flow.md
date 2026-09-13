# Passwordless Authentication

Visomi Stack uses passkeys as the primary authentication authority. The identity route starts a short-lived, browser-bound flow and begins discoverable WebAuthn authentication. A successful assertion resolves the account from the credential and creates a full session.

Email verification is an explicit fallback. It is enumeration-resistant and does not create a full session for an existing account. Existing-account recovery creates a lower-assurance restricted session that can only enroll and verify a new passkey. Recovery challenges are one-time, rate-limited, audited, and should trigger an account notification through the configured mail transport.

An already authenticated device can create a short-lived approval request. The requester receives a one-time code and polls its status. Approval requires a fresh passkey reauthentication on the existing device. Consuming the approved request produces an enrollment-only grant; it does not directly sign the new browser in.

Google is an optional explicit fallback. The browser must obtain an ID token through Google Identity Services and submit it to `POST /api/auth/google/complete`. The API verifies the signature, audience, issuer, expiry, nonce, and verified email. Federated identities are keyed by `(issuer, subject)`. Matching email addresses are never linked automatically.

## Security Rules

- Identity flows, challenges, and approval requests are short-lived and session-bound.
- Raw PINs, tokens, credential payloads, and precise location data are never stored in audit events.
- Pending passkeys cannot authenticate until their verification assertion activates them.
- Google configuration is optional through `GOOGLE_AUTH_CLIENT_ID`.
- Provider capability responses expose only whether Google is enabled and its public client ID.
