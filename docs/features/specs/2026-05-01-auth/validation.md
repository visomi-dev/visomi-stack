# Auth — Validation

Source docs: [testing/auth-testing.md](../../testing/auth-testing.md)

## Automated Tests

### Lint

```bash
pnpm exec nx run-many -t lint --projects app,api,server,app-e2e,api-e2e,server-e2e
```

### Angular Unit Tests

```bash
pnpm exec nx test app
```

### API E2E (Jest + supertest)

```bash
pnpm exec nx run api-e2e:e2e
```

Must cover:

- Sign-up challenge creation
- Sign-up PIN verification
- Session restoration after sign-up
- Sign-out
- Sign-in password verification
- Invalid PIN rejection
- Sign-in PIN verification

### Server E2E

```bash
pnpm exec nx run server-e2e:e2e
```

Must cover:

- Runtime health endpoint
- Public Astro site root
- API mounting under `/api`
- Angular app mounting under `/app`

### Playwright E2E

```bash
pnpm exec nx run app-e2e:e2e
```

Must cover:

- `/app/sign-up`: validation + happy-path transition to verification
- `/app/sign-in`: validation + happy path + authenticated redirect
- `/app/verify-email`: invalid PIN, cooldown-safe resend, valid verification
- `/app/`: redirect for anonymous, sign-out for authenticated
- Theme toggle across auth and app routes

## Manual Validation

### Prerequisites

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

### Checklist

**Sign Up**

- [ ] Open `/app/sign-up`, enter new email + valid password, submit
- [ ] Confirm navigation to `/app/verify-email`
- [ ] Confirm verification email arrives
- [ ] Enter PIN, confirm redirect to `/app`

**Sign Out**

- [ ] Click Sign out, confirm redirect to `/app/sign-in`

**Sign In**

- [ ] Enter verified email + password, submit
- [ ] Confirm new sign-in PIN email arrives
- [ ] Enter PIN, confirm redirect to `/app`

**Theme**

- [ ] Open `/app/sign-in`, toggle theme
- [ ] Confirm light/dark on `/app/sign-in`, `/app/verify-email`, `/app`

**Guards**

- [ ] Open `/app` without session → redirect to `/app/sign-in`
- [ ] Complete auth, open `/app/sign-in` → redirect to `/app`
- [ ] Open `/app/verify-email` without challenge → redirect to `/app/sign-in`
