# Auth Testing

## Purpose

This document explains how to validate the implemented auth flow in automated and manual modes.

The implemented auth stack includes:

- Angular auth UI under `/app/*`
- Express API under `/api/*`
- Passport local credential verification
- email PIN verification
- Drizzle-managed SQL schema and migrations
- session-based authentication after successful PIN validation

## Automated Coverage

The repository now includes these automated checks for the auth flow.

### Lint

```bash
pnpm exec nx run-many -t lint --projects app,api,server,app-e2e,api-e2e,server-e2e
```

### Angular Unit Test

```bash
pnpm exec nx test app
```

### API End-to-End Tests

```bash
pnpm exec nx run api-e2e:e2e
```

Covered behavior:

- sign-up challenge creation
- sign-up PIN verification
- session restoration after sign-up
- sign-out
- sign-in password verification
- invalid PIN rejection
- sign-in PIN verification

### Composition Server End-to-End Tests

```bash
pnpm exec nx run server-e2e:e2e
```

Covered behavior:

- runtime health endpoint
- public Astro site root
- API mounting under `/api`
- Angular app mounting under `/app`

### Playwright End-to-End Tests

```bash
pnpm exec nx run app-e2e:e2e
```

Covered behavior:

- `/app/sign-up` validation and happy-path transition into verification
- `/app/sign-in` validation, happy path, and authenticated redirect behavior
- `/app/verify-email` invalid PIN handling, cooldown-safe resend behavior, and valid verification
- `/app/` redirect behavior for anonymous users and authenticated sign-out
- theme toggle behavior across auth and app routes

The Playwright suite is organized by route and shared support helpers:

- `apps/web/app-e2e/src/auth/`
- `apps/web/app-e2e/src/app/`
- `apps/web/app-e2e/src/theme/`
- `apps/web/app-e2e/src/support/`

## Test Runtime Configuration

Automated tests run with in-memory infrastructure for the backend dependencies so they do not require external services.

Test-only runtime choices:

- database driver: `memory`
- mail transport: `memory`
- test mailbox API: enabled
- database migrations: auto-applied at process startup

This keeps the automated suite deterministic while preserving the production implementation path for:

- PostgreSQL via Drizzle
- Mailgun delivery
- session-based authentication

## Manual Test With Real PostgreSQL And Mailgun

### Required Environment Variables

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/themis"
export DATABASE_DRIVER="pg"
export DATABASE_AUTO_MIGRATE="true"
export SESSION_SECRET="replace-me"
export MAIL_TRANSPORT="mailgun"
export MAILGUN_API_KEY="key-..."
export MAILGUN_DOMAIN="mg.example.com"
export MAILGUN_FROM="Themis <no-reply@example.com>"
export APP_BASE_URL="http://127.0.0.1:8080/app"
```

Optional:

```bash
export MAILGUN_URL="https://api.eu.mailgun.net"
export DATABASE_SSL="true"
```

### Generate And Apply Migrations

```bash
pnpm exec drizzle-kit generate
pnpm exec drizzle-kit migrate
```

### Start The Composed Runtime

```bash
pnpm exec nx run server:serve
```

Open:

```text
http://127.0.0.1:8080/app/sign-up
```

## Manual Validation Checklist

### Sign Up

1. Open `/app/sign-up`.
2. Enter a new email address and a valid password.
3. Submit the form.
4. Confirm the app navigates to `/app/verify-email`.
5. Confirm the verification email arrives.
6. Enter the PIN.
7. Confirm the app redirects into `/app`.

### Sign Out

1. Click `Sign out`.
2. Confirm the app returns to `/app/sign-in`.

### Sign In

1. Enter the same verified email and password.
2. Submit the form.
3. Confirm a new sign-in PIN is emailed.
4. Enter the PIN.
5. Confirm the app redirects into `/app` again.

### Theme

1. Open `/app/sign-in`.
2. Toggle the theme switch.
3. Confirm the route updates between light and dark presentation.
4. Confirm the same visual mode still works on `/app/verify-email` and `/app`.

### Guards

1. Open `/app` without a session.
2. Confirm the app redirects to `/app/sign-in`.
3. Complete authentication.
4. Open `/app/sign-in` again.
5. Confirm the app redirects back to `/app`.
6. Open `/app/verify-email` without an active challenge.
7. Confirm the app redirects to `/app/sign-in`.

## Notes

- The automated suite does not require real Mailgun credentials.
- The automated suite does not require a running PostgreSQL server.
- The production implementation path still uses PostgreSQL and Mailgun when configured.
- The OTP helper in `apps/web/app-e2e/src/support/otp.ts` targets `[data-slot=pin-input] input`. The previous PrimeNG selector `.p-inputotp-input` was removed when the input migrated to the in-house `app-pin-input` primitive.
