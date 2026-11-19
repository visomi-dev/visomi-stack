# Vault and Cloud examples

Use synthetic notes and accounts in a disposable development or test profile.

| Example                      | Where data lives                                                                                                                                       | Who can read it                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vault** (`/vault-example`) | The sample note is encrypted in this browser’s IndexedDB. The optional download contains the same ciphertext and the primary device-bound wrapped key. | A signed-in user must unlock the local vault using its configured PIN or verified passkey PRF.                                                                                            |
| **Cloud** (`/cloud-example`) | Notes go directly to PostgreSQL through the SaaS records API.                                                                                          | The owner can create, read, edit, and delete notes. An explicitly permitted test account can read shared notes. Trusted services and database administrators can read the stored content. |

Choose Cloud for service-readable data and account-based collaboration. Use the Vault example to see browser-local encryption and the separate unlock step. Cloud access uses a verified account session, resource grants, and PostgreSQL row-level security (RLS). Cloud is service-readable SaaS storage and makes no zero-knowledge claim.

## Enable the synthetic profile

The normal Vault sample is available without these flags. The Cloud workspace and the Vault backup controls require `NODE_ENV=development` or `NODE_ENV=test`, `VISOMI_PERSISTENCE_EXAMPLE=true`, and `VISOMI_PERSISTENCE_DEMOS=true`. The executable rejects this opt-in in production.

Run the [Cloud RLS setup](../libs/backend/db/tools/cloud-example-rls.sql) once after the standard persistence migrations, on a freshly provisioned, isolated PostgreSQL 16 test cluster. Apply it with the fixture database login that owns the tables and that the synthetic API connects as. The script grants that login permission to switch to one restricted role. The authenticated Playwright fixture provisions its own database and applies the script automatically. For a manual run in an equivalently isolated profile, run the following against the disposable test database.

```sh
psql "$SYNTHETIC_EXAMPLE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f libs/backend/db/tools/cloud-example-rls.sql
```

## Try Cloud sharing

1. Sign in to one test account, open **Cloud example**, and create a workspace. Save an owner-only note and a shared note with synthetic content.
2. Sign in to a different verified test account in a separate browser profile. Copy its test account ID from the Cloud screen. As the owner, grant that ID read access to the workspace, then send its address to the permitted account. The address carries no permission.
3. Open the workspace with the reader. Only the shared note appears. Try the same address in a third, unrelated profile to see access denied.
4. Remove the reader’s access as the owner. Refresh on the reader’s screen to see access denied. Previously viewed content could already have been copied.

The API derives the actor from the verified session and checks membership, resource grants, and record rules. The Cloud product uses its own resource scopes in the existing persistence tables. For record operations, the API switches its transaction to `visomi_cloud_example_records`, a non-owning, non-superuser role without `BYPASSRLS`, and sets the server-derived account and scope as transaction-local context. PostgreSQL checks active membership, the explicit reader grant, and each record’s owner/audience. Policies also constrain record writes and idempotency receipts. The transaction uses the same tenant lock as grant changes. If the role is missing or RLS is inactive, CRUD fails closed. The standard pool still handles sessions and grant administration. RLS constrains the effective record role and complements the application’s authorization. The database and trusted runtime retain access to plaintext.

## Download a Vault backup

1. Open **Vault example**, set up or unlock the local vault, and open the synthetic note.
2. Choose **Download encrypted backup**. The browser exports the exact stored encrypted note and its original wrapper. It sends no backup payload to the API. Keep the file private. A PIN-protected copy permits offline PIN guessing. A passkey added later to a PIN vault is a local secondary wrapper and is outside the current backup format.
3. Open the same Vault URL in a fresh profile signed in to the same account. That profile still needs its own vault setup and does not see the original note. The download provides no authorized import on that profile.

The v1 restore SDK requires a trusted expected owner, device, origin, unlock method and scope, plus an independent generation floor. Import into empty storage stays locked until the recipient proves custody, and the restored generation is read-only. The local reference vault has no server roster, enrollment authority, or recipient binding. The exported wrapper is bound to the source device. Copying that binding into a new profile would make the recipient impersonate the source. Account login and possession of the file supply neither the trusted generation nor recipient custody. Upload and second-profile restore of this local vault are blocked on a reviewed recipient authorization and delivery design for this local scope.

**Open the device pairing example** demonstrates a separate, supported flow at `/persistence`. Create a test workspace, set up the private resource, save a synthetic note, and synchronize its ciphertext. In a second profile signed in to the same account, open **Vault devices** for that resource and request pairing. Compare both fingerprints and explicitly approve with the unlocked first device. Finish on the second device and synchronize to retrieve the same encrypted note. The transport contains encrypted content and authenticated, recipient-sealed key deliveries. Plaintext and raw keys stay client-side. This resource has an authorized roster and independent device custody. Its pairing and synchronization cannot open the local backup file.
