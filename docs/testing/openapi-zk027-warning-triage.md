# ZK-027 OpenAPI warning triage

The RUN-107 OpenAPI runner creates one deterministic authenticated account,
workspace, enrolled owner device, enrolled local-agent device, recovery record,
and WebAuthn credential before Schemathesis starts. It writes the materialized
fixture schema and a sanitized boundary summary beside the JUnit and HAR files.

The required protected examples are therefore a **pass** when the boundary
summary contains HTTP 200/201 results for discovery, Web-only negotiation,
agent-assisted negotiation, opaque append, and opaque fetch.

Schemathesis coverage may still report warnings for generated stateful inputs:

- **Authentication warnings:** generated requests intentionally do not inherit
  the deterministic fixture's valid claim/session state for every operation.
  The protected examples and the explicit boundary checks use the authenticated
  cookie and are the authoritative RUN-107 pass decision.
- **Missing test data:** generated lifecycle identifiers are not valid seeded
  resources. Deterministic examples use the seeded workspace/device/recovery/
  credential identifiers; generated 404s are expected negative coverage, not a
  missing fixture blocker.
- **Schema mismatch warnings:** these are generated-input rejection reports,
  not runtime-validation changes. Runtime Zod validation remains strict. Any
  mismatch affecting a deterministic example is a blocker and must fail the
  runner; the RUN-107 boundary summary records that decision.

The warnings must remain visible in the Schemathesis output and reports. They
must not be suppressed by weakening schemas, disabling runtime validation, or
discarding the JUnit/HAR artifacts.
