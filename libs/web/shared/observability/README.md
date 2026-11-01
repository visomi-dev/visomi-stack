# Browser error reporting

Portable TypeScript capture policy and browser reporter used by Angular and Astro.
There are no framework or browser OpenTelemetry SDK dependencies.

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

Run `pnpm nx test web-shared-observability` for capture and transport tests.
