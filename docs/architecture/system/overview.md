# System Architecture

## Recommended Direction

Build Themis as a monolith-friendly product inside this workspace with explicit runtime boundaries.

The initial repository shape is:

- `apps/web/site` for the public landing surface
- `apps/web/app` for the product web app
- `apps/web/api` for structured backend endpoints
- `apps/worker` for BullMQ workers
- `apps/web/realtime` for Socket.IO delivery
- `apps/web/server` as the public gateway and reverse proxy

## Runtime Topology

Runtime composition:

- `/api/*` routes are owned by the Express API
- `/socket.io` is owned by realtime feature code and attached to the same HTTP server as the API
- all remaining public routes are owned by the Astro site
- the Angular application remains independently runnable during development and can later be mounted behind the composed server when product routes are ready
- background project work runs in the dedicated worker runtime
- cross-runtime async-work events flow through Redis pub/sub

## Why This Shape Fits Themis

- it preserves one repository and one operational runtime entry point
- it keeps the public marketing surface independent from the product app surface
- it keeps HTTP, background work, and realtime delivery independent without losing a single public entry point
- it allows the API to evolve without coupling worker and websocket behavior into the same process
- it leaves room for future extraction if mobile, hybrid, or native clients are added later
