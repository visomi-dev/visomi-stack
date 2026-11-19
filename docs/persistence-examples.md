# Vault and Cloud examples

Use synthetic notes and accounts in a disposable development or test profile.

| Example                                            | Where data lives                                                                                                                                       | Who can read it                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vault local download** (`/vault-example`)        | The original sample is encrypted in this browser’s IndexedDB. The optional file contains its ciphertext and the primary device-bound wrapped key.      | A signed-in user must unlock the local vault using its configured PIN or verified passkey PRF.                                                                                            |
| **Vault backup test workspace** (`/vault-example`) | A new test note is encrypted in IndexedDB from the start. An explicit upload stores its ciphertext and synchronization metadata in the opaque service. | A device with a usable key can read its local copy. A new profile needs access to the workspace and verified pairing to restore the note.                                                 |
| **Cloud** (`/cloud-example`)                       | Notes go directly to PostgreSQL through the SaaS records API.                                                                                          | The owner can create, read, edit, and delete notes. An explicitly permitted test account can read shared notes. Trusted services and database administrators can read the stored content. |

Choose Cloud for service-readable data and account-based collaboration. Use the Vault example to see browser-local encryption and the separate unlock step. Cloud access uses a verified account session, resource grants, and PostgreSQL row-level security (RLS). Cloud is service-readable SaaS storage and makes no zero-knowledge claim.

## Enable the synthetic profile

The normal Vault sample is available without these flags. The Cloud workspace, Vault local download, and Vault backup test workspace require `NODE_ENV=development` or `NODE_ENV=test`, `VISOMI_PERSISTENCE_EXAMPLE=true`, and `VISOMI_PERSISTENCE_DEMOS=true`. The executable rejects this opt-in in production.

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

## Download the local Vault sample

1. Open **Vault example**, set up or unlock the local vault, and open the synthetic note.
2. Choose **Download encrypted backup**. The browser exports the exact stored encrypted note and its original wrapper. It sends no backup payload to the API. Keep the file private. A PIN-protected copy permits offline PIN guessing. A passkey added later to a PIN vault is a local secondary wrapper and is outside the current backup format.
3. Open the same Vault URL in a fresh profile signed in to the same account. That profile still needs its own vault setup and does not see the original note. The download provides no authorized import on that profile.

The v1 file restore SDK requires a trusted expected owner, device, origin, unlock method and scope, plus an independent generation floor. Import into empty storage stays locked until the recipient proves custody, and the restored generation is read-only. The local reference vault has no server roster, enrollment authority, or recipient binding. The exported wrapper is bound to the source device. Copying that binding into a new profile would make the recipient impersonate the source. Account login and possession of the file supply neither the trusted generation nor recipient custody. The local download stays in the browser.

## Back up and restore a new Vault test note

1. On **Vault example**, under **Back up and restore a test note**, create a backup test workspace. Set up its first device and save a synthetic note. This creates a new private resource in the existing authorized `private-resources` scope. The original local sample keeps its own keys and ciphertext.
2. Choose **Upload encrypted note**. Before upload, the encrypted note is stored in IndexedDB’s outbox. Upload commits that same envelope through the opaque replica, which authenticates its history and clears the outbox only after the write is observed.
3. Open the workspace address in a fresh profile signed in to the same test account. Signing in alone leaves the note locked. Open **Vault devices** in both profiles and request pairing on the new profile. Compare the fingerprints directly and approve from the unlocked first device. Finish with the verified approver fingerprint on the new profile.
4. Select **Open test private resource** to return to the same Vault workspace. Choose **Download and restore note**. The recipient verifies the encrypted history and stores the same encrypted note in IndexedDB before showing its content. After reloading, unlock the paired profile to read its local copy.

This flow uses the existing server access checks, signed approval, recipient-sealed key delivery, generation and replay checks, and retention policy. An authorized account may have access to opaque ciphertext before pairing. The device needs its own approved key delivery to restore or decrypt that ciphertext. The server sees encrypted content and synchronization metadata. Plaintext, raw decryption keys, the PIN, and PRF output stay in the browser. Pairing cannot import the original local download, and losing all usable keys can permanently lose access to the backup test workspace.

The [authenticated browser test](../apps/web/app-e2e/auth/persistence.auth.spec.ts) compares the original outbox envelope with the uploaded and restored IndexedDB envelopes, tests a same-account unpaired profile and an unrelated account, and verifies the recipient can reopen the note from local storage. It uses Chromium and a virtual authenticator for recipient PRF. WebKit coverage of the original local Vault uses simulated WebAuthn. Physical iPhone Safari has not been verified.
