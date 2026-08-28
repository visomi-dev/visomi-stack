# ADR 009: Execution Trust Profiles and Local Execution Policy

## Status

Proposed; sandbox technology, consent UX, and durable policy state require security review.

## Decision

The local agent evaluates execution requests before filesystem, network, secret-broker, or external-AI operations. A request must carry the exact scoped capability defined by ADR 008; cloud responses, MCP tool output, and external-AI output never create authority.

The executable policy in `libs/shared/src/lib/crypto/execution-policy.ts` is a fail-closed policy seam and fixture set. It is not a sandbox runtime, provider integration, or cryptographic capability implementation.

### Trust profiles

| Profile                       | Filesystem and commands                   | Network                 | Secret access                   | External AI                                                                            |
| ----------------------------- | ----------------------------------------- | ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `local-only`                  | Only approved local root, with capability | Explicit allowlist only | Broker-mediated capability only | Denied                                                                                 |
| `external-redacted`           | Same local boundary                       | Explicit allowlist only | Broker-mediated capability only | Public/internal projection, explicit consent, no protected plaintext or secrets        |
| `external-plaintext-approved` | Same local boundary                       | Explicit allowlist only | Broker-mediated capability only | Protected plaintext only when separately approved and consented; secrets remain denied |

Every decision produces a metadata-only audit event at the local policy boundary. The
minimum fields are `eventId`, `occurredAt`, `requestId`, `actorId`, `deviceId`,
`workspaceId`, `profile`, `state`, `action`, `dataClass`, `decision`, `reason`,
`capabilityId` (when present), the capability scope identifiers, a normalized
root-relative resource or allowlisted host, and the policy version. External-AI
decisions additionally record `provider`, `audience`, `consentId`, and the
redaction/minimization rule identifier. Missing values are recorded as `null`, not
inferred from free-form input. Audit events never contain command lines, file
contents, secret values, tokens, ciphertext, prompts, or provider responses.

The policy-level logging contract is:

| Profile                       | Redaction before audit/transport                                                                                                                                            | Retention                                                                                                                                                                             | Access boundary                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-only`                  | Keep action and normalized resource metadata; hash or omit command arguments and payloads.                                                                                  | Decision metadata: 30 days; security audit events: 365 days; no payload retention.                                                                                                    | Local agent policy/audit component and explicitly authorized security reviewers; cloud receives no event by default.                                                  |
| `external-redacted`           | Record the rule ID and approved field names/counts only; redact protected plaintext, secrets, prompts, and provider output before transport.                                | Decision metadata: 30 days; consent/security audit events: 365 days; approved projection retention follows the separately approved provider term and is never assumed by this policy. | Local agent and the consenting user/security reviewer; provider receives only the approved projection; cloud receives opaque audit metadata only.                     |
| `external-plaintext-approved` | Record approval and field hashes/names, never plaintext or secrets; plaintext may exist only in the explicitly approved provider request and is not copied into local logs. | Decision metadata: 30 days; approval/security audit events: 365 days; provider retention must be contractually bounded before the profile is enabled.                                 | Local agent, approving security owner, and consenting user; provider access is limited to the approved request; cloud and general executors have no plaintext access. |

These are logging and retention expectations for the policy seam, not a durable
logging runtime. A later runtime must enforce the access and deletion boundaries,
propagate consent/revocation, and fail closed if it cannot apply the contract.

### Runtime states

- **Ready** permits policy-allowed operations.
- **Locked** denies every operation except consented recovery.
- **Offline** denies network and external-AI operations; local operations remain bounded by capabilities.
- **Degraded** denies network, secret, and external-AI operations until the dependency health issue is resolved.
- **Revoked** denies all ordinary execution and fails closed immediately.
- **Recovery** permits only the recovery action with explicit consent.

Filesystem paths must be normalized/resolved before containment is checked and must
remain below the configured workspace root; traversal such as
`/workspace/../etc/passwd` is rejected. Network hosts must be explicitly allowlisted.
Secret operations require the local secret broker and an exact `use-secret`
capability; no secret value, root key, or durable credential is returned to an
executor or external AI.

## External-AI trust boundary and consent

External AI is an untrusted processor outside the local root of trust. The default profile sends no protected plaintext. A request records the profile, data class, purpose through its capability, provider/audience, and explicit user consent. Redaction and minimization happen before transport. Provider output is untrusted input and cannot authorize another operation, alter protected state, or broaden a capability.

## Open decisions

1. Select the sandbox mechanism and define whether filesystem/network enforcement is OS-level, container-level, or a local-agent broker responsibility.
2. Define the consent experience, including whether approval is per request, purpose, provider, or bounded session, and how revocation propagates offline.
3. Define durable capability replay/revocation storage and the maximum offline validity window.
4. Approve external providers and retention terms; `external-plaintext-approved` remains unavailable until a security owner signs off.
5. Define recovery authentication and whether recovery requires a device quorum.

## Consequences

The policy makes authority explicit and testable while leaving runtime sandboxing and provider integration for later work. It may deny useful operations during offline or degraded states, intentionally prioritizing least privilege and recoverable consent over implicit agent authority.
