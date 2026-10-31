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
also builds the API and Astro site. Production dependencies are installed in a separate build stage. The final
image preserves `dist/apps/web/{gateway,api,site}` together, runs as the
unprivileged `node` user, and contains neither pnpm nor the root development
tooling. The Node base is pinned by version and multi-platform image digest.
Update the version and digest together and verify both images after updating. Compose
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
The live service settings were configured through the connected Railway app.
Wait for CI is enabled on the production service.
New services cannot use the deprecated `railway.json` format. Installing the
IaC SDK does not enable instrumentation or external telemetry.

## CI and automatic deployments

`.github/workflows/ci.yml` runs on every PR and push to `main`:

1. `nrwl/nx-set-shas` resolves the last successful CI commit on `main` and the
   current head. The verification job uses full Git history.
2. `nx affected` selects lint, type checks, generated-email checks, builds, unit
   tests, and isolated PostgreSQL integration tests from that shared range.
3. The same range selects an E2E project matrix and the production-container
   check. Each selected E2E project builds its own required artifacts.
4. The container task builds the complete gateway image, checks public routes
   and CSS, runs it with a read-only filesystem and temporary `/tmp`, verifies
   its unprivileged user and absence of build tools, and checks SIGTERM exit.

Manual `workflow_dispatch` runs use `run-many` for a full workspace check and
select every E2E project and the container. Actions are pinned to verified
upstream commit SHAs; update those SHAs deliberately with their version comments.

The `required` job always runs. It accepts a skipped E2E/container job only when
selection explicitly said there was no work for that job. Missing selection,
failed verification, failed jobs, and cancelled jobs fail the gate. A docs-only
change can therefore pass without building unrelated applications. Do not add
workflow-level path filters that prevent this required status from being reported.

The active `required-ci` repository ruleset requires the `required` status from
GitHub Actions and an up-to-date branch before merge. It supplements the existing
`main` ruleset without replacing its security, coverage, or review rules.
The workflow cancels superseded PR runs, but never cancels `main` runs.

### Inputs and selection regression checks

Nx 24 selects tasks using inputs and consumed dependency outputs; `dependsOn`
alone only orders tasks. Browser and HTTP E2E targets read the outputs of their
build dependencies transitively. Global styles and theme changes therefore
select website and Angular E2E, and changes to the gateway/API select the
website tests that actually serve through that gateway.

Shared tooling, dependency manifests, lockfile, TypeScript configuration, and CI
workflow changes are explicit shared inputs. The deployment validation target
also declares `.railway/` and deployment-tool inputs. Its regression tests query
Nx itself to check selection for shared styles, API/gateway changes, deployment
configuration, and docs-only changes. They also verify that Angular-only changes
do not select the gateway production image.

```sh
pnpm nx run web-gateway:deployment-check
pnpm nx show projects --affected -t e2e --files=styles.base.css --json
pnpm nx run web-gateway:container-check
# On development hosts with Podman instead of Docker:
CONTAINER_ENGINE=podman pnpm nx run web-gateway:container-check
```

### Railway deployment selection

Railway follows `main` through its existing GitHub App, with Wait for CI enabled.
No Railway deployment token is needed. Railway waits for workflow conclusions
before deploying selected changes; the health check gates traffic to the new
container after startup.

Watch Paths are configured on the live service and recorded as `watchPatterns`
in `.railway/railway.ts`. They include the gateway, API, Astro site, their shared
libraries, global styles/theme, dependency manifests, patches, TypeScript/Nx
configuration, and Docker/infrastructure files. Angular-only changes, docs, and
agent guidance do not trigger a gateway deployment.

Keep those paths aligned with the runtime dependency graph when adding a mount,
worker, library, or executable. Filtering decides whether Railway should build;
the Docker build still runs `nx build web-gateway` and includes the complete
compiled runtime. It does not use `affected` inside a fresh image build.

Use the [service dashboard](https://railway.com/project/0f5e009e-1689-4dc7-ab80-ca81b9037e13/service/5c62752e-dd6c-47d7-a0b2-cfbb3c2cb73f/settings?environmentId=7894fae9-b595-4415-9b58-348c3785ce6d)
to inspect the source, Watch Paths and Wait for CI. See the
[Railway autodeploy guide](https://docs.railway.com/deployments/github-autodeploys)
and [monorepo guide](https://docs.railway.com/deployments/monorepo#watch-paths).

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

## Observability and future workers

The gateway emits allowlisted JSON logs to stdout and owns its OpenTelemetry
providers. It currently supplies neither a production span exporter nor a metric
reader. OpenTelemetry itself is not a database or a telemetry query backend.

Railway already provides container metrics, log search, a customizable
observability dashboard, and native distributed tracing. Its native OTLP receiver
accepts **traces only**; custom application metrics and OTLP logs require another
destination. Enabling service tracing provides the OTLP endpoint, protocol and
required headers on the next deployment. This repository's explicit provider
will still need a configured exporter; those variables alone do not activate it.

Prefer evaluating Railway's native trace backend before provisioning another
service. Keep the current capture allowlist and random operation correlations.
Do not turn on broad auto-instrumentation or send request/customer data, database
values, Redis keys, job payloads, arbitrary exception messages, or stacks. Review
the edge and application capture policy before enabling production export.
This CI/deployment change does not enable tracing or external exporters.

If a separate collector is needed, the official Docker images are
`otel/opentelemetry-collector` and `otel/opentelemetry-collector-contrib`. Pin a
reviewed version/digest and run it as its own service in the **same Railway
project and environment**, connected over private networking. A collector
receives, processes and forwards telemetry; choose a storage/query backend when
historical trace or custom-metric retention is needed. Do not put that storage or
a second process manager into the HTTP gateway merely to reuse its container.

The current Node runtime can execute a future BullMQ worker. Its owner must
initialize and close the queue/worker resources explicitly, drain active jobs
before shutting down dependencies and telemetry, and revisit the current
five-second application shutdown deadline and ten-second Railway drain period.
With a Redis queue backend, configure persistence and `noeviction`, and account
for worker concurrency on every gateway replica. No queue is provisioned here.

References: [Railway observability](https://docs.railway.com/observability),
[Railway tracing](https://docs.railway.com/observability/tracing),
[Railway tracing variables](https://docs.railway.com/variables/reference#tracing-variables),
[Collector Docker images](https://opentelemetry.io/docs/collector/install/docker/),
and [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production).
