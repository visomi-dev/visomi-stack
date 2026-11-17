# Product persistence integration

This is an implementation guide for the provisional VIS-65–74 branch. It is not
a production enablement checklist that has already been completed. Start with the
[ADR](architecture/adr/persistence-saas-zk-hybrid.md),
[server contract](architecture/contracts/persistence-server.md),
[crypto bytes](architecture/contracts/persistence-v1.md),
[device/sync contract](architecture/contracts/persistence-keys-sync.md), and
[current test evidence](reviews/persistence-milestone.md).

## Choose domains before composing a product

Use the strict `ProductPolicy` contract in `@visomi-stack/shared-persistence`.
Name business domains and classify their content. For each domain declare storage,
readers, authorization, retention, quotas, exposed metadata and server capabilities.
Identity remains a separate cloud-readable domain even in a ZK product.

| Content location | Server-authorized readers | Client keys only                                                          |
| ---------------- | ------------------------- | ------------------------------------------------------------------------- |
| Local            | Rejected by v1 policy     | Browser vault; no cloud adapter or cloud backup                           |
| Cloud            | Authorized SaaS records   | Policy can describe this; current server composition rejects this adapter |
| Synchronized     | Rejected by v1 policy     | Opaque v1 ciphertext stream plus independently unlocked client vault      |

SaaS means authorized application code can process stored content. Database disk
encryption or TLS alone does not make that content zero-knowledge. Hybrid means
different domains have different readers; it is not a global promise that every
field is hidden from the server. The synthetic example keeps operations readable
by the server and private resources decryptable only by client key holders.

Choose tenant, group or resource **key** scope according to sharing/lifecycle
requirements. A record is a transport/domain unit, not an independently created key
scope in this profile. Authorization can additionally restrict tenant, group,
resource and individual records; possessing a shared DEK never replaces current
cloud access checks. SaaS owner-only records stay owner-only even for tenant owners.
The current opaque adapter accepts explicit scope inheritance, and rejects
`domain-required` record rules until a product supplies an appropriate adapter.
Do not encode sensitive record conditions in readable metadata merely to bypass that
restriction.

## Compose supported adapters explicitly

`createApp({ auth, persistence: policy })` opts into the API. Authentication owns
database/realtime resources, initialized and closed by its executable. Import the
compiled application module when embedding it; never import its startup entrypoint.
The default application does not mount persistence routes.

`validatePersistenceComposition` rejects unsupported adapters and capabilities.
The current SaaS adapter implements bounded record CRUD, title search and paged
export. Server analytics, AI and jobs are not implemented and fail composition.
The opaque adapter rejects server search/AI/analytics/jobs and never decrypts for
compatibility. A missing client capability produces a functional block; it must
not switch the domain to server-readable storage.

The standalone API can enable the synthetic fixture with
`NODE_ENV=development VISOMI_PERSISTENCE_EXAMPLE=true`. The same switch in production
or without an explicit development/test environment rejects startup. No environment
variable is changed by this branch. Custom product manifests remain explicit
composition inputs; do not treat the synthetic recovery choice as a Nive decision.

The same explicit example profile is available to the compiled gateway. Its public
API capability version must match before composition. Open `/app/en/persistence`
or `/app/es/persistence` after signing into the isolated development stack. The
example creates a synthetic workspace and bookmarks its scope/object route; it
keeps cloud-readable operations and client-encrypted notes in separate domains.

Only current verified users may obtain `/persistence/policy`. Do not put customer
records, wrapped keys, plaintext, or persistence responses into SSR transfer caches.
The Angular application excludes persistence requests from transfer caching, and
`VaultSession` creates browser adapters only on explicit unlock. `VaultPanel` is a
consumer component with a supplied stable object context and separately provisioned
PRF credential; it does not select a reader mode for the user. Each panel owns its
own `VaultSession`, so simultaneous editors do not share a plaintext display or
implicitly inherit another editor's unlock. Changes to its binding, complete data
context or RP ID invalidate pending operations, clear drafts/revisions and require
explicit unlock again. An explicit lock retains the same object's local revision;
it never deletes stored ciphertext. Late saves cannot emit into a new context.

## Browser integration responsibilities

1. Establish the configured origin/RP and validate product/platform capabilities.
   Keep cloud authentication and local PRF unlock separate. Never upload PRF output
   in WebAuthn registration/authentication DTOs.
2. Supply an explicit wrapping context and owner matching the current session.
   Provision an empty vault only intentionally; a missing key in an existing scope
   requires device approval or configured recovery, not automatic reinitialization.
3. Use one independently lockable `BrowserVault` per key scope/generation, and
   decrypt only the requested unit. Clear temporary byte arrays and UI state on
   lock/account change/logout. Angular effects alone are insufficient for synchronous
   cancellation; operations must also check account/version/abort state after awaits.
