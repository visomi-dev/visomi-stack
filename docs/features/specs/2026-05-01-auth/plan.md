# Auth — Implementation Plan

## Data Model Changes

### New Tables

#### `users`

| Column            | Type      | Constraints        |
| ----------------- | --------- | ------------------ |
| id                | uuid (PK) |                    |
| email             | text      | UNIQUE, normalized |
| password_hash     | text      | NOT NULL           |
| email_verified_at | timestamp | nullable           |
| created_at        | timestamp | NOT NULL           |
| updated_at        | timestamp | NOT NULL           |

#### `verification_challenges`

| Column        | Type              | Constraints            |
| ------------- | ----------------- | ---------------------- |
| id            | uuid (PK)         |                        |
| user_id       | uuid (FK → users) | NOT NULL               |
| purpose       | text              | 'sign_up' \| 'sign_in' |
| pin_hash      | text              | NOT NULL               |
| expires_at    | timestamp         | NOT NULL               |
| consumed_at   | timestamp         | nullable               |
| attempt_count | integer           | DEFAULT 0              |
| last_sent_at  | timestamp         | nullable               |
| created_at    | timestamp         | NOT NULL               |
| updated_at    | timestamp         | NOT NULL               |

#### `auth_audit_events` (optional, V1)

| Column     | Type      |
| ---------- | --------- |
| id         | uuid      |
| event_type | text      |
| user_id    | uuid      |
| ip_address | text      |
| metadata   | jsonb     |
| created_at | timestamp |

## API Endpoints

| Method | Path                            | Purpose                      |
| ------ | ------------------------------- | ---------------------------- |
| POST   | `/api/auth/sign-up`             | Create user, send PIN        |
| POST   | `/api/auth/sign-up/verify`      | Verify PIN, create session   |
| POST   | `/api/auth/sign-in/password`    | Verify credentials, send PIN |
| POST   | `/api/auth/sign-in/verify`      | Verify PIN, create session   |
| POST   | `/api/auth/verification/resend` | Resend PIN (with cooldown)   |
| GET    | `/api/auth/session`             | Return session state         |
| POST   | `/api/auth/sign-out`            | Destroy session              |

## Angular Routes

| Path                | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `/app/sign-in`      | Sign-in form (email + password)             |
| `/app/sign-up`      | Sign-up form (email + password)             |
| `/app/verify-email` | PIN verification (both sign-up and sign-in) |

## Route Guards

- `authGuard`: redirects unauthenticated users to `/app/sign-in`
- `guestGuard`: redirects authenticated users away from `/app/sign-in`, `/app/sign-up`
- `verificationGuard`: redirects users without active challenge away from `/app/verify-email`

## Implementation Steps

1. Define Drizzle schema for `users` and `verification_challenges`
2. Generate and apply migrations with `drizzle-kit`
3. Configure Passport local strategy (credential check only, no session)
4. Set up `express-session` with PostgreSQL session store
5. Implement PIN generation, hashing, and Mailgun delivery
6. Build auth service layer (create user, verify password, verify PIN, manage challenges)
7. Implement API route handlers (sign-up, sign-up/verify, sign-in/password, sign-in/verify, resend, session, sign-out)
8. Apply rate limiting middleware to auth endpoints
9. Apply CSRF protection
10. Build Angular auth forms (sign-in, sign-up, verify-email)
11. Implement route guards (auth, guest, verification)
12. Configure session restoration on app bootstrap

## Runtime Ownership

- **API** (`apps/web/api`): all auth endpoints, Passport config, Mailgun integration
- **Angular** (`apps/web/app`): auth UI, route guards, session bootstrap
- **Server** (`apps/web/server`): same-origin proxy, cookie delivery

## Security

- Passwords: bcrypt/argon2 hashing, never stored or logged plaintext
- PIN: hashed before storage, 6 digits, 10min expiry, 5 max attempts
- Session cookie: `httpOnly`, `sameSite`, `secure` in production
- Rate limiting: sign-up, password check, PIN verify, PIN resend
- No email enumeration in error messages
