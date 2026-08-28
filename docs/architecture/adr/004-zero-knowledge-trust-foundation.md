# ADR 004: Phase 0 Zero-Knowledge Trust Model and Data Classification

## Status

Proposed for Phase 0 sign-off

## Decision summary

`themis-agent` is the local root of trust. Cloud services may authenticate callers, store and route ciphertext, enforce tenant and capability metadata, and deliver opaque events, but they are not authorized to interpret project plaintext. The product app is a ciphertext consumer through an approved local-agent-mediated read path; it is not an independent plaintext authority.

This document constrains later vault, sync, product visibility, capability, and release work. It does not define production cryptography.

## Scope and terms

- **Local agent**: `themis-agent`, running on a user's trusted device and holding the keys needed to unlock that device's authorized data.
- **Cloud orchestrator**: Themis API, database, worker, realtime, and gateway runtimes. These components coordinate opaque records and authenticated operations.
- **Product app**: the Angular application. It may display data only after an authorized local read or an explicitly approved future read architecture.
- **External AI**: any model, provider, hosted tool, or MCP-connected service outside the local trust domain.
- **Plaintext authority**: the ability to decrypt, interpret, or authorize access to protected project content. Possessing ciphertext or metadata alone is not plaintext authority.

## Trust model

### Authority hierarchy

1. The local agent owns the device root and the project data keys it can unlock.
2. A user-approved device enrollment grants a device a scoped ability to use or unwrap selected project keys.
3. The cloud orchestrator authenticates accounts and transports opaque envelopes. It must not receive a decryption key that makes project plaintext recoverable by cloud operators or ordinary cloud code.
4. The product app receives only the minimum plaintext required for a user-visible operation, through a path that preserves the local agent's authorization decision.
5. MCP tools and secret brokers receive narrowly scoped capabilities, not the user's root key or an unrestricted project export.
6. External AI receives only an explicitly approved projection. It is an untrusted processor by default and must never be treated as an authority for secrets, keys, or irreversible authorization.

### Boundary assumptions

The model assumes that the cloud database, API process, worker process, realtime process, gateway, logs, backups, and cloud administrators may be compromised. A cloud compromise may expose ciphertext, routing metadata, account metadata, and operational telemetry within the declared visibility limits, but must not expose protected project plaintext or the keys required to decrypt it.

The model does not protect a device that is already unlocked and controlled by malware, a user who intentionally shares a plaintext export, or an external AI that receives plaintext under an approved capability. Those are explicit endpoint and delegation risks, not reasons to grant the cloud broader authority.

## Data classification matrix

The following is the Phase 0 inventory for current and planned flows. “Allowed readers” describes the intended reader, not every process that can currently reach the value. “Custody” names the system that may retain the value.

