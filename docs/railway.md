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
- Public URL: <https://stack.visomi.dev>.

The service uses the existing Railway GitHub integration for automatic
deployments from `main`. GitHub Actions verifies the code; Railway builds and
deploys it through the GitHub App. This path does not require `RAILWAY_TOKEN`
or a local Railway CLI session.

The initial public website does not need a database, Redis, object storage, or
mail credentials. Without `DATABASE_URL`, authentication fails closed with 503.
No customer data or application secrets are required for the initial website.
The public origin is `https://stack.visomi.dev`, proxied through Cloudflare.
Railway has a valid certificate; its DNS status may report a mismatch while
Cloudflare proxies the CNAME. Preserve the existing Railway-generated domain
for diagnostics. Authentication infrastructure remains a separate step.

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
alone only orders tasks. Browser and HTTP E2E targets declare
`{ "dependentTasksOutputFiles": "**/*", "transitive": true }` because they run
against compiled applications, including their JavaScript, CSS, assets and
metadata. `transitive` follows the complete build chain, such as website tests
→ gateway → API and Astro site. It is not a default required on every target.
The API and gateway compiled-artifact tests also consume these outputs, including
`.mjs`, `package.json` and source maps. Global styles and theme changes therefore
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
The existing `pr9-private-tracing-check` service is retained by its imported
configuration; removing it is a separate infrastructure decision.

After a deployment reaches `SUCCESS`, verify the public origin:

```sh
node tools/deployment/smoke.mjs https://stack.visomi.dev
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
reader by default. OpenTelemetry itself is not a database or a telemetry query backend.

Railway provides container metrics and log search. Its native tracing switch also
records raw request paths at the edge and accepts client-supplied trace IDs.
The documented controls provide no edge redaction or application-only tracing
mode. Application filtering cannot remove separately generated edge telemetry.
Native tracing and automatic instrumentation therefore remain **off** on the
public gateway and on Jaeger. This does not disable Railway's or Cloudflare's own
HTTP access logs; those follow their respective platform policies.

### Private Jaeger

Production exports application spans directly to a private `jaeger` service in
the same Railway project, environment and region (`us-east4-eqdc4a`). It uses
Jaeger 2.22.0, pinned by image digest in `.railway/railway.ts`. A single process
owns the receiver, Badger storage and trace viewer; no separate collector or
database is required. `.railway/jaeger.yaml` is supplied through `JAEGER_CONFIG`
and loaded with `--config env:JAEGER_CONFIG`.

The `jaeger-data` volume starts at 1 GB, mounts at `/badger`, and retains spans
with a 48-hour TTL. Badger removes expired data during its normal cleanup;
TTL is not an instantaneous disk-erasure guarantee. Keep exactly one replica.
Monitor disk usage and increase the volume deliberately if needed. Railway mounts
volumes as root-owned, so only this private storage service uses
`RAILWAY_RUN_UID=0`; the HTTP gateway continues to run as `node`.

Jaeger has **no public domains or TCP proxies**. Its OTLP/HTTP receiver listens
on private port 4318 and requires Basic authentication. The query viewer uses
port 16686; the health endpoint is `/status` on port 13133. Listeners support
Railway's private IPv6 network. Do not enable debug exporters, automatic
instrumentation, external exporters, AI integrations or browser telemetry.

`JAEGER_HTPASSWD` and `OTLP_AUTH_HEADER` hold receiver credentials in Railway.
The initial password is generated from 48 random bytes; its SHA htpasswd digest
checks the same high-entropy credential sent in the Basic header. Neither value
belongs in Git, logs, commands shown to users or reports. Rotate them together.
IaC uses `preserve()` and references the header from the gateway.

The gateway uses the **existing** executable-owned exporter:

```text
VISOMI_RAILWAY_TRACING=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://${{jaeger.RAILWAY_PRIVATE_DOMAIN}}:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=${{jaeger.OTLP_AUTH_HEADER}}
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
```

Despite its historical name, `VISOMI_RAILWAY_TRACING` enables only the application's
OTLP exporter. It does not enable Railway edge tracing. No runtime API or flag
rename is required, and the code already deployed on `main` supports this setup.
The official exporter requires a valid endpoint, protocol and authentication
header; invalid configuration fails with a fixed error code.

The exporter retains its bounded 512-span queue, batches of at most 128,
one-second schedule, 500 ms transport timeout and existing shutdown deadline.
Receiver failures do not block HTTP requests. An unsuccessful final flush can
still make shutdown exit unsuccessfully; export is best effort, not durable
application delivery. Explicit test exporters retain precedence.

The application capture policy permits only:

- Span names `http.request` and `job.execute`, random trace/span IDs, timing,
  kind and status code; no status messages, events, links or baggage.
- Attributes `operation`, controlled `outcome`, and validated numeric
  `http.response.status_code` for HTTP completions.
- Resource fields from the existing service, version and environment allowlists,
  and the fixed `visomi-stack.operational` instrumentation scope.

Jaeger's Badger compatibility conversion may display the numeric HTTP status as
`http.status_code`; the application export uses `http.response.status_code`.

Client request IDs, `traceparent`, `tracestate`, baggage, and arbitrary resource
environment variables are ignored. Bodies, credentials, customer identifiers,
paths, queries, IPs, user agents and original exceptions are never exported.

### Verify and access

The container check starts the real pinned Jaeger image and the compiled gateway
with synthetic private markers. It checks receiver authentication, stored OTLP
attributes/resources/events/links, fresh IDs, shutdown flush, receiver outages,
persistence after restart and the configured TTL. It does not wait 48 hours to
test expiry. Run it through Nx, alongside the existing wire-level exporter tests:

```sh
pnpm nx run web-gateway:jaeger-check
CONTAINER_ENGINE=podman pnpm nx run web-gateway:jaeger-check
pnpm nx run web-backend-shared:test
```

Access the private UI through Railway SSH from an authorized workstation:

```sh
railway ssh config --project 0f5e009e-1689-4dc7-ab80-ca81b9037e13 \
  --environment 7894fae9-b595-4415-9b58-348c3785ce6d \
  --service 05d655c1-9669-4b6c-b3f7-61993979aa63 --alias railway-jaeger
