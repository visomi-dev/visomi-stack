# Shared web backend infrastructure

`@visomi-stack/web-backend-shared` exposes the shared observability runtime,
capture policy and HTTP infrastructure used by the API and gateway.

The owning executable explicitly initializes and shuts down telemetry. Importing
this library does not initialize it. Applications can supply a runtime to their
HTTP adapters or use the current runtime within the same process.

The owning runtime can opt into the official Railway OTLP/HTTP protobuf exporter
with `VISOMI_RAILWAY_TRACING=true` and Railway's receiver variables. It exports
only the facade's allowlisted spans; global instrumentation and resource discovery
remain disabled. Export is off by default, and the public gateway remains off due
to Railway's independent edge capture policy. See the
[Railway guide](../../../../docs/railway.md#observability-and-future-workers)
for configuration, capture boundaries, and receiver verification.

`src/lib/http/` owns `HttpError`, `AuthHttpError`, `httpErrorHandler` and
`securityHeaders`. Application factories compose these exports; they do not
duplicate their policies.

```ts
throw new HttpError(422, 'request_invalid', 'Check the supplied fields.', { fields: ['label'] });
throw new AuthHttpError(401, 'authentication_required');
```

`HttpError(status, code, message?, body?)` accepts error statuses 400–599 and a
JSON-compatible body. The response is `{error: code, message?, body?}`. An omitted
message or body stays absent, preserving existing code-only responses. The
exception's diagnostic `message` still defaults to its code. Explicit messages
and bodies are public response data: never pass raw exceptions, SQL or secrets.
`AuthHttpError` extends it and accepts only 401 or 403. Validation, conflicts,
rate limits and availability failures use `HttpError` with their own status.

`httpErrorHandler` recognizes these errors across independently compiled bundles
in the same process. Arbitrary exceptions and objects with status-like fields
receive a fixed `500 {error: 'internal_error'}`. A started response is closed
without another body or forwarding the raw exception to the socket. The old
`operationalErrorHandler` export remains an alias. Error messages, codes and
bodies are not added to telemetry.

`securityHeaders()` constructs Helmet 8.3.0 middleware at composition time. It
uses Helmet's defaults with `style-src 'self'`, no legacy Google/inline-script
exceptions, and production-only HTTPS upgrading/HSTS. HSTS covers the current
host for one year without `includeSubDomains`. Production defaults come from
`NODE_ENV`; an owner may explicitly call `securityHeaders({production: boolean})`.
This policy covers the current API/gateway surface; frontend SSR requirements
must be reviewed when those mounts exist. See [Helmet's reference](https://helmet.js.org/).

The API's `authMode`, `errorMode` and `helmetMode` are independent and default to
`managed`. Embedded consumers use `inherited` only when their host owns that
middleware. Install Helmet and authentication before mounting, and the error
handler after mounting. The gateway follows this contract for the compiled API;
it can also inherit Helmet/error handling from an enclosing parent. There is no
middleware introspection, implicit installation or cross-process sharing.

Run checks from the workspace root:

```sh
pnpm nx test web-backend-shared
pnpm nx run-many -t lint typecheck typecheck-tests -p web-backend-shared
```

See [observability ownership and privacy](../../../../docs/architecture.md#observability-ownership-and-privacy)
and the [API test guide](../../../../apps/web/api/e2e/README.md) for capture
boundaries and suite responsibilities. Database infrastructure lives in the
separate [shared backend library](../../../backend/shared/README.md).

## Typed route contracts

`defineRoute`, `routes.register`, `validateRequest` and `createApiDocument` connect
Express routes, native Zod inference and OpenAPI 3.1 documentation. Contracts own
an explicit method/path and a single Zod request object. The registration adapter
parses the configured HTTP sections and passes `z.output<typeof contract.request>`
to the handler, including transformed values. It does not mutate `request.query`
or store per-request data on singleton services. The generic adapter uses the
schema's actual output; no cast or caller-selected validated-data type is involved.

`routes.register(router, routes, controller?)` accepts an ordered array of objects with `contract`,
`handler` and optional `beforeValidation` middleware. Each handler retains its own
contract's inferred input, even when the array contains different request schemas.
Pass the controller once to bind all its methods inside the utility:

```ts
routes.register(
  router,
  [
    {
      contract: devicesContracts.requestApproval,
      handler: controller.requestApproval,
      beforeValidation: [anonymous],
    },
    { contract: devicesContracts.getApprovalStatus, handler: controller.getApprovalStatus },
  ],
  controller,
);
```

Entries and their guards run in declaration order. Where a router has middleware
between groups of routes, register each group around that existing middleware.
`registerRoute` remains available for individual operations.

Use strict body objects for operation payloads, and regular object schemas for
selected headers/query/path parameters. Authorization middleware can run before
validation; application services continue enforcing their business invariants.
`validationErrors` is an explicit static mapping of trusted schema error codes to
public HTTP statuses/codes. Unknown messages and unrecognized keys receive
`400 request_invalid`. Raw issues, input values and dynamic paths never enter
responses or telemetry. Synchronous and asynchronous handler failures reach the
owning Express 5 error boundary.

Document generation accepts contract descriptors, an explicit relative server
base and optional security components. It rejects duplicate method/path pairs and
operation IDs. It owns no application registry, router imports, listeners,
connections, timers or decorators. Applications decide which contracts to expose;
the gateway continues consuming the compiled API. Runtime manifests include the
pinned external Zod and zod-openapi packages.