| Data class            | Current or planned examples                                                                        | Plaintext authority                                                                                 | Allowed readers                                                                                   | Custody and transport                                                                                   | Retention                                                                                              | Recovery responsibility                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Project context       | project summary, architecture, commands, environment notes, decisions, documents                   | Local agent only in target state                                                                    | Authorized user and local execution agent; product app only through an approved mediated read     | Encrypted project envelope in cloud; plaintext in local vault while unlocked                            | Versioned locally; cloud ciphertext retained per account policy                                        | User-approved device/recovery process; cloud can restore ciphertext only             |
| Activity and progress | agent updates, run state, progress, evidence, job results, review notes                            | Local agent for sensitive narrative; cloud may hold approved opaque event fields                    | Authorized user, verifier, reviewer, and local agent; product app receives an approved projection | Sensitive event payloads encrypted; minimal routing/status metadata may remain cloud-readable           | Append-only locally; cloud retention and compaction are open decisions                                 | Local agent restores event history; cloud restores opaque envelopes                  |
| Credentials           | provider tokens, passwords, API keys, MCP credentials, secret-broker values                        | Local agent or dedicated secret broker; never cloud application code                                | Only the capability holder for the specific operation; external AI only via broker-mediated use   | Local encrypted vault; broker may receive a short-lived operation request, not durable secret material  | Until explicit revocation/expiry; no plaintext backups                                                 | User and provider rotation/revocation; recovery must not silently export secrets     |
| Keys                  | device root, project keys, envelope keys, recovery shares, device enrollment keys                  | Local agent and explicitly enrolled device security boundary                                        | Key owner and authorized enrolled device; no product, API, worker, or external AI reader          | Hardware-backed or OS-protected local storage where available; wrapped keys may be synced as ciphertext | Until revocation, rotation, or project destruction                                                     | Explicit recovery actors and quorum remain open decisions; loss may be unrecoverable |
| Envelopes             | encrypted context, activity, credential, and key-wrapping records                                  | No cloud plaintext authority; local agent decrypts                                                  | Local agent and enrolled devices with the required capability                                     | Cloud database/object storage, API, worker, realtime, and backup systems as opaque bytes                | Policy-controlled; version and tombstone retention are open decisions                                  | Cloud restores bytes; local agent validates and decrypts                             |
| Metadata              | account/project IDs, envelope IDs, versions, timestamps, sizes, status, device IDs, routing labels | Cloud-readable within declared tenant boundary                                                      | Cloud services and authorized product users according to metadata policy                          | Database, queue, realtime channels, indexes, and logs                                                   | Operational retention required for routing/audit; exact minimization and visibility are open decisions | Cloud backups and account administrators, subject to tenant isolation                |
| Telemetry             | command outcome, latency, error class, queue progress, security events, diagnostic traces          | Cloud may read minimized operational telemetry; content-bearing fields remain encrypted or redacted | Operators and authorized account users according to telemetry policy                              | Structured logs/metrics/traces; never include secrets or protected content                              | Short operational window by default; exact duration and redaction policy are open decisions            | Operators recover service diagnostics; users recover project state locally           |
| Recovery data         | encrypted backups, recovery shares, revocation records, device enrollment history                  | Recovery authority may unwrap only under an explicit approved protocol                              | User-selected recovery actors and local agent; cloud stores opaque shares and revocation metadata | Encrypted backup/object storage and separate recovery channels                                          | Until rotation, project deletion, or policy expiry                                                     | Named recovery actors; the responsible actor set is an open decision                 |

### Reader and custody rules

- A value is not safe merely because it is in a private database. Protected content must be encrypted before it crosses the local-agent boundary.
- Cloud-readable metadata must be minimized, tenant-scoped, and documented separately from project content.
- Logs, queue payloads, job results, realtime events, error messages, and backups are data stores and inherit the classification of the values they carry.
- Secret material must never be placed in project context, activity narratives, telemetry, queue input, or ordinary API responses.
- A product read is valid only when the local agent (or a later explicitly approved equivalent) supplies the plaintext and the user/capability check is visible in the architecture.

## Runtime and integration boundaries

### Local agent

The agent owns vault unlock, key use, local plaintext reads/writes, capability evaluation, and encryption/decryption. It may call the cloud orchestrator to synchronize envelopes and metadata. It must not treat a successful cloud response as proof that the caller may read plaintext.

### Cloud API, worker, realtime, and gateway

These runtimes authenticate the account/device, apply tenant and capability metadata checks, persist or route envelopes, and expose health and operational state. Workers process opaque envelopes unless a future contract explicitly proves a local-agent-mediated operation. Realtime transports opaque events or approved metadata, not unclassified project content.

### Product app

The current Angular product reads server-backed project context and activity through API routes. That is a migration risk because the server is currently a plaintext authority. The target state is a product read mediated by an authorized local agent, with a narrowly defined projection and no fallback that restores ordinary server-readable context as the permanent architecture.

### MCP and secret broker

MCP is an integration boundary, not a trust upgrade. MCP requests must carry a scoped capability, account/project/device binding, purpose, and expiry. A secret broker should perform the secret-bearing operation locally and return only the minimum result. The broker must not return root keys, durable credentials, or unrestricted project exports to MCP clients.

### External AI

External AI is outside the trusted computing base by default. The local agent must select and record an explicit trust profile before sending any data. The default profile permits no protected plaintext. Approved profiles may send a minimized, user-authorized projection and must define purpose, fields, retention assumptions, provider, and revocation behavior. External AI output is untrusted input and cannot grant capabilities or alter protected state without local validation and user/policy authorization.

## Threat actors and compromise assumptions

