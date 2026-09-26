# Correlated operational telemetry

`libs/backend/shared/src/lib/observability.ts` owns an AsyncLocalStorage request context.
A versioned `globalThis[Symbol.for('visomi-stack.observability.v1')]` registry
shares the context, counters, response ownership, and reporter across separately
bundled copies in the same process. Separate processes still use explicit job
metadata to carry correlation.

The gateway installs middleware before authentication handlers. The API installs
the same middleware before JSON parsing and authentication, covering standalone
mode and parser failures. A shared WeakMap identifies responses already instrumented
by the gateway: embedded middleware re-enters their original context, even after
an async boundary loses it, without replacing headers or adding completion listeners.
Duplicate middleware therefore counts and logs each request once. It accepts a single 1–64 character ASCII
alphanumeric/underscore/hyphen `x-request-id`, starting with an alphanumeric.
Missing, malformed, oversized, or duplicate/combined values receive a random UUID.
The chosen ID is returned as `x-request-id`. An ID is diagnostic metadata, never
an authorization credential or trustworthy proof of origin.

Pino adds the active context through a mixin. Operational HTTP events contain
only the request ID, fixed operation, elapsed milliseconds, numeric status, and
a fixed outcome code. They omit URLs, query strings, paths, request bodies,
cookies, authorization headers, identities, and exception messages. Finish and
close events share an idempotent counter update; abandoned requests are recorded
as aborted. Production logging emits JSON; development uses the existing pretty stream.
Structured credential/request fields are additionally redacted, and the `err`
serializer drops raw messages/stacks. This is defense in depth: callers must
never interpolate secrets into free-text log messages or invent unredacted
credential fields. Operational logs intentionally use fixed messages.

Morgan and its raw URL/query-string output are removed from the API. Shared HTTP
error handling logs a correlated fixed operational category and status through
Pino, never the exception message, data, headers, body, or arbitrary application
error code. Application error codes/messages/data in HTTP responses remain
unchanged. Tests assert both the response contract and captured structured logs.

The project-seed API producer explicitly adds an `observability` transport field.
The worker restores that context and removes the field before strict domain
validation. Account, user, project, and job IDs must remain valid UUIDs; unknown
domain properties are rejected. Old jobs without metadata receive a fresh ID.
No BullMQ prototypes or third-party behavior are patched. Existing domain
authorization and failure-state handling remain in the project feature.

`operationalMetrics()` returns a copy of process-local request count, error count,
total HTTP duration, successful job-attempt count, and failed job-attempt count.
Counters have no user/tenant/URL labels and reset on process restart. Job retries
count as separate attempts; these are not unique-job delivery metrics. Combine
count/duration deltas for interval averages. These counters do not provide latency
percentiles, persistent storage, or cross-replica aggregation. No unauthenticated
metrics endpoint is created. An operator can wire a protected internal collector
or an explicitly approved exporter later.

`setErrorReporter(adapter)` is an optional in-process seam receiving only the safe
operational event for failures. It sends nothing externally by default. Adapter
exceptions and rejected promises are isolated from application execution. Configure
an adapter separately in each worker/gateway process if needed. Vendor credentials,
cloud accounts, automatic external reporting, and environment configuration are
not introduced by this change.

## Integration

The coordinator added the shared barrel exports; worker build and gateway unit
tests now pass. Tests also independently evaluate this module twice, verify
cross-copy context/reporter/counter sharing, and exercise overlapping embedded
requests through a detached async boundary. API wiring tests exercise actual
`createApp` in standalone and embedded modes with only migration/auth-runtime
infrastructure mocked, asserting one safe completion event and no raw URL output.

No environment fields are required. Existing `template:smoke --restore` works
through the template command; an optional root package alias may point to
`pnpm nx run template:smoke --restore`. No root manifest edit is required for the
direct Nx command.
