# ADR 005: Versioned Encrypted Envelope Contract

## Status

Proposed; algorithm and metadata decisions remain open.

## Decision

The local agent and future enrolled devices exchange protected records using the
`themis.encrypted-envelope` JSON contract at version `1`. The wire representation
is canonical JSON: object keys are sorted by their UTF-16 code units at every
depth, arrays retain order, and no insignificant whitespace is emitted. This is
an explicit code-unit comparison, not locale-aware collation, so case and
non-ASCII keys have the same order across runtimes. Consumers must reject a
non-canonical representation rather than assigning multiple byte representations
to the same authenticated object.

The envelope contains an opaque `ciphertext`, `nonce`, and `authTag`. This ADR
does not select an AEAD algorithm, nonce size, key hierarchy, or key storage
mechanism; those choices belong to ZK-004 and later vault work. The tag field is
required now so integrity verification cannot be accidentally omitted.

## Schema

Required fields are:

| Field                            | Meaning                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `format`                         | Fixed discriminator: `themis.encrypted-envelope`.                                        |
| `version`                        | Integer contract version; only `1` is currently supported.                               |
| `kind`                           | `local-record` for vault-only records or `sync-object` for opaque append-only transport. |
| `envelopeId`                     | Stable opaque identity for replay and deduplication.                                     |
| `workspaceId`                    | Tenant/workspace routing identity; never a plaintext project payload.                    |
| `recordType`                     | Stable consumer-selected type such as `project-context` or `activity`.                   |
| `revision`                       | Positive monotonic revision for one envelope identity.                                   |
| `createdAt`                      | UTC timestamp with millisecond precision.                                                |
| `associatedData`                 | Canonical authenticated metadata, supplied to the eventual AEAD operation.               |
| `metadata`                       | Routing metadata; only explicitly approved string fields may be populated.               |
| `nonce`, `ciphertext`, `authTag` | Unpadded base64url opaque values.                                                        |

The payload boundary is intentional: protected project context, activity
narratives, credentials, keys, and recovery material are inside `ciphertext`.
The orchestrator may route and retain the envelope but must not parse or decrypt
that field. `associatedData` and `metadata` are visible to the local serializer;
cloud visibility of individual fields is unresolved and must be approved by the
metadata decision in ADR 004. In particular, project names, device labels,
timestamps, sizes, and status must not become visible by convention.

## Local records versus sync objects

`local-record` is a vault representation and may remain device-local. A
`sync-object` is an append-only transport object: the cloud may store and relay
it, but it does not merge plaintext or overwrite a prior revision. Clients use
`envelopeId` and `revision` to reject duplicates and stale revisions. Conflict
resolution remains a local-agent responsibility.

## Errors and upgrades

Parsers expose stable error classes for `malformed`, `unsupported-version`,
`non-canonical`, `replay`, and `integrity-failure`. Malformed or unsupported
objects are rejected without attempting decryption. A replay is an already seen
or non-increasing revision for an envelope identity. Integrity failure is
observable after a future crypto verifier compares the authenticated tag; no
plaintext is returned on failure.

Unknown versions are not silently upgraded. A future version must define an
explicit migration/compatibility adapter and produce a new canonical envelope;
version 1 consumers remain read-only for version 1. No downgrade is permitted.

## Consequences and open decisions

This contract is consumable by the local vault, migration, sync, and product
visibility slices without making cloud services plaintext authority. ZK-004 must
select and prove the cryptographic primitive and key hierarchy. Phase 0 must
still approve exact cloud-visible metadata, padding/size policy, retention and
tombstones, device revocation effects, and the mediated product read architecture.
