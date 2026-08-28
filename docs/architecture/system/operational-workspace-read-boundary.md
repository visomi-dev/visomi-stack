# Operational Workspace Read Boundary

**Contract:** `OperationalWorkspaceReadModelV1`
**Endpoint:** `GET /api/projects/{projectId}/workspace`

This boundary is authenticated, tenant-scoped, and read-only. It exposes only
approved operational project identity from the control plane. Protected
context and the project-domain collections are represented explicitly until an
authorized local-agent projection is available; the API never substitutes
cloud-readable plaintext for that projection.

## Compatibility

`schemaVersion` is a string discriminator and currently has value `1`. Additive
fields are compatible; changing field meaning or visibility requires a new
versioned contract and adapter. Clients must preserve unknown visibility states
as unavailable rather than treating them as empty.

## Visibility and authority

Every collection has `state`, `source`, `authority`, and `observedAt`.
`visible`, `empty`, `locked`, `unavailable`, `stale`, `error`, `unauthorized`,
and `malformed` are distinct. `locked` means content may exist but the reader
does not hold the local capability; it contains no protected preview.

The model has typed collections for `epics`, `workItems`, `runs`, `evidence`,
`reviews`, and `activity` (plus protected context), rather than placeholder
`never` or unconstrained arrays. `empty` is a valid projection with no
records. `unavailable` means the source cannot currently be reached, `stale`
means the last observation is outside the freshness policy, `error` means the
mediated read failed, and `malformed` means validation rejected its payload.
None of these failure states is normalized to `empty`.

The control plane is authoritative only for the minimized project identity and
tenant membership. The local agent remains the plaintext authority for
protected context, work-item detail, run output, evidence artifacts, review
feedback, and activity narratives. No mutation or review-decision operation is
part of this boundary.

## Failure and redaction semantics

An unknown project is returned as `404` without cross-tenant existence detail;
an unauthenticated request is `401`. Protected fields are omitted rather than
redacted into plausible text. Source outage and malformed mediated responses
must remain `unavailable` or `error` at the gateway/adapter boundary and must
not be converted to `empty`. Diagnostics must not contain keys, credentials,
tokens, raw context, or evidence payloads.

The Angular adapter maps HTTP 401 to `unauthorized`, 404/503 to
`unavailable`, malformed 200 payloads to `malformed`, and other transport
failures to `error`. Fallbacks contain empty items and a disclosure-safe reason
only. The adapter exposes no create, update, delete, execution, or
review-decision operation.