ssh -N -L 127.0.0.1:16686:127.0.0.1:16686 railway-jaeger
```

Then open `http://127.0.0.1:16686` and select service `web-gateway`. Use the
application-generated trace IDs from allowlisted operational logs when
investigating a request; Railway edge trace IDs intentionally do not apply.
Do not publish raw telemetry captures or SSH credentials.

Provision and verify Jaeger before enabling the gateway export variables.
Keep the gateway's GitHub source on `main`, wait for the exact deployment to
reach `SUCCESS`, check the public origin and inspect stored application spans
through the private viewer. Configuration changes can reuse the existing build;
merging the repository PR is not needed for activation.

To disable export, set `VISOMI_RAILWAY_TRACING=false` on `web-gateway`, redeploy
its existing build, and verify `https://stack.visomi.dev`. Leave native tracing
off and retain the Jaeger service/volume until their removal is explicitly
requested. Configuration changes are not automatically applied by GitHub
application deployments; reconcile the reviewed IaC plan separately.

The current Node runtime can execute a future BullMQ worker. Its owner must
initialize and close the queue/worker resources explicitly, drain active jobs
before shutting down dependencies and telemetry, and revisit the current
five-second application shutdown deadline and ten-second Railway drain period.
With a Redis queue backend, configure persistence and `noeviction`, and account
for worker concurrency on every gateway replica. No queue is provisioned here.

References: [Jaeger storage](https://www.jaegertracing.io/docs/2.22/storage/badger/),
[Railway SSH](https://docs.railway.com/cli/ssh),
[Railway observability](https://docs.railway.com/observability),
[Railway tracing](https://docs.railway.com/observability/tracing),
[Railway tracing variables](https://docs.railway.com/variables/reference#tracing-variables),
[Collector Docker images](https://opentelemetry.io/docs/collector/install/docker/),
and [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production).
