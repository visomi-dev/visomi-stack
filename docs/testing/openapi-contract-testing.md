# OpenAPI Contract E2E Testing

The `api-e2e:openapi` Nx target runs Schemathesis against the OpenAPI document
served by the real composition server. It complements the Jest API workflow
tests; it does not replace tests that require explicit mailbox, session, or
domain setup.

## Run locally

Install `uv`, then run:

```bash
pnpm exec nx run api-e2e:openapi
```

The runner pins Schemathesis to `4.24.3` and `jsonschema-rs` to `0.49.1` through `uvx`, starts the same memory
database composition server used by `api-e2e`, and writes sanitized JUnit and
HAR reports to `dist/test-results/api-e2e/openapi/`. Newer `jsonschema-rs`
releases removed `CanonicalSchema.is_satisfiable`, which Schemathesis `4.24.3`
uses, so the explicit compatibility pin is required. Verify the resolution
with:

```bash
uvx --from 'schemathesis==4.24.3' --with 'jsonschema-rs==0.49.1' python -c \
  "from importlib.metadata import version; print(version('schemathesis'), version('jsonschema-rs'))"
```

The default target runs the bounded `examples` and `coverage` phases. The
`passkey-smoke-summary.json` report identifies the real HTTP registration-begin,
registration-complete, authentication-begin, and authentication-complete
cases.

For the longer property-based pass, run:

```bash
pnpm exec nx run api-e2e:openapi-fuzz
```

## Test policy

- The schema is loaded from the running API at `/api/openapi.json`.
- Examples, coverage, and deterministic fuzzing are enabled.
- The fixed seed makes failures reproducible in local and CI runs.
- The default target is bounded so it is suitable for pull requests; the
  `openapi-fuzz` target opts into the fuzzing phase explicitly.
- The test API is enabled only to support the existing in-memory composition
  server; its routes must not be treated as public API contract coverage.
- The runner bootstraps one ephemeral account through the in-memory test
  mailbox and passes the resulting sanitized session cookie to generated
  requests. Detailed OTP and password-recovery workflows remain in the
  explicit Jest API E2E suite.
- Passkey smoke setup creates ceremony rows only through real HTTP begin
  endpoints and uses the returned challenge IDs and option challenges. The
  challenge-mismatch case uses two persisted begin results so the session
  pending challenge and submitted challenge are both real.
- Expiry, consumed/replay, PIN-gate, challenge-mismatch, and origin/RP-specific
  outcomes are reported from application responses. The test-only composition
  preloads `fake-clock.cjs` for the five-minute TTL case; PASSKEY-007 makes the
  boolean PIN state reachable over HTTP; and the fixture creates standards-valid
  WebAuthn material before exercising consumption and origin/RP checks.
  The passkey fixture uses ephemeral P-256 keys and hand-built WebAuthn
  `none` attestation/assertion CBOR. It receives every challenge ID and
  challenge from the API, persists credentials only through the registration
  HTTP endpoint, and performs authentication through the authentication HTTP
  endpoint. The composition server is preloaded with the test-only
  `apps/web/api-e2e/src/support/fake-clock.cjs`; the fixture advances a clock
  file for the expiry case and restores it before continuing. This bounded
  setup changes no production source and is removed with the report directory.
  The smoke report records the actual HTTP response for successful and negative
  registration/authentication begin/complete cases, including expiry, replay,
  persisted challenge mismatch, origin mismatch, RP mismatch, and successful
  authentication.

## Reproducing a failure

Schemathesis prints a minimal reproduction for failed cases. The generated HAR
file in the report directory can be inspected without exposing credentials;
report output is configured to sanitize sensitive values.
