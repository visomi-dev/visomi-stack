# Architecture

Visomi Stack is a reusable application foundation. The reboot proceeds through
small, agreed changes; this document records the current state separately from
the intended architecture. It is not an implementation plan or a feature inventory
for the previous stack.

## What exists today

```text
apps/
  web/
    api/          # web-api: application factory and standalone startup
    gateway/      # web-gateway: ESM host mounting the compiled API at /api
libs/
  backend/
    shared/       # backend-shared: HTTP-independent database and email capabilities
  web/backend/
    shared/       # web-backend-shared: shared infrastructure and observability
```

`apps/web/api/src/app.ts` exports `createApp()`. Calling it configures and returns
an Express application without opening a listener or initializing telemetry.
`main.ts` owns standalone telemetry initialization, listening, SIGINT/SIGTERM
handling, HTTP draining, and bounded telemetry shutdown. The public `GET /` endpoint returns a static JSON greeting. The authentication
capability provides passkey and password signup/sign-in, email verification,
Google account unification, TOTP and backup codes, restricted recovery/device
enrollment, and method/session management under `/auth`, backed by PostgreSQL. Unknown routes and
application errors return fixed responses. See the [API guide](../apps/web/api/README.md)
for the schema, migration commands and managed/inherited ownership contract.

`libs/backend/shared/drizzle.config.ts` configures Drizzle at the library root.
`src/lib/database/` owns domain schemas and one migration history for all backend
modules. The API imports its
authentication schema through the shared library. Database initialization remains
explicit: each executable creates and closes its own pool and supplies it to the
modules it composes. Imports do not open connections or run migrations; separate
processes share PostgreSQL state, not JavaScript resources.

`libs/backend/shared/src/lib/mail/` owns SMTP delivery, typed authentication mail
content, MJML templates, escaped HTML/plain-text rendering and generated resources.
Its `emails-build` target runs before the API build. Auth decides when to send
messages and translates mail failures to HTTP; the executables create and close
the injected transport.

The API's Rolldown build preserves named `app` and `main` entries with stable
`app.js` and `main.js` filenames, CommonJS output, external runtime dependencies,
and public application exports. Generated `package.json` explicitly declares
`type: commonjs` and directs package imports to `app.js`. Shared chunks belong
to the deployment artifact and must be copied with both entries.

The gateway imports the compiled API's `app.js`, never API TypeScript source or
`main.js`. Its ESM build emits stable `app.js` and `main.js` entries with
`type: module` metadata. Native ESM imports the API's existing CommonJS public
exports without changing that API contract. Preserve both complete sibling output
directories and their declared runtime dependencies.

`createGatewayApp()` composes Express without starting resources. Gateway
`main.ts` owns the listener, telemetry, optional SMTP transport and database pool; it creates the
API's auth runtime and installs its middleware before mounting at `/api` with
`authMode: inherited`. Helmet policy and HTTP error classes/handling live in
`web-backend-shared/src/lib/http/`. The API also delegates headers and error
responses through explicit `helmetMode: inherited` and `errorMode: inherited`;
standalone defaults manage both. The host installs Helmet before authentication
and routes, then installs the shared error handler last. Domain-specific failure
translation stays with auth. The same observability instance crosses both bundles,
with one completion record per request. Shutdown drains HTTP work, closes the
owned pool, and flushes telemetry. Auth routes fail closed without a configured
database. Paths outside `/api` currently return 404. Process integration tests
exercise the actual compiled gateway and API, including real PostgreSQL and
cryptographically valid WebAuthn; the API's own import harness remains separate.
Angular SSR, Astro, background workers, and realtime delivery remain unimplemented.
The container runtime starts the standalone API. Compose applies versioned
migrations through a separate one-shot database initializer before starting it;
the API does not own schema migration or seed execution.

## Screaming Architecture and Domain-Driven Design

This is the architectural direction for feature development. Top-level feature
folders should name business domains and capabilities, so the code's organization
communicates what the system does. Do not organize all features into global
`controllers/`, `services/`, and `repositories/` folders. Keep each domain's
behavior, contracts, and domain-specific infrastructure close to its owner.

Make domain boundaries explicit and use their public entry points. Put genuinely
cross-cutting runtime infrastructure in `libs/web/backend/shared`; observability
is the current concrete example. The library's `src/lib/observability/lib/` owns
the facade and privacy policy; `middleware/` contains its Express adapter.
There is no duplicate API-local telemetry implementation or empty feature hierarchy.

The current repository is evidence for runtime composition and shared infrastructure,
not for completed business domains. Introduce aggregates, repositories, interfaces,
or additional layers only when current requirements justify them. Neither the
legacy stack's domain model nor Nive's product behavior establishes a requirement here.

## Observability ownership and privacy

The shared library exposes `initializeObservability`, `currentObservability`,
`httpObservability`, and `operationalErrorHandler`. The returned facade provides
controlled runtime events, request correlation, job context capture/execution,
and shutdown. Pino writes structured logs; OpenTelemetry supplies explicit spans,
async context, request/job counters, and duration histograms in seconds.
The integration owns its context manager and providers without registering global
providers. Feature code uses the facade, so unaudited instrumentation cannot feed
its sinks through global SDK access.

`initializeObservability()` constructs an internal `ObservabilityRuntime` class;
the exported `Observability` type remains the consumer contract. Its public methods
are bound to preserve detached callback usage.

