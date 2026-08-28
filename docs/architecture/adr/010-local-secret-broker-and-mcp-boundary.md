# ADR 010: Local Secret Broker and MCP/Tool Boundary

## Status

Proposed; capability wire format, durable replay/revocation, and consent UX
remain the open decisions recorded by ADR 008 and ADR 009.

## Decision

The local agent owns the only secret authority. `SecretBroker` keeps secret
values in local process state, requires an exact `use-secret` capability and
explicit consent, and returns only a metadata result. It never returns a
secret, root key, credential, prompt, or tool payload. Cloud services and MCP
transports may carry opaque capabilities but cannot impersonate this authority
as plaintext.

`McpBoundary` is a deliberately bounded registry of local tools. Requests must
carry a process-local authenticated invocation proof issued by
`LocalAgentContextAuthority` after the device identity store verifies active
enrollment for the account/workspace. Possession of this opaque, random
session proof is the trusted invocation boundary; enrollment identifiers alone
cannot create one. The boundary re-verifies the proof, its bound context, and
enrollment on every request, so transport metadata cannot establish caller,
account, workspace, or device authority. Forged-context and cross-device
possession tests cover this boundary. Requests are audience-bound to the exact `mcp:<tool>` name and
authorized by the local capability policy. Tool input is untrusted data:
capability-looking fields in prompts or tool arguments are ignored. Tool output
is data, not authority; secret-classified results are denied rather than
forwarded.

Lock state is authoritative local-agent state shared by MCP and the broker;
caller-supplied state is ignored. Locked, revoked, and non-ready requests fail
closed. Each boundary exposes capability revocation, and each rejects a
same-request replay before executing it. Expired capabilities,
replays, wrong subjects, wrong purposes, wrong audiences, and scope escalation
are denied by the shared capability policy. Every decision emits metadata-only
local audit state; values, prompts, tokens, and provider responses are never
recorded.

## Scope and non-goals

This is a local boundary proof, not a provider integration, sandbox runtime,
unbounded catalog, durable credential migration, or cryptographic capability
format. External-AI calls remain a separate ADR 009 consent/redaction boundary
and are not implemented here.

## Open decisions

1. Select signed capability encoding and durable replay/revocation storage.
2. Define durable local audit retention and consent UX before production use.
3. Define sandbox enforcement and the approved bounded tool catalog.
4. Replace the in-process session registry with durable authenticated transport
   proof before exposing the boundary beyond the local agent process. Until
   then, the process-local authenticated invocation proof is an explicitly
   constrained trusted boundary, not an enrollment-only authentication scheme.
