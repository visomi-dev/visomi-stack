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

The service uses the existing Railway GitHub integration for automatic
deployments from `main`. GitHub Actions verifies the code; Railway builds and
deploys it through the GitHub App. This path does not require `RAILWAY_TOKEN`
or a local Railway CLI session.

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

`.railway/railway.ts` records the desired service settings, public runtime
variables, and GitHub source with `checkSuites: true` (Wait for CI). It is
type-checked in CI and can be planned/applied explicitly when changing
infrastructure. Railway does not evaluate this file during GitHub autodeploys.
The live service settings were configured through the connected Railway app;
the Wait for CI switch still needs to be enabled in the service dashboard.
New services cannot use the deprecated `railway.json` format. Installing the
IaC SDK does not enable instrumentation or external telemetry.

## CI and automatic deployments

`.github/workflows/ci.yml` runs on every PR and push to `main`:

1. Check formatting of changed files, lint, type checking, and generated emails.
2. Build applications and run unit/integration tests with isolated PostgreSQL.
3. Run API, gateway, website, and Angular E2E suites on independent runners.
4. Build the production container, check the public routes and compiled CSS,
   and verify graceful shutdown.

The `required` job succeeds only if every verification job succeeds. Use it as
the required branch-protection check. The workflow does not cancel `main` runs.
Railway's GitHub source follows `main`. After merging this CI workflow, open
the service's **Settings → Source → Wait for CI** and enable it. Railway then
waits for the GitHub Actions workflow results before deploying a commit.
The connected Railway tools expose the source connection but not this switch.
Until it is enabled, automatic deployments start without waiting for CI.
No Railway deployment token is needed for GitHub autodeploys.

Use the [service dashboard](https://railway.com/project/0f5e009e-1689-4dc7-ab80-ca81b9037e13/service/5c62752e-dd6c-47d7-a0b2-cfbb3c2cb73f/settings?environmentId=7894fae9-b595-4415-9b58-348c3785ce6d)
to confirm the source branch and enable Wait for CI. If the switch is missing,
confirm the workflow runs on pushes to `main` and that the Railway GitHub App
has the required check-suite permissions. See the
[Railway autodeploy guide](https://docs.railway.com/deployments/github-autodeploys).

## Explicit infrastructure changes

Ordinary code releases use the GitHub connection above. When intentionally
changing infrastructure through the IaC file, install the locked dependencies,
authenticate the CLI, and link the explicit project/environment before planning:

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
