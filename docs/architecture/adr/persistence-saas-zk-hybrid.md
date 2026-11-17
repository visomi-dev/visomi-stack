---
title: Persistence policies for SaaS, zero-knowledge and hybrid products
status: Provisional implementation
date: 2026-11-16
owners: Product owner and security reviewer
related: [VIS-65, VIS-66, VIS-67, VIS-68, VIS-69, VIS-70, VIS-71, VIS-72, VIS-73, VIS-74]
---

# Persistence policies for SaaS, zero-knowledge and hybrid products

## Status and approval boundary

Provisional implementation design for VIS-65. On 2026-11-16 the user and all ten
updated issues authorized autonomous branch implementation with reversible,
documented technical decisions. This supersedes the earlier implementation
approval gate. Dependencies establish integration order rather than requiring
an issue to be marked Done. Independent cryptographic review, product recovery
decisions and applicable privacy-text approval remain acceptance/release gates.
This ADR does not certify a protocol, accept production risk or authorize merge,
deployment, publication or live data/configuration changes.

The following technical decisions are provisional and reversible in this branch:

1. The per-domain policy, supported combinations, authorization boundary and
   reference inventory below, with `shared-persistence` as the neutral contract.
2. The proposed v1 cryptographic profile/context binding in the
   [protocol proposal](../contracts/persistence-v1.md). It adapts existing
   primitives, requires security review and is not an audited protocol.
3. Explicit PRF-backed web unlock initially, with no automatic password/PIN
   fallback. Each product chooses `none` or `user-held-recovery-key`; the user
   must confirm recovery enrollment. Cloud login/reset never unlocks a vault.
4. Delivery on the existing web runtime. Native implementations remain unavailable
   until separately implemented and tested. Independent security review and
   applicable privacy-text approval remain VIS-73/VIS-74 release gates even
   after implementation is authorized.

## Context and verified inventory

Baseline: `main` commit `6f4582a9a38d95b627f819198d79670692a2548a`.
Only visomi-stack may change. Historical repositories are read-only references.

| Area                     | Current implementation                                                                                                                                       | Reuse or adaptation                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Database                 | `libs/backend/shared/src/lib/database/database.ts`: injected Drizzle/pg pool, disabled query logger, explicit close; existing migrations                     | Reuse transactions and executable-owned resources; no import-time pool.                                                      |
| Identity                 | `apps/web/api/src/auth/shared/identity.ts`: verified principal, auth version and active methods; `schema-auth.ts` owns identity/session/challenge/grant data | Reuse auth; resolve memberships separately. Auth device approval is not ZK key-possession proof.                             |
| Browser sessions         | `apps/web/app/src/app/auth/session/browser-session.ts`: transitions, cancellation, logout and cross-tab refresh                                              | Observe identity changes, invalidate pending vault operations; no keys/plaintext in session snapshots or SSR transfer state. |
| Composition              | Separate API app/main exports; gateway imports compiled application                                                                                          | Add domain composition without changing executable resource ownership.                                                       |
| Persistence capabilities | No common tenant/group/resource ACL, reusable ZK vault/key hierarchy or opaque sync in baseline                                                              | Implemented provisionally in this branch; baseline auth alone did not satisfy these requirements.                            |
| Native clients           | File inventory found no Swift, Kotlin, Electron or Tauri implementation                                                                                      | Document future adapters; no native interoperability claim or implicit new apps.                                             |

Resolved versions checked include Angular 22.2.3, Astro 7.3.3, Express 5.3.0,
Zod 4.6.6, Nx 24.0.1 and Vitest 5.0.5. The manifest declares Drizzle 1.0 RC.5
and SimpleWebAuthn 14. Preserve installed versions; do not infer the installed
patch release from a manifest range.

Historical code and tests were compared, not executed in their source repos:

