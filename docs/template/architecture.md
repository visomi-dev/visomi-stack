# Template Architecture and Themis Integration

## Reusable runtime foundation

The gateway serves Astro at `/`, Angular at `/app`, Express at `/api`, and Socket.IO at `/socket.io`. It starts the worker runtime. PostgreSQL stores operational/account state; Redis supports queues and shared runtime behavior. `/healthz` is liveness; `/readyz` reports gateway bootstrap readiness. Doctor also checks PostgreSQL/Redis independently, so gateway readiness is not treated as a complete dependency audit.

Authentication, sessions, middleware, input validation, and error contracts belong to the foundation. `libs/shared` owns cross-cutting runtime code; its `shared/environment-schema` public subpath exposes validation without loading `.env`, databases, or sessions. Template tooling bundles that source using the `visomi-source` export condition.

Public application branding is read from `template.json` by the web surfaces. Never put secrets in that file: it is bundled into client-visible code. Internal package identities (`shared`, `projects`, and workflow packages), schema names, and migration history are stable implementation contracts, not branding fields.

## Product examples

The project domain, sample landing copy, assets, and protected/zero-knowledge storage flows are examples for derived products. Initialization changes explicit metadata, visible application branding, and local service identity; it does not rewrite every mention of the upstream template in documentation or marketing content. Customize sample content and assets as deliberate product work.

Worker and realtime are currently part of the composed gateway contract. Google and TOTP enrollment have supported configuration switches. Local-agent and object-storage integrations can be left unconfigured in development, with their features unavailable; the current production runtime imposes stricter requirements. Removing a runtime/module requires an architectural change, not a misleading bootstrap checkbox.

## Optional Themis developer workflow

Themis provides local work items, execution evidence, and review workflows in `.themis`, `.opencode`, `libs/themis-workflow`, and the example CLI. These tools are not required to follow the README's application bootstrap.

Initialize/register your new workspace through `/themis-onboard` or the documented Themis CLI/tools. Machine-local registry paths are not portable application configuration. The clean-copy smoke excludes inherited `.themis/registry.json`; it never edits the source workspace's registry/state. Existing work-item state and event files must continue to be mutated through Themis tools, not bootstrap file replacement.

The historical [Themis roadmap](../constitution/roadmap.md) documents product evolution. The reusable-template milestone is tracked independently in [template readiness](../../plan/feature-template-readiness-1.md).
