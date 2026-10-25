# Development

Work from the current Visomi Stack repository root. The previous stack and Nive
are references; commands and completion claims from those repositories must be
checked against this workspace before reuse.

## Toolchain and project discovery

Use `.node-version` for Node, `package.json#devEngines` for runtime and package
manager requirements, `package.json` for declared dependencies, and `pnpm-lock.yaml`
for resolved versions. See the [README](../README.md#local-development) for setup.

Run Nx through pnpm. Inspect the resolved project configuration, including targets
inferred by plugins, before choosing commands:

```sh
NX_DAEMON=false pnpm nx show projects --json
NX_DAEMON=false pnpm nx show project web-api --json
```

The current projects are `web-api`, `web-gateway`, and `web-backend-shared`.
Do not substitute the legacy name `api` or assume planned projects such as
`server`, `app`, or `site` exist. Gateway import wiring is being developed separately.
Template initialization, doctor, smoke, and database migration scripts from the
previous stack are not available here. Check command help before using unfamiliar
flags. Agents should follow the Nx skill guidance in [AGENTS.md](../AGENTS.md).

## Verification

Choose checks relevant to the change and report the command, result, and any
remaining limitation. Focused checks for the API boundary and shared infrastructure are:

```sh
NX_DAEMON=false pnpm nx run-many -t lint typecheck test -p web-api web-backend-shared
NX_DAEMON=false pnpm nx run web-api:build
```

`web-api:test` depends on its build so the import and startup tests exercise the
actual emitted application. These tests cover side-effect-free CommonJS imports
under an ESM parent and standalone startup/shutdown. Colocated shared unit tests verify policy, runtime lifecycle, context isolation,
job correlation, and adapter completion ownership. API integration tests exercise
real HTTP listeners and local in-memory OpenTelemetry sinks. Playwright request
tests run the API through Nx serve and inspect telemetry exported to isolated local
files, including delivery during standalone shutdown. See the
[observability test guide](../apps/web/api/e2e/README.md) for suite ownership and commands.
They do not certify gateway composition, queue delivery, external providers, or deployment.

For Markdown-only changes, check the touched files and review the diff:

```sh
pnpm exec prettier --check README.md docs/architecture.md docs/development.md
git diff --check
```

When API behavior changes, verify the relevant HTTP behavior. When UI work begins,
verify keyboard access, labels, focus, and responsive states alongside the affected
behavior. Distinguish local fixtures from real infrastructure and provider testing;
historical or unrelated results do not establish current coverage.

## Contribution conventions

- Keep changes small and reviewable. Discuss consequential choices before implementation.
- Write documentation, code, and comments in English. Update documentation when behavior changes.
- Keep feature logic close to its owner. Introduce shared abstractions when there is a concrete need.
- Follow Screaming Architecture with DDD: name feature folders for business domains
  and capabilities, keep domain boundaries explicit, and reserve shared for cross-cutting
  infrastructure. Add aggregates, repositories, interfaces, or layers only when justified.
- Follow the current formatter, linter, and compiler configuration. Propose policy changes explicitly;
  the root TypeScript configuration currently has `strict: false`.
- Prefer focused checks over broad suites unrelated to the change. Document skipped verification.
- Use Conventional Commit messages, enforced by Commitlint.

The Husky pre-commit hook runs lint-staged, which formats staged files and lints
staged code, followed by affected Nx test and E2E checks. The commit-message hook
runs Commitlint. These hooks contain machine-specific Node paths: pre-commit uses
24.15.0, while commit-msg still points to 24.14.1. They need a later portability
review; do not describe them as verified on a fresh checkout. The API owns its
Playwright E2E configuration and directory; no separate E2E project is needed.

## Configuration and data hygiene

The current API uses `HOST` and `PORT` from its process environment for networking;
standalone startup validates the port. `NODE_ENV` maps to the controlled labels
`development`, `test`, `production`, or `unknown` for telemetry. It does not load
`.env` or validate a broader runtime configuration schema.
Container configuration describes additional variables for integrations that
have not been implemented.

Keep credentials, private environment values, customer data, and reference-project
resource identifiers out of source, documentation, examples, logs, and reports.
The current `.gitignore` does not exclude `.env` files; check ignore rules and
staged paths before creating any private configuration. Public metadata must
contain only values safe to expose to a browser.

When an integration is added, document only its implemented configuration: variable
names, purpose, defaults, validation, and public/private boundary. Use synthetic
examples and report diagnostic field names or safe error codes instead of values.

Use the shared telemetry facade rather than raw logger objects or SDK spans in
feature code. Add operational names and fields deliberately to its allowlist;
never pass request objects, payloads, raw errors, or customer identifiers to a sink.
Keep a job's technical context separate from its payload. External trace context
and baggage are untrusted and are not accepted at the public HTTP boundary.
See [observability ownership and privacy](architecture.md#observability-ownership-and-privacy)
for the current contract and exporter limitations.

## Maintenance

Update Node and pnpm declarations, container references, and any hook or CI references
together. Keep Nx packages compatible and aligned. Review dependency and lockfile
changes as part of the same change; do not regenerate the lockfile merely to make
an installation error disappear.

Validate a frozen install and relevant targets after tooling changes. Container
build and deployment verification remain separate from running the local API.

When persistence and release workflows are introduced, preserve applied migration
history, make environment changes explicit, and verify backup restoration before
relying on it. Initializer reruns, key rotation, destructive database operations,
and deployment are not implicit maintenance steps.
