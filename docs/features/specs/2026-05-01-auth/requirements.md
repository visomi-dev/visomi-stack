# Auth — Requirements

## Feature

User authentication via email/password with two-stage verification (password + email PIN).

Source docs: [product/auth-flow.md](../../product/auth-flow.md), [architecture/backend/auth.md](../../architecture/backend/auth.md)

## User Stories

1. As a new user, I can create an account with email and password
2. As a new user, I must verify my email via a 6-digit PIN before accessing the app
3. As a returning user, I can sign in with email and password, then verify via PIN
4. As an authenticated user, my session is restored when I revisit the app
5. As a user, I can sign out and my session is destroyed immediately
6. As a user, I can resend my verification PIN (with cooldown)

## Acceptance Criteria

### Sign Up

- [ ] Email + password submission creates unverified user
- [ ] Verification PIN email is sent via Mailgun
- [ ] UI transitions to `/app/verify-email` after sign-up submission
- [ ] Correct PIN verifies email and creates authenticated session
- [ ] Duplicate email returns generic error (no enumeration)
- [ ] Session cookie is httpOnly, sameSite, secure in production

### Sign In

- [ ] Email + password verification through Passport local strategy
- [ ] Successful password check triggers PIN email (no session yet)
- [ ] UI transitions to `/app/verify-email` after password verification
- [ ] Correct PIN creates authenticated session
- [ ] Invalid password returns generic error

### Verification PIN

- [ ] 6-digit numeric PIN
- [ ] PIN expires after 10 minutes
- [ ] Max 5 failed attempts per challenge
- [ ] Resend cooldown: 30–60 seconds
- [ ] Latest active challenge for same user + purpose invalidates previous

### Session

- [ ] `GET /api/auth/session` returns authenticated user or unauthenticated state
- [ ] Valid session cookie bypasses sign-in routes
- [ ] `/app` redirects to `/app/sign-in` when unauthenticated
- [ ] `/app/sign-in` and `/app/sign-up` redirect to `/app` when authenticated
- [ ] `/app/verify-email` redirects to `/app/sign-in` when no active challenge
- [ ] `POST /api/auth/sign-out` destroys session, clears cookie, redirects to `/app/sign-in`

## Scope

### In Scope

- Email/password sign-up and sign-in
- Email PIN verification (both sign-up and sign-in)
- Cookie-backed sessions (PostgreSQL session store)
- Passport local strategy for credential verification
- Mailgun email delivery
- Rate limiting on auth endpoints
- CSRF protection for session-based auth
- Audit logging for auth events
- Light and dark theme support on auth routes

### Out of Scope

- Password reset / forgot password
- Magic links
- OAuth / social login
- Two-factor authentication (beyond email PIN)
- Remembered devices / device trust
- Organization invites
- Enterprise SSO

## Edge Cases

- Empty email/password fields: catch client-side before submission
- Email already registered: generic error, no existence disclosure
- PIN expired: show expiry message, allow resend if cooldown permits
- PIN wrong: inline error, preserve challenge context
- Max attempts reached: invalidate challenge, require new issuance
- Mailgun delivery failure: show retry-friendly error, do not pretend PIN was sent
- Session cookie absent/malformed: treat as unauthenticated
- JavaScript disabled: form must remain functional (server-side rendering)