| Source                                                                                                                                                                                                                                                                                                             | Observed behavior                                                                                                                                                   | Adaptation/exclusions                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [v0 crypto README](https://github.com/visomi-dev/visomi-stack-v0/blob/main/libs/shared/crypto/README.md), blob `865b587d6d342e5891d8b2cd4e723773d4ff1072`                                                                                                                                                          | Neutral validation/serialization/sync; ECDSA/RSA device delivery; possession proof alone does not authorize or consume enrollment                                   | Preserve boundaries; no Themis imports.                                                                                                                                                             |
| [v0 envelope](https://github.com/visomi-dev/visomi-stack-v0/blob/main/libs/shared/crypto/src/lib/encrypted-envelope.ts), blob `e562863735e63fac753445b8c1eb173d16042e28`, and `encrypted-envelope.spec.ts`                                                                                                         | Canonical JSON/revision guard; no selected algorithm; integrity helper consumes an external boolean; fixtures permit nonce/tag lengths unsuitable for proposed AEAD | Add exact lengths, actual AEAD/context verification and durable scoped checkpoints. Do not port format validation as cryptographic proof or identifiers in errors.                                  |
| [v0 ADR 013](https://github.com/visomi-dev/visomi-stack-v0/blob/main/docs/architecture/adr/013-browser-webcrypto-indexeddb-vault.md), blob `88a1fdb6175de873703f74abefd4f1e76bbf80f4`                                                                                                                              | Ciphertext IndexedDB, injected unlock, PRF detection and explicitly enabled fallback                                                                                | Preserve unlock/storage separation; proposed initial port disables fallback pending separate approval.                                                                                              |
| [v0 browser vault](https://github.com/visomi-dev/visomi-stack-v0/blob/main/libs/frontend/shared/src/lib/crypto/browser-encrypted-vault.ts), blob `b6e855e7f10518cfc299a02db449f86b27c5090e`, and `browser-encrypted-vault.spec.ts`                                                                                 | AES-GCM workspace records/HKDF wrapping, reopen locked; transactions resolve on completion; tests use in-memory storage                                             | Adapt to tenant/group/resource and generation binding; prevent results after lock/account change; avoid extractable live DEKs; add real IndexedDB tests. Historical tests are not browser evidence. |
| [v0 key wrapping](https://github.com/visomi-dev/visomi-stack-v0/blob/main/libs/shared/crypto/src/lib/vault-key-envelope.ts), blob `a84b1e013b2d0fc917fea751da378868ab14adf6`, and `vault-key-envelope.spec.ts`                                                                                                     | PRF/HKDF/AES-GCM with canonical tuple binding; tests compare Node cipher/HKDF APIs                                                                                  | Adapt generic scopes. Historical comparisons have not been rerun here and are not Swift/Kotlin evidence.                                                                                            |
| [v0 enrollment](https://github.com/visomi-dev/visomi-stack-v0/blob/main/libs/shared/crypto/src/lib/vault-browser-enrollment.ts), blob `6443bdc60a0aa906f376becd161bb7208a23b91f`                                                                                                                                   | Proof binds owner/scope/challenge/expiry/both public keys; recipient-bound RSA-OAEP delivery                                                                        | Generalize scope; enforce approval, expiry, one-time consumption and current membership atomically; no cloud recovery authority.                                                                    |
| [v0 sync contract](https://github.com/visomi-dev/visomi-stack-v0/blob/main/docs/architecture/contracts/project-scoped-sync-v1.md), blob `71c5df4ea500c650bebd889f07e17ae6eddfb98a`                                                                                                                                 | Independent streams/cursors/revisions/checkpoints/tombstones, opaque cloud, client merge                                                                            | Preserve invariants without project/Themis kinds; independent encrypted units.                                                                                                                      |
| [Nive v6 README](https://github.com/visomi-dev/nive-archive-v6/blob/main/README.md), blob `9efe7d7f5c158870b9287f21ed4801a142a6437b`, and [encrypted state](https://github.com/visomi-dev/nive-archive-v6/blob/main/apps/web/api/src/families/encrypted-state.ts), blob `94ab4d0aacafbce3a321b7c52444b5a1ee01b59e` | Transactional membership/auth-version checks, expected revisions, rotation barriers, transaction-local context                                                      | Preserve isolation/concurrency principles. Do not port finance, ledger, expense reviews, family browser authority or monolithic snapshots as universal authorization.                               |
| [Nive v6 key access tests](https://github.com/visomi-dev/nive-archive-v6/blob/main/apps/web/api/src/families/key-access.spec.ts), blob `5f8a8b5c544897aaa834268ff43781b3cf0c73c9`                                                                                                                                  | Recipient isolation, concurrent rotation retries, stale-write rejection after membership change                                                                     | Adapt negative cases to current PostgreSQL harness; no Jest/PGlite dependency or cryptographic claim from placeholder ciphertext.                                                                   |

## Decision: independent policy dimensions

Every product fixes policy at creation, per business domain. Location specifies
where content persists; readers specify who processes it; authorization controls
who receives or mutates the representation. Device choice never changes policy.

| Location     | Server-authorized reader                                            | Client keys only                                                                  |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Local        | Unsupported v1: no approved server/local processing adapter         | Local ciphertext, explicit unlock, no cloud domain metadata/backups               |
| Cloud        | SaaS PostgreSQL; explicitly configured server capabilities          | Private cloud ciphertext, client decrypts on demand; offline replica not required |
| Synchronized | Unsupported v1: plaintext offline SaaS cache lifecycle not approved | Local ciphertext replica plus opaque cloud stream; client conflict resolution     |

SaaS means all application domains are server-readable; ZK means all application
domains use client-held keys; hybrid combines them. Identity, accounts, sessions
and approved operational metadata remain cloud-readable in every mode. Do not
advertise the entire service as hiding all information from the server.

The strict versioned Zod contract in `libs/shared/persistence/src/lib/policy.ts`
rejects unknown fields, duplicate domains, mode mismatch, record keys, server
processing on ZK, invalid quotas and incompatible tombstone/offline horizons.
Parsing grants no access and selects no runtime adapter. Consumers must use
parsed values; provisional consumers may integrate it in this branch.

Each domain declares classification, visible metadata, retention, quotas, reader
capabilities, authorization and recovery. `activeDays: null` means until explicit
deletion, not unlimited backups. Retention is product configuration, not verified
provider behavior. Synthetic fixtures use 1 MiB/unit, 64 MiB/scope, 10,000 units
and a 30-day offline/tombstone window; these are test inputs, not measured scale.

Opaque IDs, size, membership, timing, revisions and tombstones disclose patterns.
The metadata allowlist is for storage/transport, never automatic telemetry.
No arbitrary metadata, titles, filenames, customer IDs, credentials or plaintext
enter telemetry. SaaS server-readable content is protected by authorization;
TLS and storage encryption do not turn it into ZK.

## Authorization and key domains

VIS-66 adds deny-by-default membership and action rules for tenant/group/resource
and optional domain record predicates. Derive identity from verified auth; a
requested tenant ID selects a target, never proves membership. Resolve effective
role, membership and parentage from storage on every operation. CRUD, lists,
search, exports, jobs and objects share scoped predicates. If `domain-required`
record rules are missing, deny. Realtime must recheck on join and emission and
invalidate revoked subscriptions; connection authentication alone is insufficient.

Serialize membership changes and affected writes in database transactions,
rechecking identity and membership epochs. No persistent authorization cache
initially. Jobs re-resolve current authority. RLS is not adopted here: application
predicates and transaction tests are required, with no RLS claim. Adding RLS later
requires a non-bypass role, owner/FORCE RLS analysis and transaction-local pool
context tests; session-global `set_config` would be unsafe with pooling.

One random DEK belongs to a tenant, group or resource generation. No record DEKs
as the base design. A shared key grants cryptographic access to its whole domain;
finer record ACLs govern ciphertext delivery, not decryption of already obtained
data. Cryptographic separation requires separate resource key domains explicitly.

## Platform boundary and lifecycle

Common contracts contain no Angular, Node, WebCrypto, IndexedDB or native runtime
types. Crypto, custody, unlock, persistence and transport have runtime adapters.
Decrypt only needed units in memory; no whole-vault load or single-file mandate.
Non-extractable keys do not protect against malicious code invoking an unlocked
key. Managed-runtime cleanup is best effort, not guaranteed memory erasure.

| Runtime | Existing app        | New adapter at this step            | Actual verification                                                                              |
| ------- | ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web     | Angular app         | WebCrypto/IndexedDB/PRF implemented | Native Chromium PRF/storage and application E2E; physical devices/additional browsers unverified |
| SSR/API | Angular SSR/Express | No private-key unlock adapter       | Negative SSR/account tests and locked initial rendering verified                                 |
| Swift   | None inventoried    | Future native crypto/OS custody     | Not implemented or tested                                                                        |
| Kotlin  | None inventoried    | Future native crypto/OS custody     | Not implemented or tested                                                                        |
| Desktop | None inventoried    | Future runtime-specific adapter     | Not implemented or tested                                                                        |

Login and unlock are separate states. Lock, logout, account switch, revocation
and teardown invalidate in-flight operations before plaintext is returned or
written. Reopen starts locked. Cross-tab signals contain no secrets; loss of
coordination must fail clearly. States include locked, ready, unavailable,
corrupt, quota and recovery-required, with explicit cancellation/unsupported PRF
errors. SSR neither instantiates browser adapters nor receives private keys.

## Threat model

| Actor/failure                       | Required control                                                                  | Remaining limit                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| DB/object/backup reader             | ZK ciphertext and wrapped keys only; no usable server recovery secret             | Identity/metadata visible; server controls availability                                                                       |
| Malicious operator                  | AEAD context checks, recipient approval, retained client checkpoints, no fallback | Operator may replace served web code; first use or total checkpoint loss cannot prove freshness without an independent anchor |
| Malicious member                    | Current role/record predicates, recipient wraps, generation barriers              | Previously obtained plaintext/keys cannot be recalled; shared key exposes entire key domain                                   |
| Lost/revoked device                 | Deny API, invalidate grants, rotate remaining recipients, reject old writes       | Old keys still decrypt old ciphertext/offline copies                                                                          |
| Unlocked endpoint compromise        | Bounded plaintext lifetime, no persistent plaintext/telemetry, timely lock        | Malware/XSS can read plaintext or use unlocked keys                                                                           |
| Compromised origin/dependency       | Existing CSP, secure origin, dependency controls, no plaintext SSR/cache          | Mitigations cannot guarantee immunity to malicious served client code                                                         |
| Replay/rollback/restore             | Bound generation/revision/context, durable checkpoints and tombstone horizon      | Total rollback of all trusted state is undetectable without an independent anchor                                             |
| Total device/key loss               | Confirmed user-held recovery or acknowledged irreversible loss                    | Password reset restores identity only; support cannot decrypt                                                                 |
| Interrupted rotation/offline writes | Stage wraps/units, atomic generation commit, reject stale writes                  | Rotation cannot make already disclosed history secret again                                                                   |

## Alternatives and consequences

A single server-readable mode with optional browser encryption would silently
change confidentiality. One global vault couples loading/failure boundaries;
per-record base keys contradict the requested hierarchy. Copying Themis/Nive
couples the stack to product rules. Requiring identical TypeScript crypto in
native clients hides custody differences. Reject these alternatives.

The chosen design supports common auth, domain processing and independent
encrypted units. Costs include unavailable server search/AI/jobs on ZK content,
irreversible loss without recovery, client merges and device/generation state.
No silent escrow, generic plugin infrastructure, new dependency or new native
runtime is implied.

## Follow-up retention decision

Use explicit bounded owner-authorized maintenance, immutable time-bearing
operation IDs, and fail-closed expired history as specified in the
[retention contract](../contracts/persistence-retention.md). Automatic deletion
without a rollback fence and server-trusted snapshot bootstrap were rejected.
Minimal revision gravestones preserve deletion semantics; provider erasure and
scheduling are separate operations. A product requiring fresh-device bootstrap
after compaction needs an independently trusted complete-state recovery path.
This choice and its native/PostgreSQL tests are provisional implementation work,
not independent protocol acceptance.

## Delivery and release

Follow the [dependency review](../../reviews/persistence-milestone.md).
Mode/schema/envelope changes require explicit source/target versions, resumable
validation and confidentiality-preserving rollback. Never recover service by
turning ZK content server-readable. The branch now adds additive migrations and
opt-in persistence routes, verified only against isolated fixtures; no live
operation is authorized. Independent review, runtime evidence and approved product privacy text
remain release gates; build/merge alone cannot close VIS-73 or the milestone.