| Actor                                  | Assumption                                                                                | Required protection                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Compromised cloud service or database  | Can read database rows, queues, backups, logs, and network traffic visible to the service | Project content, credentials, and keys remain encrypted; metadata exposure is minimized and declared                    |
| Malicious or curious cloud operator    | Can inspect operational systems and issue privileged support queries                      | No operator path yields project plaintext or root keys; audit and separation of duties apply                            |
| Compromised product session            | Can invoke APIs as a user within its session                                              | Tenant, device, capability, and purpose checks remain required; API responses do not become unrestricted exports        |
| Malicious MCP client or tool           | Can present a valid integration connection and attempt scope escalation                   | Short-lived capabilities, audience binding, least privilege, local approval, and broker isolation                       |
| Compromised external AI/provider       | Retains or inspects submitted prompts and outputs                                         | Default deny; explicit projections, redaction, provider policy, and no secret/key authority                             |
| Lost or stolen device                  | Can access local files but not necessarily the unlocked vault                             | OS/hardware protection, lock state, device revocation, encrypted vault, and recovery protocol                           |
| Malicious local process while unlocked | Can potentially observe plaintext or invoke local interfaces                              | Treat unlocked device as trusted endpoint boundary; minimize exposure, require capabilities, and record security events |
| Malicious tenant member                | Has legitimate account access but attempts cross-project or cross-tenant reads            | Account/project binding, row-level isolation, capability checks, and encrypted project keys                             |

## Migration risks from the starter implementation

1. `project_context`-style content and project documents are currently stored as server-readable text and returned by server API routes. This is explicitly not the target state.
2. Async job input/results and progress are currently server-readable operational records. They can contain context-bearing or diagnostic text and must be classified before encryption migration.
3. Realtime events and logs can replicate job or project content beyond the primary database. Payload and redaction contracts must cover these paths, not only tables.
4. API keys are currently represented by a server-side hash and one-time reveal flow, which protects the stored token but does not by itself establish a local-agent root of trust or scoped secret-broker use.
5. Existing account/session authorization proves web identity and tenant membership, not device possession, project-key possession, or permission to decrypt a particular envelope.
6. Existing product and MCP flows assume server-readable context. During migration, compatibility reads must be isolated, time-bounded, observable, and prohibited from becoming a new dependency.
7. Database backups, test fixtures, e2e setup, error responses, and development defaults may preserve plaintext even after the primary write path is encrypted. The migration must inventory and scrub each secondary path.

## Open decisions

These decisions are intentionally unresolved and require explicit approval; no implementation may silently choose them:

1. **Metadata visibility**: which IDs, timestamps, sizes, versions, project names, device labels, and status values may remain cloud-readable, and which require padding or encryption?
2. **Recovery actors**: is recovery controlled by the user alone, a device quorum, organization administrators, designated recovery contacts, or a combination? What happens when all devices are lost?
3. **Product read architecture**: local browser agent, local daemon/IPC, encrypted client-side key custody, or another mediated design? Define offline behavior and browser compromise assumptions.
4. **Device enrollment and revocation**: how are new devices approved, how quickly does revocation take effect offline, and how are stale envelopes invalidated?
5. **Activity privacy**: which progress fields are safe to expose as cloud-readable metadata and which narratives/evidence require encryption?
6. **External-AI profiles**: which providers and retention terms are acceptable, who approves a profile, and how is user consent recorded and revoked?
7. **Retention and deletion**: how long do envelopes, tombstones, logs, telemetry, and recovery material remain, and what does cryptographic deletion guarantee?
8. **Key hierarchy and rotation**: project, device, envelope, and recovery-key relationships; rotation triggers; and behavior for historical versions.
9. **Cloud search and indexing**: whether product search operates on encrypted local projections, blind indexes, or an explicitly reduced metadata subset.
10. **Phase 0 acceptance authority**: which human security/product owners sign off the model before production cryptography work starts?

## Phase 0 acceptance and verification

Phase 0 is accepted only when:

- the trust hierarchy and threat actors have an independent peer review;
- every current and planned context/activity path is mapped to the classification matrix;
- API, worker, realtime, gateway, product, MCP, broker, and external-AI boundaries have named owners;
- the eight data classes (context, activity, credentials, keys, envelopes, metadata, telemetry, and recovery) have approved readers, custody, retention, and recovery responsibility;
- the server-readable context/activity implementation is recorded as migration risk and has an agreed replacement direction;
- every open decision above has an owner, due date, and explicit accepted/deferred outcome;
- no Phase 1 cryptography or migration implementation proceeds on an assumption that this record leaves open.

## Consequences

This decision increases implementation complexity: encryption boundaries, device enrollment, local reads, capability checks, migration compatibility, and operational redaction must be designed together. It also makes the security claim testable: cloud systems can be inspected as ciphertext orchestrators, while the local agent remains the only default plaintext authority. Later ADRs must refine this model without weakening the authority hierarchy or silently promoting cloud-readable starter fields into target-state content.
