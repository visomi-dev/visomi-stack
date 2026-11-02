# Deployment and telemetry

This guide describes build artifacts, release verification and telemetry capture
contracts. Keep environment inventories, hosting-provider details, resource IDs,
regions, private endpoints, dashboard links and access instructions in private
operational records rather than public documentation.

## Build and runtime

The repository-root `Dockerfile` defaults to `APP_NAME=web-gateway`. Its Nx build
also builds the API, Angular app and Astro site. Production dependencies are
installed in a separate build stage. The final image preserves
`dist/apps/web/{gateway,api,app,site}` together, runs as the unprivileged `node`
user, and contains neither pnpm nor the root development tooling. The Node base
is pinned by version and multi-platform image digest. Update the version and
digest together and verify both images after updating. Compose explicitly
selects `web-api` unless `APP_NAME` is supplied.

Application composition loads compiled sibling artifacts without starting extra
listeners. The owning executable initializes and closes process-wide resources.
Configure ingress, health checks and shutdown allowance in the target environment;
do not infer them from development-container settings.

The Cloudflare Worker in `apps/web/edge` validates percent encoding before an
upstream proxy can turn malformed paths into 502 responses. It returns 400 for
invalid paths and forwards valid requests unchanged. It has no request logging
or tracing. Its deployment, request-quota behavior and rollback are documented
in [the edge project](../apps/web/edge/README.md). Application releases do not
deploy this Worker.

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
also declares infrastructure definitions and deployment-tool inputs. Its regression tests query
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

### Release selection

Keep release path filters aligned with the runtime dependency graph when adding
a mount, worker, library or executable. Filtering selects whether to build; the
container build still includes the complete compiled runtime. Do not use
`affected` inside a fresh image build to omit required dependencies.

## Infrastructure changes and release verification

Review infrastructure plans separately from application releases. Installing an
SDK or merging code does not authorize applying a plan or enabling telemetry.
Keep environment-specific selections and credentials in operator-controlled
configuration, outside the public documentation.

After a release passes its health checks, verify its public origin:

```sh
node tools/deployment/smoke.mjs https://stack.visomi.dev
```

The smoke check uses only public requests. Avoid publishing raw HTTP logs,
headers, exceptions, traces or credentials when diagnosing a deployment.

## Enabling authentication later

Provision a private PostgreSQL service and supply its connection through
`DATABASE_URL`. Supply a random session secret
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

The owning executable initializes its allowlisted JSON logger and OpenTelemetry
providers. A production span exporter and metric reader are not enabled by
default. OpenTelemetry is not a database or telemetry query backend.

Platform-managed logs and tracing have independent capture policies. Application
filtering cannot sanitize separately generated platform telemetry. Do not enable
capture of raw request paths or untrusted client context outside the application's
approved allowlist.

### Collector configuration

Application spans can be exported to an authenticated OTLP/HTTP receiver. Keep
receiver endpoints, credentials, storage settings and administrative access in
private environment configuration. Provision and verify a receiver before
enabling export; do not expose collector or administration endpoints publicly.
Choose retention, capacity and persistence deliberately. TTL-based cleanup is
not an instantaneous disk-erasure guarantee.

The runtime uses provider-independent OTLP settings:

```text
VISOMI_OTLP_TRACING=true
OTEL_EXPORTER_OTLP_ENDPOINT=<private-receiver-base-url>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=<receiver-authentication-header>
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
```

`VISOMI_OTLP_TRACING` enables only application export. The exporter has no
hosting-provider integration, automatic resource attribution or edge-tracing dependency.
The official exporter requires a valid endpoint, protocol and authentication
header; invalid configuration fails with a fixed error code.

The exporter retains its bounded 512-span queue, batches of at most 128,
one-second schedule, 500 ms transport timeout and existing shutdown deadline.
Receiver failures do not block HTTP requests. An unsuccessful final flush can
still make shutdown exit unsuccessfully; export is best effort, not durable
application delivery. Explicit test exporters retain precedence.