Initialize once from the process's owning startup path. A process registry reuses
the same facade across separately bundled copies of the shared library; the first
owner chooses service metadata and local sinks. Embedded `createApp()` reuses that
runtime or accepts it explicitly. It never initializes a second SDK. A bare factory
without an initialized or supplied facade remains uninstrumented. The owner drains
its application work before shutting down telemetry; consumers do not shut down
their host's runtime.

HTTP middleware generates a random request ID at the public boundary. The first
middleware instance owns one span and one completion record across finish/close;
later instances re-enter its context without duplicating output. All public HTTP
requests start fresh traces. External request IDs, trace headers, and baggage are
ignored. Fixed `client_error`, `server_error`, and `aborted` outcomes distinguish
failures without recording exceptions.

Telemetry uses explicit field and value allowlists:

- Resources contain only approved service name, release version, and environment.
- Logs contain fixed event/message names, outcomes or controlled codes, optional
  HTTP status and duration, and generated request/trace/span IDs. Pino host/PID
  bindings are disabled.
- Span names are fixed `http.request` or `job.execute`. Span attributes contain
  only operation, outcome, and optional HTTP status. Raw exceptions, events, links,
  arbitrary attributes, and data-bearing resource detectors are not exposed by the facade.
- Metric labels contain operation, outcome, and optional HTTP status. Identifiers
  are never labels. Each counter or duration histogram has a single implementation.

Bodies, cookies, tokens, IPs, user agents, customer identifiers (including hashes),
actual URLs/query strings, SQL containing data, Redis keys, job payloads, and raw
exception messages/stacks are excluded from every signal. There is no broad
auto-instrumentation, Morgan, pino-http, automatic resource discovery, or environment-driven exporter setup.

`captureJobContext()` returns only versioned request/trace/span IDs. Store that
technical carrier separately from domain payloads in a trusted queue boundary;
`runJob(carrier, work)` rebuilds context from the allowlisted fields and preserves
the application's result or error. It accepts no baggage or trace-state fields.
The carrier is correlation metadata, never authentication or authorization. Do not
populate it from public request bodies. Cross-process tests cover serialization
and restoration; no queue or worker application has been integrated yet.

Logs default to local JSON output. No external exporter, monitoring account, or
observability infrastructure is configured. Trusted startup options allow local
test sinks; any future production exporter requires an output audit and explicit
configuration. Shutdown is idempotent and bounded (one second by default, at most
five seconds); failures cannot rewrite application results or expose raw errors.

## Intended direction

Angular SSR, Astro, Express, and separate gateway, worker, and realtime
responsibilities are the agreed direction for the reboot. The following paths
and public mounts describe the intended organization. The API and gateway
directories exist, and the gateway currently composes only the API. Frontend,
worker and realtime composition remain future work.
Future Nx project names must be checked when projects are created.

| Boundary    | Intended location   | Responsibility                                                                        |
| ----------- | ------------------- | ------------------------------------------------------------------------------------- |
| Public site | `apps/web/site`     | Astro public pages, served at `/`.                                                    |
| Application | `apps/web/app`      | Angular application with server-side rendering, served at `/app`.                     |
| API         | `apps/web/api`      | Express HTTP endpoints, mounted at `/api` by the gateway.                             |
| Gateway     | `apps/web/gateway`  | Public HTTP entry point composing the site, application, API, and realtime transport. |
| Worker      | `apps/worker`       | Background processing, with feature handlers owned by their domains.                  |
| Realtime    | `apps/web/realtime` | Connection authorization, subscriptions, and delivery of authorized events.           |

The gateway provides a common public origin while keeping feature logic in its
own boundary. The standalone API currently serves `/`; the intended `/api` mount
does not exist yet. Realtime protocol and path, worker startup, process management,
and scaling remain implementation decisions for later steps.

As shared code is introduced, keep browser utilities free of backend dependencies
and browser-only operations out of SSR execution. Platform-neutral contracts
should be usable without starting a server, opening a database, or importing a
frontend framework. Shared libraries should have clear owners and public entry
points; their names and layout can be decided when needed.

## Decisions still open

The topology does not select:

- Authentication beyond the implemented passkey/session slice, recovery, and domain authorization policy.
- Tenant boundaries, domain database isolation, and storage beyond the implemented PostgreSQL/Drizzle authentication slice.
- Queue and realtime libraries, delivery guarantees, or event contracts.
- UI components, styling foundations, localization, or PWA behavior.
- Encryption, browser vaults, local-agent integration, or synchronization protocols.
- Hosting, ingress, deployment composition, external telemetry exporters/providers, or release controls.

PostgreSQL now backs authentication through explicit Drizzle migrations. Redis and
MinIO still only appear in inherited container configuration; their presence does
not establish working integrations or settle these decisions.

## Reference boundaries

The previous Visomi Stack provides historical requirements and design rationale.
Its implementation descriptions, accepted ADRs, test results, and production
claims do not automatically apply to this reboot. Conflicting or superseded
documents require a fresh decision before adoption.

Nive is an important implementation reference for later work. Reusable platform
behavior should be assessed individually; its financial, shopping, household,
and other product-specific behavior is outside the stack unless explicitly agreed.
Both reference projects remain read-only for this reboot step.

Update these documents as capabilities land. Add a separate decision record only
when a consequential choice needs lasting rationale; routine work does not require
a spec collection.
