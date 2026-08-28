# ADR 015: Production zero-knowledge control boundaries

## Decision

The local agent remains the plaintext authority. Capability issuer public keys
are maintained in a durable registry with explicit key IDs, rotation, and
compromise revocation; private signing keys stay in local-agent custody and
are never persisted by the shared library. A configured `CapabilityPolicy`
must resolve a capability's issuer key from that registry rather than trust a
transport-supplied key.

Visibility responses are accepted only after the origin, session binding,
fresh nonce, signature, replay claim, and (when configured) enrolled device
identity all match. Protected projections continue to fail closed at the MCP
and execution boundaries.

Vault nonces are recorded in a unique local table and validated at read time.
Diagnostics expose only a stable error class, correlation ID, and bounded
redacted message; protected values, credentials, challenges, and keys are not
forwarded.

## Operations

Provisioning and rotation are local-agent release operations. The durable
registry is backed by the agent's encrypted store, and compromise response
revokes the affected key ID before issuing a replacement. No cloud service or
external AI provider receives issuer private keys or protected plaintext.
