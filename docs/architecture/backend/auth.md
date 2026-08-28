# Auth Architecture

## Purpose

Define the first production auth slice for Themis.

This architecture assumes:

- Angular owns the auth UI
- Express owns auth endpoints and session handling
- Passport verifies email and password credentials
- PostgreSQL stores auth state
- Drizzle ORM owns the SQL schema and query layer
- `drizzle-kit` beta owns SQL migration generation and application
- Mailgun delivers verification emails

## Scope

This document covers:

- runtime ownership across the monorepo
- route composition between public and product surfaces
- backend auth flow shape
- persistence model for users, sessions, and verification challenges
- security defaults for the first implementation

This document does not cover:

- social login
- SSO or enterprise identity providers
- password reset implementation
- MFA beyond email PIN verification

## Runtime Ownership

The first auth slice should keep a clear separation of responsibilities.

### Angular App

`apps/web/app` owns:

- sign-in UI
- sign-up UI
- verification PIN UI
- session restoration checks for product routes
- post-authenticated product shell

### API

`apps/web/api` owns:

- Passport strategy configuration
- credential verification
- verification challenge generation and validation
- session establishment and teardown
- Mailgun email delivery
- auth rate limiting and audit logging

### Composition Server

`apps/web/server` owns:

- same-origin delivery of frontend surfaces and API
- route mounting for Astro, Angular, and API
- cookie-friendly runtime topology for session auth

## Route Strategy

The first composed route model should be:

- `/` and other public marketing routes served by Astro
- `/app/*` served by Angular
- `/api/*` served by Express API

Recommended Angular auth routes:

- `/app/sign-in`
- `/app/sign-up`
- `/app/verify-email`

Recommended API auth routes:

- `POST /api/auth/sign-up`
- `POST /api/auth/sign-up/verify`
- `POST /api/auth/sign-in/password`
- `POST /api/auth/sign-in/verify`
- `POST /api/auth/verification/resend`
- `GET /api/auth/session`
- `POST /api/auth/sign-out`

## Why `/app/*`

The repository already separates the public site and the product app. Keeping product auth under `/app/*` preserves that boundary while still allowing same-origin cookies and a single deployed runtime.

This keeps:

- public positioning and marketing pages in Astro
- product identity and authenticated state in Angular
- auth backend logic independent from either frontend surface

## Authentication Model

The first auth implementation uses two stages.

### Stage 1: Credential Verification

Passport with a local strategy validates the submitted email and password.

Passport is responsible only for the credential check in this stage. Successful password verification does not immediately establish the logged-in session.

### Stage 2: Email PIN Verification

After password verification succeeds, the API creates a verification challenge and sends a short-lived numeric PIN by email.

The user enters the PIN in the Angular UI. Only after that PIN is validated should the API call `req.login()` and establish the authenticated session.

This applies to:

- sign-up
- sign-in

## Session Model

Themis should use cookie-backed sessions with Passport session support.

Session requirements:

- session cookie issued only after PIN verification succeeds
- session cookie scoped to the composed server origin
- authenticated user restored through `passport.authenticate('session')`
- session storage backed by PostgreSQL

Recommended session behavior:

- `httpOnly` cookie enabled
- `sameSite` set for same-origin operation
- `secure` enabled in production
- rolling or fixed expiration chosen explicitly during implementation

## Persistence Model

PostgreSQL is the source of truth for authentication state.

The SQL access layer should use `drizzle-orm`.

Migrations should use the `drizzle-kit` beta release track chosen for the repository. The goal is to keep schema definitions, generated SQL, and runtime queries aligned from the beginning instead of introducing a second persistence abstraction later.

Recommended repository direction for the implementation phase:

- define auth tables in Drizzle schema files
- generate migrations with `drizzle-kit` beta
- check generated SQL migrations into the repository
- use Drizzle for both reads and writes in auth services

### Users Table

Minimum fields:

- `id`
- `email`
- `password_hash`
- `email_verified_at`
- `created_at`
- `updated_at`

Recommended constraints:

- unique index on normalized email
- no plaintext password storage

### Verification Challenges Table

Minimum fields:

- `id`
- `user_id`
- `purpose`
- `pin_hash`
- `expires_at`
- `consumed_at`
- `attempt_count`
- `last_sent_at`
- `created_at`
- `updated_at`

Purpose values for V1:

- `sign_up`
- `sign_in`

Recommended behavior:

- hash the PIN before storage
- invalidate older active challenges for the same user and purpose when a new one is issued
- track resend timing and failed attempts in the same record or adjacent audit table

### Session Storage

Use a PostgreSQL-backed store compatible with `express-session`.

The session table is an operational concern, but it still needs to be part of the deployment and migration plan because the auth flow depends on durable session persistence.

If the chosen session store manages its own table shape outside the Drizzle schema, that is acceptable for V1. The application-owned auth tables should still be defined in Drizzle.

### Optional Audit Table

Recommended for operational visibility:

- `auth_audit_events`

Useful event types:

- credential check success or failure
- verification PIN issued
- verification PIN accepted or rejected
- session created
- session destroyed
- rate limit exceeded

## Verification Rules

Recommended defaults for the first implementation:

- PIN length: 6 digits
- PIN expiry: 10 minutes
- max failed attempts per challenge: 5
- resend cooldown: 30 to 60 seconds
- latest active challenge wins

These numbers can be tuned later, but the initial implementation should keep them explicit and server-controlled.

## Password Handling

Passwords must be hashed using a modern password hashing approach.

Implementation rules:

- never store plaintext passwords
- never log submitted passwords
- compare hashes server-side only
- use a dedicated password hashing function rather than inventing a custom scheme

Passport's local strategy remains the orchestration point for credential verification, but password hashing and comparison should live in a dedicated auth service layer.

## Mailgun Integration

Mailgun must be used server-side only.

Required environment variables:

- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN`
- `MAILGUN_FROM`

Optional environment variables:

- `MAILGUN_URL` for EU-hosted domains

Recommended email behavior:

- send plain-text verification email in the first slice
- optionally include simple HTML markup
- keep the PIN and expiry visible in the body
- do not expose whether the email belongs to an existing account in user-facing copy

## API Sequence

### Sign Up

1. Angular posts email and password to `POST /api/auth/sign-up`.
2. API validates the payload and creates an unverified user.
3. API creates a verification challenge.
4. API sends the PIN email with Mailgun.
5. Angular routes the user to `/app/verify-email`.
6. User submits the PIN to `POST /api/auth/sign-up/verify`.
7. API validates the PIN, marks the email verified, and creates the session.

### Sign In

1. Angular posts email and password to `POST /api/auth/sign-in/password`.
2. Passport local strategy verifies the credentials.
3. API creates a sign-in verification challenge.
4. API sends the PIN email with Mailgun.
5. Angular routes the user to `/app/verify-email`.
6. User submits the PIN to `POST /api/auth/sign-in/verify`.
7. API validates the PIN and creates the session.

## Session Endpoints

### `GET /api/auth/session`

Returns:

- authenticated user summary when a valid session exists
- unauthenticated state when no valid session exists

This endpoint is the bootstrap point for Angular route guards, app shell hydration, and post-refresh session restoration.

### `POST /api/auth/sign-out`

Destroys the current session and clears the auth cookie.

## Security Defaults

The first implementation should include the following protections.

### Enumeration Resistance

User-facing errors should avoid confirming whether an email exists unless the flow explicitly requires the account to already exist.

### Rate Limiting

Apply limits to:

- sign-up attempts
- password verification attempts
- PIN verification attempts
- PIN resend attempts

### CSRF

Because the target deployment is same-origin and session-based, CSRF protection should be designed into the API before broadening write endpoints.

### Cookie Safety

Production cookies should be:

- `httpOnly`
- `secure`
- same-site constrained

### Auditability

Important auth transitions should leave an auditable trail in logs or in a dedicated auth event table.

## Frontend Design Alignment

The auth UI should be implemented in Angular with PrimeNG components, while preserving the visual language defined in `DESIGN.md`.

Design rules for V1:

- support both light and dark themes from the start
- use PrimeNG for controls and interaction states
- keep the larger page layout custom to preserve the Themis visual language

## Deferred Scope

Explicitly out of scope for the first implementation:

- password reset
- magic links
- third-party OAuth providers
- organization invites
- device trust management
- enterprise SSO

## Delivery Order

Recommended implementation order:

1. Mount Angular through the composed server.
2. Add Drizzle schema files and `drizzle-kit` beta migration configuration for auth data.
3. Generate and apply the first PostgreSQL auth migrations.
4. Implement API auth services and Passport configuration.
5. Implement Mailgun-backed verification delivery.
6. Build Angular auth routes and PrimeNG screens.
7. Add API, app, and server end-to-end coverage.
