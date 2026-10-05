# Account-scoped notification inbox

The generic inbox lives at `/app/<locale>/notifications`. It contains no decrypted
project content, user-supplied text, financial events, or arbitrary navigation URLs.
Kinds are `service` and `security`; the UI translates those fixed labels.

## Ownership and persistence

Both inbox records and preferences are scoped by **account and user**. PostgreSQL
RLS requires transaction-local `app.current_account_id` and `app.current_user_id`;
application queries also filter both columns and require current membership.
The migration is `drizzle/20261003200000_notification_inbox/migration.sql`.

`recordNotification(owner, id, kind)` is a trusted backend producer, not a public
creation endpoint. IDs must be stable UUIDs for one recipient so producer replay
does not duplicate notifications. For multiple recipients, allocate a separate
stable ID per account/user/event combination.

Durable-operation completion creates one `service` notification for its owner in
the **same transaction** as its leased completion write. Lost Redis hints cannot
lose the persisted inbox item, and a stale worker cannot create a second item.
The project-seed worker is the first application producer. Database workers require
the same trusted infrastructure role described in [async operations](async-operations.md).

## HTTP contract

All endpoints require a full authoritative session and return `Cache-Control:
no-store`. Mutations retain the existing Origin/CSRF boundary and session-authority
lease. The contracts are included in `/api/openapi.json`.