The HTTP/job capture policy permits only the following fields. Browser errors use
the separate explicit allowlist under [Browser error reporting](#browser-error-reporting):

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

### Verify locally

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

Use the approved private access path from an authorized workstation to inspect
stored spans. Use application-generated trace IDs from allowlisted operational
logs. Do not publish collector access details, raw captures or credentials.

### Disable export and plan future workers

To disable export, set `VISOMI_OTLP_TRACING=false` in the target environment,
release the matching executable and verify the public application. Review
infrastructure changes separately. Retain telemetry storage until its removal is
explicitly requested; match runtime flags to the executable when rolling back.

A future queue worker must own initialization and shutdown, drain active jobs
before closing dependencies and telemetry, and fit within the environment's
shutdown budget. Configure queue persistence, eviction policy and concurrency
explicitly when introducing that capability.

References: [Jaeger storage](https://www.jaegertracing.io/docs/2.22/storage/badger/),
[Collector Docker images](https://opentelemetry.io/docs/collector/install/docker/),
and [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production).

### Browser error reporting

Browser error reporting is separately opt-in. Set `VISOMI_BROWSER_TELEMETRY=true`
to enable the intake. Without it, `/telemetry/config` returns `{ "enabled": false }`
and browser reports are not transmitted. Set
`BROWSER_TELEMETRY_ORIGIN` to the executable's public origin. Apply runtime
configuration separately from code changes. `VISOMI_OTLP_TRACING=true` and
private OTLP receiver credentials are required to export accepted reports.
Platform-managed telemetry must independently satisfy the capture policy.

The independent Angular Node executable supports the same flags and its own
public origin. It owns its telemetry runtime and closes it on SIGTERM/SIGINT.
`APP_VERSION` optionally supplies a bounded numeric service version; otherwise the
service version is `unknown`. Only the Node composition and executable can import backend telemetry;
Angular browser code uses the portable TypeScript capture library.

The gateway mounts the Angular composition with its existing telemetry runtime;
Angular does not initialize or close a second SDK. One browser intake accepts
both `web-app` and `web-site`, with separate asset allowlists and release
fingerprints. An asset from the other application is rejected. The gateway owns
the permit/correlation signing key, rate-limit store and shutdown for both.

Angular uses `provideBrowserGlobalErrorListeners()` and a custom `ErrorHandler`
that delegates to the `BrowserTelemetry` service. The browser entrypoint creates
one reporter, supplies it through dependency injection, and reuses it if bootstrap
fails. The same error object shares its pending report across those paths; shutdown
waits for that report. The service stops the reporter when Angular is destroyed.
No reporter is supplied during SSR. Raw diagnostics are printed only in browser
development builds; production browser reporting and SSR logs stay filtered.

Angular forwards both global errors and unhandled rejection reasons to the same
handler, so both use `unhandled_exception`; Astro's own listeners distinguish
`unhandled_rejection`. Source positions come from approved asset frames in the
error's stack, inspected locally without exporting the stack. Angular's native
handler does not forward the original `ErrorEvent` source fields when it already
has an error object. The functional HTTP interceptor observes same-origin `/api/`
network failures and 5xx errors, then propagates the original error to consumers.
It does not change request bodies, headers, or application error handling.

The browser POSTs individual reports to `/telemetry/errors`; it never receives
collector credentials. `/telemetry/config` supplies a short-lived reporting permit
and a public build asset allowlist with `Cache-Control: no-store`. POSTs require the
configured Origin, JSON content, a valid HMAC-signed permit and at most 2 KiB of
uncompressed input. Extra fields and arbitrary values are rejected with fixed
error codes. The process has a shared budget of 120 intake requests per minute,
including configuration reads; this deliberately avoids retaining IPs or browser
identifiers. Performance uses a separate fixed budget. Exhaustion drops telemetry
while normal application routes continue. The limiter reuses the installed
`express-rate-limit` memory store with fixed error/configuration and performance
keys; the owning executable closes that store during shutdown. This public
reporting endpoint is not proof of a human user or trustworthy error.

The approved `frontend.error` span has only:

- `operation=frontend.error`, `outcome=client_error` and the existing three resource fields.
- `frontend.application`: `web-site` or `web-app`.
- `frontend.error.code`: `unhandled_exception`, `unhandled_rejection`, `request_failed` or `startup_failed`.
- `frontend.error.kind`: `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError` or `unknown`.
- `frontend.screen`: `home`, `ui` or `unknown`; no raw route or history.
- An optional verified `code.asset` build fingerprint, `code.line` and `code.column`.
- `frontend.release`: the current approved asset-set fingerprint when a code location
  was verified, otherwise `unknown`. It is not a client-provided release value.

No raw error object, message, stack, URL, query, body, credential, cookie, IP,
user agent, customer identifier, baggage, event or exception is exported. Source
positions are accepted only when the asset exists in the executable's immutable
build and the position is inside that file. Third-party scripts and stale assets
produce unlocated reports rather than unverified code references. There is no
session replay, interaction tracking, persistent browser ID or external RUM SDK.

For explicitly observed API failures, `x-telemetry-context` carries a server-issued
HMAC-signed reference to that request's random trace/span IDs. The intake verifies
its signature, purpose and five-minute expiry before linking a browser error to
that backend trace. Invalid references are discarded and the browser error starts
a fresh root trace. Incoming `traceparent` remains ignored. Signing keys are random
and process-local: restarting or crossing replicas invalidates old references and
permits. Such reports may be dropped until the next permit refresh; there is no
shared key store or cross-replica delivery guarantee.

Angular and Astro production builds emit hidden source maps. The gateway and
Angular Node executable reject direct and percent-encoded `.map` requests before
static/SSR handling. Keep the matching build artifact privately while debugging;
rebuilding different source is not equivalent. Jaeger stores only code fingerprints
and positions, not the source maps or source contents. To resolve a location locally:

```sh
node tools/deployment/resolve-browser-error.mjs \
  --directory dist/apps/web/site/client \
  --asset <code.asset> --line <code.line> --column <code.column>
```

For Angular use `dist/apps/web/app/browser`. The command uses Node's built-in
source-map reader and prints the original source path and line/column. It does not
upload source maps or print source content. Keep source maps available only to
operators with access to the private build artifact; review source paths before
sharing resolved locations.

Verification includes portable reporter tests, Angular adapter tests, real browser
requests accepted by each executable, denial of source-map HTTP access, intake
privacy/authentication/abuse tests, and the pinned Jaeger integration check. The
latter stores and inspects an accepted browser error linked to its backend request,
then also checks restart persistence and collector outages. Initial failures before
the reporting script starts and telemetry delivery after leaving a page remain
best effort. Error grouping and a dedicated error-tracking dashboard are outside
this initial implementation.

### Browser performance reporting

Set `VISOMI_BROWSER_PERFORMANCE=true` alongside `VISOMI_BROWSER_TELEMETRY=true`
to enable OpenTelemetry performance capture for both Angular and Astro. Performance
is disabled by default, independently of error reporting. The same gateway or
standalone Angular executable supplies the opt-in through `/telemetry/config`.
The performance SDK is imported only after that opt-in; SSR does not initialize it.
Runtime changes and deployment remain separate from source changes.

Capture uses the pinned official navigation-timing and Web Vitals instruments,
with no browser resource detection or session management. A synchronous allowlist
copies approved numbers before creating SDK records. Only CLS, FCP, INP, LCP,
TTFB, DOM interactive, DOM content loaded, load completion, and Angular route
transition durations are transmitted.
No URLs, query strings, metric IDs, client timestamps, DOM targets, attribution,
interaction history, exception details, or arbitrary SDK records are sent.
Timings are milliseconds, rounded to two decimals and capped at 300,000; CLS is
dimensionless, rounded to four decimals and capped at 10. All values must be finite
and nonnegative. Measurements use the document's initial screen category, including
route transition reports; no source/destination screen history is exported.

Angular observes its Router only after performance opt-in, measuring elapsed time
from `NavigationStart` to completion, cancellation or failure. Fixed metric names
`route_completed`, `route_cancelled` and `route_failed` encode the result, with
milliseconds as the only value. Initial navigation and skipped navigations are
excluded. Superseded/redirected attempts finish as cancellations; a new attempt is
measured separately. Only the current operation's numeric ID and start time are
held locally for matching; IDs, URLs, route names, parameters, fragments, router
snapshots, cancellation reasons and exceptions are never passed to the SDK or sent.
The adapter unsubscribes when Angular is destroyed and does not run on SSR. Timing
covers router guards, resolvers, loading and activation, not final browser paint.

The browser sends strict reports to `/telemetry/performance`, using the same
origin, permit, payload limit and credential/referrer omission as errors. Reports
contain only the fixed application, fixed screen and up to eleven unique named
measurements. The server independently rejects unknown fields, applications,
categories, duplicates and out-of-range values. Route measurements are accepted only
for Angular. Client trace context is not adopted.
A separate 12-attempt browser budget leaves the error budget intact. The server
also uses a separate fixed 120-request performance budget per minute, preserving
the existing 120-request error/configuration budget. Permit refresh, replica
limitations, no-retry behavior and best-effort unload delivery also apply to performance.

The approved `frontend.performance` span contains `operation=frontend.performance`,
`outcome=success`, `frontend.application`, `frontend.screen`, and numeric
`frontend.performance.<name>` attributes for the eleven fixed names `cls`, `fcp`,
`inp`, `lcp`, `ttfb`, `dom_interactive`, `dom_content_loaded`, `load`,
`route_completed`, `route_cancelled`, and `route_failed`. Its random
IDs are server-generated; its span duration measures ingestion, not browser work.
The numeric attributes hold the actual browser measurements. These spans use the
existing authenticated private OTLP tracing export and existing resource allowlist.
The server also records same-named histograms (`ms`, or `1` for CLS) with only
application and screen attributes for configured metric readers. No external
metric exporter or browser-facing collector is enabled.

FCP/TTFB/navigation measurements can arrive after load; INP needs an interaction,
and final Web Vitals may arrive on visibility change. Browser support varies.
The reporter stops SDK emission on destruction; underlying Web Vitals listeners
may remain installed due to the upstream library's lifecycle limits. Error capture
continues to use the existing custom path. See the
[browser library](../libs/web/shared/observability/README.md#browser-performance)
for the capture and lifecycle policy.
