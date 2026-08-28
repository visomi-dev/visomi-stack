# ADR 012: Dual-Client Capability and Mode Negotiation

## Status

Proposed; the HTTP discovery/negotiation boundary is implemented for
authenticated web sessions. Durable cross-process claim storage and local-agent
signature verification remain follow-up work for the device/bridge slices.

## Decision

The web product has two client profiles: `web-local-agent` can use a local
agent bridge and may safely fall back to WebCrypto, while `web-webcrypto` is
WebCrypto-only. Both profiles use the same version-1 encrypted-envelope and
opaque-storage contract. A profile does not change the envelope format or make
the cloud a plaintext authority.

Mode negotiation is a versioned request/response exchange. A request names one
client identity, profile, supported modes and versions, requested capabilities,
preferred mode, and whether downgrade is allowed. The claim must match the
identity and profile and be authenticated by the enclosing web session or
local-agent signature boundary. Ambiguous identity, expired/unverifiable
claims, unsupported versions, and unsupported capabilities fail closed.

WebCrypto downgrade is allowed only when explicitly requested and only for
capabilities supported by WebCrypto. `bridge` and `recovery` are local-agent
capabilities and cannot be silently downgraded. Capability claims authorize
metadata and operations; they never authorize a cloud service to decrypt
plaintext, return root keys, or broaden scope.

## Capability and state matrix

| Capability                       | Local agent | WebCrypto |
| -------------------------------- | ----------- | --------- |
| vault access, unlock, projection | yes         | yes       |
| sync, offline                    | yes         | yes       |
| bridge, recovery                 | yes         | no        |

Implementers expose `locked`, `unavailable`, `revoked`, `offline`,
`incompatible-version`, and `recovery-required` as distinct fail-closed
states. Errors are stable codes and must not disclose ciphertext, keys, or
protected project content.

## Compatibility and storage rules

`local-record` remains device-local; `sync-object` is append-only opaque
transport. Both clients validate and serialize the same canonical version-1
envelope, preserve envelope identity/revision/associated data/metadata, and
perform conflict decisions locally. A future envelope version requires an
explicit adapter and a new canonical envelope; no downgrade is permitted.

The authenticated API exposes `GET /capabilities/{workspaceId}` for profile
discovery and `POST /capabilities/{workspaceId}` for negotiation. Workspace
authorization is checked before either operation. Negotiation accepts the
authenticated `web-session` claim form, requires claim scope to match the
session and workspace, consumes claim/request identifiers once, and returns
only the selected mode and granted capability names. Local-agent signature
verification and durable replay storage are intentionally deferred to the
device/bridge slices; the HTTP boundary fails closed rather than accepting an
unverifiable signature.
