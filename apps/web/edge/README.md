# Production path guard

This Cloudflare Worker runs on `stack.visomi.dev/*` before the existing Railway
origin. Railway's proxy can return 502 for malformed percent escapes before the
gateway receives the request. The Worker returns a fixed, uncached 400 response
for invalid path encoding, including invalid UTF-8.

The path is decoded only for validation. Valid requests and origin responses are
forwarded unchanged, including request bodies, query strings, response streams
and CSP headers. Encoded literal percent signs such as `%25` are valid; the
Worker never decodes the path twice. The gateway's validation remains in place.

## Verify and deploy

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
pnpm nx run-many -p web-edge -t lint,typecheck,test,build
```

Copy `apps/web/edge/.env.example` to `apps/web/edge/.env` and fill in your account
and zone IDs. The local `.env` is ignored by Git. `cf` reads
`CLOUDFLARE_ACCOUNT_ID` natively, so the shared configuration has no account ID.
`CLOUDFLARE_ZONE_ID` is available for the manual route update below; the Worker
route itself uses the public zone name. These are CLI settings, not Worker
runtime bindings.

Export the local values before using the CLI (the pinned CLI version does not
load `.env` automatically for every command):

```sh
set -a
. apps/web/edge/.env
set +a
```

Authenticate with `cf auth login` for that account, then:

```sh
pnpm nx run web-edge:deploy --dry-run
pnpm nx run web-edge:deploy
```

After each deployment, reapply the route's fail-open quota setting as described
below, then run `pnpm nx run web-edge:smoke`.

The project uses the Cloudflare CLI and its Vite plugin. The Worker is deployed
separately from Railway; merging changes does not automatically deploy it.
Keep the existing proxied DNS record pointing to Railway. Use a Worker route,
not a Custom Domain that would replace that origin.

Worker logs, invocation logs, traces, Logpush, preview URLs and workers.dev are
disabled. The Worker has no bindings, secrets, storage or telemetry exporters.
It does not record request data or exception details.

The smoke task sends a small set of synthetic requests to production. It accepts
Cloudflare's own 400 HTML responses for escapes rejected before the Worker and
requires the fixed JSON response when the Worker handles validation. Neither
response may reflect the synthetic query marker. Local unit tests keep the
strict JSON contract for the Worker itself.

## Request quota and recovery

Workers Free allows 100,000 requests per day across the account. The production
route has `request_limit_fail_open: true`: when the quota is exhausted, requests
bypass this Worker and continue to Railway. The gateway still validates paths,
but malformed requests rejected by Railway's proxy may return 502 again.

The current `cf` route configuration does not expose that quota setting, and
`cf deploy` recreates the route with fail-open disabled. After every deployment,
use the [Worker Routes API](https://developers.cloudflare.com/api/resources/workers/subresources/routes/)
to list routes in the zone selected by `CLOUDFLARE_ZONE_ID`, find the current ID for
`stack.visomi.dev/*`, and update that route with this body:

```json
{
  "pattern": "stack.visomi.dev/*",
  "script": "stack-malformed-path-guard",
  "request_limit_fail_open": true
}
```

Read the route back and confirm `request_limit_fail_open` is `true`. This is a
required post-deployment step while the CLI lacks support; the route ID changes
on redeployment. No account upgrade or change to Cloudflare's DDoS protection is
required.

To roll back the filter, remove only the `stack.visomi.dev/*` Worker route in
Cloudflare. Keep DNS and the Railway gateway unchanged.

References: [Cloudflare CLI](https://developers.cloudflare.com/cf/get-started/first-worker/),
[Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/),
[request limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests).