4. Persist device private identity only through a separate device-local encrypted
   custody vault. Do not protect a signing private key with a shared resource DEK.
   Pin and verify the recipient identity before approving a delivery.
   After rotation, explicitly prepare and sign the retained historical-generation
   grants needed for a new recipient's replay. Verify the whole witness before
   `installHistory`; these local wrappers cannot allocate an old-generation write
   budget. See [enrollment after rotation](architecture/contracts/persistence-keys-sync.md#enrollment-after-rotation)
   for authority, binding, disclosure and expired-history limits.
5. Use `SyncReplica` with an `IndexedDbReplicaStorage` per account and target stream.
   Its authentication callback must verify contextual AEAD with the correct historical
   generation and clear transient plaintext before returning. Abort/stop replicas
   on lock/logout. Domain conflicts require explicit client rebase.
   Supply the independently known current `KeyDomain` and minimum roster epoch
   when constructing a new replica, rather than treating a fresh cursor-zero store
   as permission to accept pre-approval server control state.
6. Keep the encrypted outbox on failed writes. Never delete it just because an HTTP
   request returned success. Use the explicit conflict-resolution port only after
   the user/domain has chosen a rebase or discard; do not rewrite an old operation
   ID or silently retry with different plaintext. The storage adapter requires exact authenticated history
   before acknowledging its removal.

The sample adapters expose platform-neutral ports, strict envelopes and public
vectors. Swift, Kotlin and desktop clients must implement their own secure custody,
crypto, network and storage adapters, run those vectors, and test lifecycle/rollback
behavior on actual supported runtimes. No native application currently exists in
this repository; none is claimed compatible because TypeScript tests pass.

## Angular routes and browser databases

`PersistenceExample` binds to the live `ActivatedRoute.paramMap`, including Router
reuse and browser history. Each `NavigationStart` synchronously aborts HTTP work,
stops/closes the replica and device custody, locks the vault, and clears cloud
revisions, plaintext and unfinished UI drafts. End/cancel/error reloads the current
route under a fresh context. Query-only or canceled navigation also locks; the user
must explicitly unlock again. This conservative behavior is a reversible technical
choice. Encrypted pending changes and trusted checkpoints remain in IndexedDB.

Every asynchronous continuation captures its context and checks it after awaits.
Late reads, writes, errors and `finally` handlers cannot update another route's
models, notices or busy state. The private service additionally requires the exact
unlocked tenant/scope/object and checks context before encryption/signing/enqueue.
Cancellation cannot undo a server mutation or local transaction already committed
for A; it prevents a follow-up action or publication of A state into B. It never
retargets a dispatched request or deletes a pending encrypted change.

`PersistenceDatabase` is an Angular `@Service()` facade with a browser-only lazy
module, current account/version checks and cancellation checks before returning a
connection. Creating the service does not open IndexedDB or unlock keys. Consumers
own and close their connections; late opens are closed if their context, account or
injector was invalidated. `VaultSession` owns key-custody connections, and the scoped
private-resource service owns replica connections. The reference pattern is the
[legacy Nive database facade](https://github.com/visomi-dev/nive-archive-latest/blob/main/apps/legacy-ng-webapp/src/app/shared/db/index.ts),
read only. Its product entities, plaintext tables and raw exception logging are not
ported into this stack.

The web SDK uses typed Dexie tables and committed transactions. Optimistic caching
and automatic reopening are disabled. It preserves the existing account-specific
`visomi-vault:` and `visomi-sync:` names, native version **1**, key paths and stored
formats. A minimal native initializer creates only an absent database; Dexie opens
it in dynamic mode after format validation, avoiding automatic schema patching or
newer-version fallback. Unknown versions/schemas fail closed without patching,
resetting or deleting contents. Version-change handlers close connections and
suppress default logging of account-bearing database names. No browser migration
or database deletion is performed by this change.

Only envelopes, wrapped keys, pins, encrypted outboxes and allowlisted protocol
metadata enter those tables. Key reservation, CAS writes, backup restore and
pin/unit/outbox updates remain atomic. Crypto, network operations, plaintext and UI
drafts stay outside database transactions and tables. Dexie does not supply
cryptography or change the origin/compromised-client threat model. Future schema
changes require explicit reviewed migrations; do not increase a version or clear
an outbox to work around a storage error.

## Explicit migration and disclosure

Tenant policy hashes reject silent changes. A changed reader, recovery actor,
retention regime, authorization rule, key scope or capability requires an explicit
migration design: source/target manifests and versions, user-visible consequences,
required client capability, bounded batches, interrupted-run recovery, integrity
checks, authority/revocation barriers and a rollback plan. Test against an isolated
copy. Do not rewrite a live manifest/hash or convert existing ciphertext to server
plaintext automatically.

Envelope/schema changes must negotiate versions, preserve old decode support only
where explicitly reviewed, and publish new cross-runtime vectors. Unknown versions
are rejected; the server cannot bridge them by decrypting.

There is no implicit consent for a third party or AI processor to see ZK plaintext.
The current adapters provide no such disclosure endpoint. A future product flow must
name the recipient, exact selected content, purpose, retention and consequences,
require an explicit user action, and preserve a cancellation path before disclosure.
Enabling a server AI flag or using a hybrid product is not that consent.

## Operations and release limits

Schema migrations are additive generated artifacts. They were applied only to
isolated synthetic test databases. The explicit owner-only [retention adapter](architecture/contracts/persistence-retention.md)
implements bounded SaaS purge, receipt/challenge expiry and opaque prefix
compaction with checkpoint floors and revision gravestones. No scheduler or live
invocation is enabled. Provider backups/erasure, a trusted expired-history recovery
path where needed, an enforceable global multi-device encryption budget, monitoring
capture policy and independent crypto review remain explicit release work. A retention number in a manifest does not implement a provider's
backup deletion. Backups of SaaS domains contain readable content; backups of ZK
domains contain ciphertext plus readable metadata.

Read the branch evidence before enabling anything. No merge, deployment, publication,
live migration or product-specific recovery actor was authorized by this work.

Recovery of a data key does not itself grant cloud device-administration authority.
If every authorized signing identity is lost, a surviving independently encrypted
custody backup or a product-defined, reviewed recovery authority is required. The
current synthetic profile chooses neither implicitly. Do not promise full cloud
write/enrollment recovery from a resource recovery wrapper alone.
