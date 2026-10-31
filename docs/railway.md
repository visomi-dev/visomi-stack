# Railway deployment

The production service runs the existing composed gateway: the Astro website at
`/en/` and `/es/`, static assets, and the API at `/api`. The gateway loads compiled
sibling artifacts; it does not start another API or Astro listener. Angular
remains an independent application and `/app/*` returns 404 through this gateway.

## Resources

- Project: `visomi-stack` (`0f5e009e-1689-4dc7-ab80-ca81b9037e13`).
- Environment: `production` (`7894fae9-b595-4415-9b58-348c3785ce6d`).
- Service: `web-gateway` (`5c62752e-dd6c-47d7-a0b2-cfbb3c2cb73f`).
- Source: `visomi-dev/visomi-stack`, branch `main`.
- Public URL: <https://web-gateway-production-fa93.up.railway.app>.

The bootstrap deployment is pinned to verified commit `de9d09d` while CLI
authentication and the GitHub infrastructure token are pending. Applying the
infrastructure file clears that pin and enables Wait for CI before following
`main`. Keep the deployment PR in draft until those steps are complete.

The initial public website does not need a database, Redis, object storage, or
mail credentials. Without `DATABASE_URL`, authentication fails closed with 503.
No customer data or secrets are required for the initial deployment. Custom
domains and authentication infrastructure are separate configuration steps.

## Build and runtime

The repository-root `Dockerfile` defaults to `APP_NAME=web-gateway`. Its Nx build
also builds the API and Astro site. The final image installs production
dependencies and preserves `dist/apps/web/{gateway,api,site}` together. Compose
still explicitly selects `web-api` unless `APP_NAME` is supplied.

Railway uses the root directory and `Dockerfile`, starts
`node dist/apps/web/gateway/main.js`, and routes public traffic to port 8080.
`HOST=0.0.0.0` makes the listener reachable by Railway ingress. Health checks use
`/api/` with a 60-second timeout; a successful response requires the compiled
API and site to have loaded. This is a startup check, not continuous dependency
monitoring. The gateway drains on SIGTERM and Railway allows 10 seconds for exit.

`.railway/railway.ts` declares the service settings, public runtime variables,
and GitHub source with `checkSuites: true` (Wait for CI). This uses the current
Railway IaC SDK; new services cannot use the deprecated `railway.json` format.
Installing the SDK does not enable instrumentation or external telemetry.

## CI and automatic deployments

`.github/workflows/ci.yml` runs on every PR and push to `main`:

1. Check formatting of changed files, lint, type checking, and generated emails.
2. Build applications and run unit/integration tests with isolated PostgreSQL.
3. Run API, gateway, website, and Angular E2E suites on independent runners.
4. Build the production container, check the public routes and compiled CSS,
   and verify graceful shutdown.

The `required` job succeeds only if every verification job succeeds. Use it as
the required branch-protection check. The workflow does not cancel `main` runs.
Railway's GitHub source follows `main` and Wait for CI gates deployments on the
workflow results. No Railway deployment token is needed for GitHub autodeploys.

Infrastructure changes use `.github/workflows/railway-config.yml`. A same-repo PR
that changes `.railway/` saves a plan artifact for review. After merge, the apply
job waits for CI on that exact `main` commit and then applies the saved plan,
with checks for environment drift and the `.railway/` tree. Apply
fails instead of deleting resources; intentional removals need separate review.
Expired or drifted plans must be regenerated before merge.

The infrastructure workflow requires a Railway **project token scoped to the
production environment**, stored as the GitHub Actions secret `RAILWAY_TOKEN`.
It is separate from the connected Railway app and local CLI session. Fork PRs
never receive that token. Do not store account tokens or credentials in source.

For local administration, install the locked dependencies, authenticate, and link
the explicit project/environment before planning:

```sh
railway login
railway link --project 0f5e009e-1689-4dc7-ab80-ca81b9037e13 --environment production
pnpm dlx @railway/cli@5.71.0 config plan
pnpm dlx @railway/cli@5.71.0 config apply
```

IaC is evaluated by the CLI, not automatically read during Docker builds. Review
the plan before applying. This file owns the whole environment: add new resources
to it when provisioning them, and use `preserve()` for remotely stored secrets.

After a deployment reaches `SUCCESS`, verify the public origin:

```sh
node tools/deployment/smoke.mjs https://web-gateway-production-fa93.up.railway.app
```

The smoke check uses only public requests. Avoid publishing raw HTTP logs,
headers, exceptions, traces, or credentials when diagnosing a deployment.

## Enabling authentication later

Provision a private PostgreSQL service, declare it in the infrastructure file,
and use a Railway reference for `DATABASE_URL`. Supply a random session secret
of at least 32 bytes, the HTTPS `AUTH_ORIGIN`, its hostname as `AUTH_RP_ID`, and
an explicit trusted ingress range in `AUTH_TRUST_PROXY`. This setting accepts
Express proxy addresses/ranges; Nive's numeric hop setting is not compatible.
Never use a broad proxy trust setting without verifying the ingress topology.

Run the checked-in migrations as an explicit release step before enabling the
database-backed service. The current `database-init` image owns migration tooling;
the production image does not contain Drizzle Kit or migration sources. Do not
copy Nive's migration command or assume migration layouts match. See the
[API guide](../apps/web/api/README.md) and
[database initialization](development.md#container-database-initialization).
Email verification additionally needs the repository's SMTP configuration.
