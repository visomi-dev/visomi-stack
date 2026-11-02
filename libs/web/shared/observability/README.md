# Browser error reporting

Portable TypeScript capture policy and browser reporter used by Angular and Astro.
Error reporting remains custom and independent of framework SDKs. Optional browser
performance capture uses the pinned official OpenTelemetry browser instrumentations
and a local logs provider, loaded only after explicit server opt-in.

The performance transport also lives in that deferred module. Astro's default
theme/error scripts have a measured raw-size budget of 6 KiB in two requests,
including Vite's dynamic-import bootstrap (the earlier error-only budget was
4 KiB). With performance enabled, the three scripts together are bounded at
64 KiB. Browser tests exercise both configurations.

Reports contain fixed application, error code, error kind and screen names. Code
locations contain only the SHA-256 fingerprint of a deployed JavaScript asset and
positive line/column numbers. The receiving executable independently verifies the
asset and source position. Raw exception messages, stacks, URLs, request/response
bodies, cookies, credentials, customer identifiers and navigation history are not
transmitted. Build asset hashes identify code, never customers.

The reporter listens for `error` and `unhandledrejection`. Angular also forwards
framework failures through `ErrorHandler` and explicitly observes same-origin API
failures through an HTTP interceptor. Astro consumers can use
`browserErrors.fetch` from the site's adapter for explicitly observed API calls.
Network errors and HTTP 5xx are reportable; expected HTTP 4xx are not.

Reporting uses same-origin `/telemetry/config` and `/telemetry/errors`, omits
credentials and referrers, rejects redirects and never contacts Jaeger directly.
Configuration failures disable transmission. There are at most five attempts per
minute per reporter, duplicate suppression and no retries or persistent storage.
Reporting permits are refreshed on demand after four minutes. Transport failures
do not generate further telemetry or change application error propagation.

The server intake and deployment instructions are documented in
[the telemetry guide](../../../../docs/deployment.md#browser-error-reporting).

## Browser performance

`VISOMI_BROWSER_PERFORMANCE=true` additionally enables performance capture when
`VISOMI_BROWSER_TELEMETRY=true`. Angular and Astro share the same reporter lifecycle;
SSR never starts browser observers. Capture uses `NavigationTimingInstrumentation`
and `WebVitalsInstrumentation` from `@opentelemetry/browser-instrumentation` 0.9.0.
This release uses `setLoggerProvider()` followed by `enable()`; newer upstream
examples use a different API. Both instruments are constructed disabled before wiring.

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
Delivery after page departure remains best effort. OpenTelemetry's Web Vitals
instrumentation stops emission on disable, but its underlying web-vitals listeners
cannot all be removed. The reporter disables instruments and shuts down its local
provider when its owner stops it.

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
