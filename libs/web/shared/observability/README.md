# Browser error reporting

Portable TypeScript capture policy and browser reporter used by Angular and Astro.
Error reporting remains custom and independent of framework SDKs. Optional browser
performance capture uses browser observers, the pinned OpenTelemetry navigation
instrument and a local logs provider, loaded only with a browser grant at
document startup.

The performance transport also lives in that deferred module. Astro's default initial theme and consent scripts have a 6,656-byte raw budget
in two requests, including Vite's dynamic-import bootstrap. The initial listener sanitizes early exceptions immediately and retains at most
five descriptions while the pending store loads. Delivery and visits load on demand, and the optional
performance runtime adds at most one more request. The opted-in homepage stays
within 64 KiB across its four initial scripts. Browser tests exercise both configurations.

Reports contain fixed application, error code, error kind and screen names. Code
locations contain only the SHA-256 fingerprint of a deployed JavaScript asset and
positive line/column numbers. The receiving executable independently verifies the
asset and source position. Raw exception messages, stacks, URLs, request/response
bodies, cookies, credentials, customer identifiers and navigation history are not
transmitted. Build asset hashes identify code, never customers.

The reporter captures uncaught errors and unhandled rejections. Angular forwards
framework failures through its browser ErrorHandler. Handled errors and ordinary
HTTP failure responses are excluded. Automatic reporting requires the same live
browser grant at capture and transport, with GPC and DNT taking precedence.
An exception that occurred while automatic sharing was off is never sent
automatically.

The header shows a pending report indicator while automatic sharing is off and
at least one unexpected error can be reviewed. Each pending item contains only
fixed application, code, kind and screen values. Identical descriptions are
deduplicated. A document retains at most five in memory and drops the oldest
when full. Items expire after five minutes, and the reporter clears them on
teardown. The visitor can send one selected item or discard it. An explicit
manual send also works when a privacy signal blocks automatic sharing, uses
the same intake controls and never sets a consent grant. Manual previews and
payloads omit script locations since no permit or asset manifest is requested
as part of retention.

Reporting uses same-origin `/telemetry/config` and `/telemetry/errors`, omits
credentials and referrers, rejects redirects and never contacts Jaeger directly.
Configuration failures disable transmission. There are at most five attempts per
minute per reporter, duplicate suppression and no retries or persistent storage.
Reporting permits are refreshed on demand after four minutes. Transport failures
do not generate further telemetry or change application error propagation.

The server intake and deployment instructions are documented in
[the telemetry guide](../../../../docs/deployment.md#browser-error-reporting).

## Browser performance

Angular and Astro share the same browser grant for errors and performance.
Their Node executables mount the receiver by default. SSR never starts browser
observers.
Document performance is enabled only when the current grant was already present
at startup. Accepting on an open document does not read its buffered performance
measurements. Revocation stops the active runtime, and a new grant starts these
measurements on a subsequent document. Both capture and transport check the
original live grant. The pinned `NavigationTimingInstrumentation` supplies load
timings and time to first byte. The browser performance observers supply the
supported paint, layout-shift and input aggregates. Below the transport allowlist,
the input observer keeps only the ten longest grouped interaction timings for the
INP percentile. These numeric IDs are discarded when observation stops.

Only CLS, FCP, INP, LCP, TTFB, DOM interactive, DOM content loaded, load completion,
and Angular route transition durations are accepted. Timings are milliseconds (two decimals); CLS is dimensionless (four
decimals). Values must be finite and nonnegative, with a five-minute timing cap
and CLS cap of 10. A synchronous adapter copies only these names and numbers before
the local SDK creates records. It drops original timestamps, URLs, IDs, attribution,
DOM elements, bodies, resource metadata, and arbitrary fields. No global provider,
resource detector, session ID, console/error instrumentation, click tracking, or
trace propagation is installed. Web Vitals may observe rendering and input locally
to calculate aggregates; no target or interaction detail is retained or sent.

Document reports describe the document and its initial fixed screen category.
INP requires an interaction, and some final vitals are emitted
only when the document becomes hidden. Unsupported measurements are omitted.
Delivery after page departure remains best effort. Revocation disconnects every
performance observer, aborts its event listeners, stops the navigation instrument
and drops unsent measurements. Browser support determines which measurements
are available. Restoring a cached document does not synthesize new navigation
or paint timings.

Angular additionally subscribes to its Router only after performance opt-in. After
the first successful navigation, it measures `NavigationStart` to `NavigationEnd`,
`NavigationCancel`, or `NavigationError`. The fixed metric names are
`route_completed`, `route_cancelled`, and `route_failed`; only elapsed milliseconds
enter the same filtered local SDK. Initial navigation and skipped navigations are
excluded. Redirects that cancel a navigation finish that attempt and start a new
operation. The adapter keeps only one active numeric navigation ID and monotonic
start time locally; neither crosses the telemetry boundary. It does not inspect URLs,
route names, parameters, fragments, cancellation reasons, errors, or router snapshots.
The initial document screen remains the category for all reports, so transitions
cannot produce a history of visited screens. Timing includes router guards,
resolvers, lazy loading and activation, but does not claim to measure final paint.
Angular destruction unsubscribes the adapter. Astro route metrics are rejected.

`/telemetry/performance` reuses same-origin permits and strict intake validation.
It has a separate browser budget of 12 attempts per minute, preserving the existing
five-attempt error budget. Performance has its own fixed 120-request process budget,
independent of the existing error/configuration budget. There are no retries or
browser persistence. The server emits approved
`frontend.performance` spans via its existing private OTLP exporter and records
histograms for configured metric readers; this change does not enable an external
metric exporter or create a dashboard.

Run `pnpm nx test web-shared-observability` for capture and transport tests.
