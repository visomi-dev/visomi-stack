# Deployment Model

## Deployment Direction

Themis uses one public gateway with multiple internal runtimes.

The deployed topology composes:

- the Astro site build from `apps/web/site`
- the Angular app build from `apps/web/app`
- the Express API runtime from `apps/web/api`
- the BullMQ worker runtime from `apps/worker`
- the Socket.IO realtime feature code from `apps/web/realtime`
- the public gateway runtime in `apps/web/server`

## Benefits

- one public entry point while keeping backend responsibilities separated
- simpler reasoning about scaling, ownership, and failures per runtime
- clear separation inside the repo without collapsing all behavior into one process

## Gateway Responsibilities

The gateway is the public-facing runtime.

It is responsible for:

- serving or mounting the public site and app
- mounting `/api` traffic on the same HTTP server
- attaching `/socket.io` websocket traffic to the same HTTP server

It owns monolith startup for local and container deployments while preserving feature boundaries internally. API and realtime share the public HTTP server; BullMQ worker execution runs in a managed child process so background work does not compete with the web event loop.

## Local Development

For local backend development, `pnpm nx run server:serve` starts `apps/web/server` as the orchestration entrypoint on `http://localhost:8080`.

It starts:

- API runtime
- worker runtime as a managed child process
- realtime feature code
- server gateway

The frontend can then be run separately with `pnpm nx run app:serve`. To keep the gateway as the public development origin while using the Angular dev server, start the gateway with `APP_DEV_SERVER_URL=http://localhost:4200` and open `http://localhost:8080/app`.

## Future Extraction Path

Split only when there is real operational pressure, for example:

- the API needs independent scaling
- background jobs require a dedicated worker runtime
- realtime delivery requires independent scaling or isolation
- the web app needs a distinct deployment topology
- native or hybrid clients need separate release lifecycles
