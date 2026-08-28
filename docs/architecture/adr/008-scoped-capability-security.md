# ADR 008: Scoped Capability Security and Delegation

## Status

Proposed; the capability wire format and durable registry remain open decisions.

## Decision

The local agent is the capability authority. It issues, validates, delegates,
and revokes capabilities; cloud services and MCP transports may carry opaque
capabilities and enforce coarse account/device metadata, but a successful cloud
response is never permission to read plaintext or use a secret.

A capability is bound to one `accountId`, `workspaceId`, optional `projectId`
and `resourceId`, exactly one action (`read`, `write`, `execute`, `use-secret`,
or `delegate`), one subject, one audience, one purpose, an issuance time, an
expiry time, and a unique ID. The policy implementation requires an exact
scope match rather than interpreting omitted IDs as wildcards. This prevents a
project capability from silently becoming a workspace capability.

The current TypeScript model in `capability-policy.ts` is a policy seam and
testable proof, not a cryptographic token commitment. Signature encoding,
algorithm, key storage, and durable revocation storage require security review.

## Issuance, delegation, and expiry

- Only the local agent may issue a capability after user/policy authorization.
- The default is non-delegable. A delegated capability must be explicitly
  marked delegable, have a narrower-or-equal scope, the same or narrower
  audience, and an expiry no later than its parent.
- Every capability has a short, explicit expiry. No indefinite capability or
  implicit renewal is allowed.
- A request has a caller, audience, purpose, exact scope, and unique request ID.
  The local agent consumes the request ID after an allowed decision, rejecting
  replay. A durable nonce/replay registry is required before multi-process use.
- Revocation is deny-first and checked before any local plaintext, key, or
  secret operation. Devices and workspace grants are revoked as described by
  ADR 007; their capabilities must consequently fail closed.

## Sharing and authority boundaries

Workspace sharing means an explicitly enrolled device/user grant, not cloud
service authority. An account session authenticates a user but does not confer
device possession, project-key possession, or a capability. Each enrolled
device receives an opaque workspace-key envelope and must present the current
enrollment version (ADR 007).

The local execution interface may accept a capability only after local policy
evaluation. It may decrypt, use a secret through a broker, or return a
minimized result according to the exact action/resource. It must not return
root keys, durable credentials, unrestricted project exports, or accept
capabilities from tool output as new authority.

MCP tools may receive a capability for one operation. MCP requests must be
audience-bound (`mcp:<tool>`), purpose-bound, short-lived, device/account/
workspace-bound, and limited to the minimum result. The secret broker performs
secret-bearing work locally. MCP cannot issue, broaden, renew, or revoke
capabilities, and external AI output is always untrusted input.

## Threat cases and required controls

| Threat                                 | Control                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Misuse by a valid caller               | Exact subject, purpose, audience, and resource checks                                             |
| Replay                                 | Unique request IDs, consumed at the local decision point, plus durable replay state in production |
| Confused deputy                        | Audience binding and local-agent decision; tool output cannot grant authority                     |
| Scope escalation                       | Exact scope matching; delegation is opt-in and may only narrow scope and expiry                   |
| Stolen or revoked device               | ADR 007 enrollment version, revocation, and fail-closed offline behavior                          |
| Compromised cloud or MCP               | Opaque transport, no root keys, no plaintext authority, minimal result projection                 |
| Malicious local process while unlocked | Trusted-endpoint assumption, short-lived capabilities, minimized results, security events         |

Policy examples are executable in `capability-policy.spec.ts`: allow, deny,
expiry, revocation, replay, confused deputy, and scope escalation.

## Open decisions

1. Select the signed capability format, canonical encoding, algorithm, and key
   rotation protocol; the current format is provisional.
2. Define the user-consent UX and whether consent is per capability, purpose,
   tool, or bounded session; record the decision locally without plaintext export.
3. Define durable revocation and replay storage across processes and offline
   devices, including maximum offline validity and fail-closed behavior.
4. Define delegation approval, audit visibility, and whether any MCP class may
   ever be delegable; default remains no delegation.
5. Assign Phase 0 security owners and independent reviewers before production
   capability issuance or external-AI profiles.