| Method | Endpoint                           | Behavior                                                                                       |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/notifications`               | At most 100 newest records, fixed kind, read state and UTC ISO timestamp; no owner fields      |
| POST   | `/api/notifications/:id/read`      | Idempotent read marking scoped to the current owner; a missing/foreign ID returns the same 204 |
| POST   | `/api/notifications/preferences`   | Stores strict `{ servicePush: boolean }` for this account/user                                 |
| GET    | `/api/notifications/subscriptions` | Current session/account registration boolean, availability and public VAPID key only           |
| POST   | `/api/notifications/subscriptions` | Registers the current full session when explicitly enabled and VAPID is valid; otherwise 503   |
| DELETE | `/api/notifications/subscriptions` | Idempotently removes only the current full session/account registration; no keys returned      |

The Angular route validates responses using Zod Mini, disables transfer caching,
uses the configured locale for date display, and cancels loads/mutations on owner
change or route teardown. Read failures preserve the inbox and expose an accessible
retryable error. Refresh remains available; no background polling is introduced.

## Realtime invalidation

The route registers one `notifications:watch` subscription while connected. The
server sends only `notifications:changed` with an empty object, prompting a fresh,
authorized HTTP fetch. It never streams inbox contents, owner IDs or navigation.
Initial subscription and reconnect trigger catch-up. Owner changes, logout and
route teardown remove callbacks and cancel HTTP requests.

Trusted producers publish an account/user hint on `visomi:notifications:v1` only
after the inbox/preferences transaction commits. Redis failure does not roll back
committed data. The composed memory runtime uses the same in-process hint bus.
The realtime consumer validates each hint, filters both owner columns, and reloads
the persisted full session/membership under the authority lease before emission.
Watches bind session, account, user and auth version; changed or revoked authority
disconnects instead of moving a watch to another owner. Fanout coalesces concurrent
delivery for each socket and keeps at most one watch per socket.

Hints are best effort. Manual refresh and reconnect fetch authoritative persisted
state; this is not an exactly-once event log or Web Push delivery.

## Explicit opt-in delivery

`pushAvailable` defaults to **false** and becomes true only with explicit
`WEB_PUSH_ENABLED=true` and valid matching VAPID configuration. Configure API and
worker consistently; the API cannot certify another service's deployment settings.
The preference records intent only; it does not itself register a device. The UI
requests browser permission only from the explicit enable action, and requires a
supported browser and active Angular service worker. A disabled/misconfigured
deployment returns 503 on registration and discloses no private VAPID material.

The delivery contract in `libs/backend/shared/src/lib/notifications/push-contract.ts`
already validates canonical HTTPS vendor endpoints (Google, Mozilla and Apple),
rejects credentials, explicit ports, query/fragment redirect inputs and host aliases,
and verifies canonical authentication bytes and an actual uncompressed P-256 point.
It now protects persistence and the gated HTTP registration contract. Delivery must
revalidate stored records and disable redirects; endpoint validation alone does not
establish safe delivery.

### Session-bound registration foundation

`registerPushSubscription(owner, input, store)` backs the opt-in HTTP registration.
It requires an authoritative store, holds the full session lease, reloads account,
user and auth version, and checks current database membership/auth version before
writing. The request body never chooses those owner fields. Expiry is bounded by
the persisted session cookie and seven days. One registration can be replaced per
session/account/user, with at most eight registrations per account/user; the lease
serializes concurrent capacity checks. Replacement increments a revision so a
future delivery worker can discard stale claims safely.

The endpoint hash is globally unique: a different session or account cannot take
over an existing browser endpoint. The migration
`drizzle/20261003210000_push_subscriptions/migration.sql` enables account/user RLS,
uses a composite membership foreign key, and installs infrastructure-owned cleanup
triggers for PostgreSQL session revocation/deletion/scope changes and user auth-version
changes. Membership removal cascades registration cleanup.

The memory store invokes its configured cleanup under the SID lease on revocation
or changes to account, user, auth version or full authority. Cleanup precedes scope
publication; cleanup failure tombstones the SID rather than leaving old authority
active. Late saves cannot revive a tombstoned session. API, realtime and operation
worker initialization all configure this hook for the shared composed memory store.
Expiry cleanup runs with the operation worker, at most 100 expired records per pass,
and rechecks expiry so a concurrent refresh is not deleted.

Session IDs, endpoints and push authentication bytes are private infrastructure
data. They are never returned in the inbox, mutation responses, realtime payloads
or UI. Database access and backups must treat this table as sensitive, like the
session table; these bytes are not vault keys or decrypted project content.

### Durable delivery consumer

`drizzle/20261003220000_push_deliveries/migration.sql` adds an account/user RLS
outbox. Trusted inbox producers, including durable-operation completion, insert
at most eight device deliveries in their existing transaction. A producer replay
cannot duplicate receipts; opting in does not retroactively alert old inbox items.
The outbox stores no provider endpoint, subscription keys or message content.

The worker uses compare-and-swap leases, one delivery per polling pass, a 30-second
claim lease, at most three attempts and a ten-minute event lifetime bounded by
the registration expiry. Retries are delayed 30/60 seconds. Deduplication receipts
expire one day after their delivery lifetime; deletion is limited to 100 per pass.
Workers may recover abandoned claims. Delivery is **at least once**, not exactly
once: a process crash after provider acceptance and before receipt commit can
repeat a generic alert. The inbox remains authoritative.

Each send holds live full-session authority and database shared locks on the
membership/auth version, subscription revision, preference, unread inbox item
and delivery lease. Changes committed before those checks prevent sending;
concurrent changes wait for the bounded send to release its locks. Stored endpoint,
key, session binding and endpoint hash are checked again. Invalid authority is
permanent; transient storage/network errors have bounded retries. Vendor 404/410
deletes only the exact expired subscription revision, with cascading outbox cleanup.
Already accepted provider messages cannot be recalled by session revocation.

`web-push` prepares RFC Web Push encryption and per-request VAPID authentication;
the transport uses manual redirects and never follows a provider `Location`.
Requests are bounded to five seconds or remaining session/event/subscription
validity, whichever is shorter. Provider bodies are discarded without buffering.
Payloads contain fixed generic copy from the English/Spanish translation resource,
selected from the user's configured locale, and a fixed localized inbox action:
no private content, owner/session IDs or untrusted navigation. Provider TTL is 60 seconds. Raw provider
errors, response bodies, endpoint hashes and auth material are not logged.

Transport is opt-in with `WEB_PUSH_ENABLED=true`, `WEB_PUSH_SUBJECT`,
`WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY`. The worker validates a canonical
matching P-256 key pair and an HTTPS/mailto contact before claiming work. Secrets
must be deployment-managed, not committed. Default/example configuration remains
disabled. The same validated opt-in controls registration and public capability
advertising. The localized browser UI cancels requests on owner changes and teardown,
discards late permission results, and cleans newly created subscriptions after failed
enrollment. It never deletes a previously existing browser registration after an
endpoint conflict. Removal revokes server authority before local cleanup. Capability
responses are uncached and expose only availability, the public VAPID key and a
current-session registration boolean. No Nive family or financial reminders are imported.

The Chromium device enrollment scenario keeps Angular `SwPush`, the PWA worker and
the gateway real but replaces `PushManager` at the external-provider boundary. It
verifies explicit enrollment, reload persistence and Spanish removal without sending
vendor traffic. Enable it explicitly with isolated ports, Redis and ephemeral VAPID
test keys using `pnpm nx run app-e2e:e2e --grep='registers explicit device alerts'`.
This scenario is not external-provider certification or OS permission/install testing.

## Focused verification

Load Node with `fnm` and export `NX_DAEMON=false` before each shell invocation:

```sh
pnpm nx run shared:test --runInBand --testPathPatterns='notifications|operations'
pnpm nx run api:test --runInBand --testPathPatterns='notification-router|operation-router'
pnpm nx run app:vite:test --run
pnpm nx run server:build --configuration production
pnpm nx run app-e2e:e2e-ci--src/app/notifications.spec.ts --args='--project=chromium'
```

PGlite role tests validate the migration policy but do not certify real PostgreSQL
restart/failover or external push-provider delivery. Memory mode loses the inbox
with the process, like the rest of its database.

The outbox suite can also use a **disposable** loopback PostgreSQL database named
`themis_api_e2e`, selected explicitly through `PUSH_DELIVERY_TEST_DATABASE_URL`.
It migrates that database and deletes its delivery fixtures; never point it at an
existing shared/developer database. Export the variable with the isolated port and
then run `pnpm nx run shared:test --runInBand
--testPathPatterns=notifications/processor --skip-nx-cache`. This uses the real
PostgreSQL session store and RLS, not a memory substitute. External-provider
delivery and full restart/failover certification still require separate checks.
