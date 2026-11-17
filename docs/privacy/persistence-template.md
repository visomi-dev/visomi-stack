# Persistence privacy and onboarding copy — unpublished draft

This reusable draft must be adapted to the actual product configuration and
reviewed for security accuracy and applicable product/legal requirements before
publication. It is not a certification or a published notice. Replace every
`[PRODUCT_CONFIGURATION_REQUIRED: …]` field. Do not copy claims for unimplemented
features. See the [integration guide](../persistence.md) and
[executed evidence](../reviews/persistence-milestone.md).

## Product notice base

**Who operates the product.** [PRODUCT_CONFIGURATION_REQUIRED: controller/operator
name, contact, jurisdiction-specific notice and user request channels].

**Account and operational data.** We process account identity and authentication
data on our servers. [PRODUCT_CONFIGURATION_REQUIRED: enumerate each server-readable
business domain and fields, purposes, authorized roles, processors and locations].
Authorized application services can read and process those domains. Transport or
storage encryption does not prevent those authorized services from reading them.

**Client-encrypted content.** [PRODUCT_CONFIGURATION_REQUIRED: name the domains and
key/sharing scopes actually delivered]. These domains are encrypted on a supported
client before cloud synchronization. The synchronization service stores ciphertext
and does not hold the client decryption keys. Signing in authenticates your cloud
session; it does not by itself unlock that content.

**Visible metadata.** Client encryption does not hide all metadata. The configured
service can see account membership and permissions, tenant/group/resource identifiers
used by the product, object/device/recipient identifiers, public device keys,
generations/revisions/schema versions, encrypted sizes, checkpoints, enrollment challenge/operation identifiers,
authorization epochs, unit kinds, tombstone
markers and operational timestamps where declared by the actual adapter. Authentication
identity remains server-readable. [PRODUCT_CONFIGURATION_REQUIRED: the final exact
metadata inventory; do not imply identifiers are anonymous or add arbitrary logging].

**Local storage.** The browser vault stores encrypted units and wrapped keys in
IndexedDB. Supported content is decrypted in memory when needed by the current view
or operation. Locking, signing out, or changing accounts removes accessible key and
plaintext references and clears temporary byte copies where possible. Managed
runtimes do not guarantee perfect memory erasure. Browser storage eviction can
remove local copies or keys.

**Sharing and devices.** Access requires current product permissions and an
appropriate client key. Device enrollment into an existing scope requires possession
proof and explicit approval by an authorized device. Revocation blocks future cloud
authority and triggers rotation. It cannot erase plaintext, old ciphertext or keys
already copied by an authorized or compromised device. Historical data and new
generations must follow the product's documented policy.

**Recovery.** [PRODUCT_CONFIGURATION_REQUIRED: explicitly select the product and
user recovery policy, eligible actors, custody and consent]. If the product provides
no recovery method and all usable client keys are lost, access to encrypted content
can be permanently lost. Password reset/account recovery is separate from encrypted
content recovery. The service must not present a password reset as recovering keys
it does not possess. A supported user-held recovery secret must be stored by the
user according to the product's reviewed instructions; it is not silent server custody.

**Retention, deletion, backup and export.** [PRODUCT_CONFIGURATION_REQUIRED: active
retention, access filtering, physical deletion, encrypted export, SaaS export,
tombstone/offline windows, backup expiry, restore access, provider responsibilities,
and evidence of the scheduled operations]. These are different operations.
Deleting a current record does not by itself erase every backup or a recipient's
copy. The provisional stack scrubs deleted SaaS record content, retains tombstone/
revision metadata, filters expired active SaaS content, and retains bounded opaque
history under quota. It does not yet run provider backup expiry or automatic physical
purge/history compaction. Do not advertise those operations as implemented.

**Processors and transfers.** [PRODUCT_CONFIGURATION_REQUIRED: actual database,
storage, backup, hosting, email/authentication and optional service providers,
locations, purposes and contractual details]. The initial opaque adapter uses private
PostgreSQL, with no public object bucket or download URL. This implementation choice
does not identify a production hosting provider or establish their retention policy.

**Third parties and AI.** Hybrid mode does not grant a third party or AI service
access to client-encrypted content. The current adapters do not provide a plaintext
disclosure endpoint. Any future disclosure flow must explain the selected content,
named recipient, purpose and retention before the user intentionally shares it.
Do not infer this permission from cloud login or a product's general reader mode.

**Security limits.** A compromised device, an unlocked browser session, malicious
extensions, or compromised code served by the application can access plaintext and
keys during use. Client encryption does not protect against every endpoint or supply
chain attack. Surviving trusted client checkpoints can detect rollback relative to
that state; loss of all trusted client state removes that comparison. Native-client
support must be stated only for tested adapters and devices. Independent protocol
review and actual platform interoperability remain release gates for this branch.

## Reusable onboarding and recovery text

| Configured mode/state  | Draft user-facing text                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SaaS                   | “Your content is stored by the service. Authorized services and people with the appropriate product permissions can access it.”                                                                        |
| ZK domain              | “This private content is encrypted on your device before synchronization. Sign in to access permitted cloud metadata, then unlock separately to read it.”                                              |
| Hybrid                 | “Your account and [named operational domains] are readable by the service. [Named private domains] are encrypted for client key holders. Different parts of this product have different access rules.” |
| PRF unavailable        | “This credential or browser does not support the required private unlock. Use a supported device. The server cannot unlock this resource.”                                                             |
| Missing local key      | “This device has no usable wrapped key. Use the product's explicit device approval or recovery flow.”                                                                                                  |
| No recovery configured | “If you lose every usable key and device, access to this encrypted content can be permanently lost. Resetting your password will not recover it.”                                                      |
| Revocation             | “This device will lose future cloud access. Previously copied content and keys cannot be recalled. New encrypted changes require rotation.”                                                            |
| Offline/conflict       | “Your pending change stays encrypted on this device. Synchronize when available. A conflict requires your decision; the server cannot merge private content.”                                          |
| Encrypted export       | “Keep this encrypted copy and the required unlock/recovery method separately. A ciphertext backup without a usable key cannot restore access.”                                                         |

These are draft strings, not authorization to activate an unimplemented recovery,
export, disclosure or retention feature. Product copy must match the final shipped
configuration and evidence at the time of publication.

Recovery of a data key does not itself grant cloud device-administration authority.
If every authorized signing identity is lost, a surviving independently encrypted
custody backup or a product-defined, reviewed recovery authority is required. The
current synthetic profile chooses neither implicitly. Do not promise full cloud
write/enrollment recovery from a resource recovery wrapper alone.

## Adapter retention wording for product review

The current adapter supports explicit bounded maintenance for SaaS content purge,
operation-receipt/challenge expiry and encrypted history compaction. It does not
schedule these operations or erase provider backups/WAL/storage pages. Product
text must name the actual invocation schedule and provider behavior before
promising a deletion deadline. Encrypted tombstone payloads can be removed after
the supported offline horizon, while minimal object revision/deletion metadata is
retained for the scope lifetime to prevent stale resurrection. This is not full
metadata erasure. Clients older than retained history are blocked with their local
encrypted copies and pending changes preserved; automatic recovery from an
untrusted server snapshot is not supported. Non-null active-age expiry is currently
unsupported for opaque domains and is rejected at composition.
