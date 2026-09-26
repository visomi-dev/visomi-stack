# Template Configuration

`template.json` is public, versioned metadata. `.env` is private local runtime configuration. Shell/environment variables take precedence over file values, as they do in the runtime. Doctor reads the same side-effect-free `environmentSchema` used by the backend, plus operational origin/mail/port checks; it reports field names rather than values.

## Local variables

| Variable                                                             | Required / default                      | Purpose                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                           | `development` locally                   | Runtime mode.                                                                                            |
| `HOST`                                                               | `127.0.0.1`                             | Local gateway binding, particularly important for demo APIs.                                             |
| `PORT`, `GATEWAY_PORT`                                               | Generated from local origin             | Gateway port; `PORT` takes precedence.                                                                   |
| `NG_ALLOWED_HOSTS`                                                   | `localhost`                             | Angular SSR host allowlist.                                                                              |
| `SITE_URL`                                                           | Local origin during development         | Astro canonical origin; set at build time for deployment.                                                |
| `APP_BASE_URL`                                                       | Local origin plus `/app`                | Public application base.                                                                                 |
| `WEBAUTHN_ORIGIN`                                                    | Local origin                            | Exact browser origin allowed for ceremonies and CSRF.                                                    |
| `WEBAUTHN_RP_ID`                                                     | `localhost`                             | Relying-party hostname, without scheme/port.                                                             |
| `COOKIE_SECURE`                                                      | `false` for local HTTP                  | Must be true for production HTTPS.                                                                       |
| `SESSION_SECRET`                                                     | Generated, required                     | Unique private session signing secret.                                                                   |
| `COMPOSE_PROJECT_NAME`                                               | Project slug                            | Isolates new local Compose environments.                                                                 |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Generated / local defaults              | Compose initialization and port mapping.                                                                 |
| `DATABASE_URL`                                                       | Generated                               | PostgreSQL URL matching the intended environment.                                                        |
| `DATABASE_DRIVER`                                                    | `pg`                                    | `memory` is for explicit ephemeral verification.                                                         |
| `DATABASE_AUTO_MIGRATE`                                              | `false` in generated environments       | Apply migrations explicitly with `pnpm db:migrate`. Memory smoke overrides this in its isolated runtime. |
| `DATABASE_SSL`                                                       | `false` locally                         | Configure verified TLS for the chosen production database.                                               |
| `REDIS_URL`, `REDIS_PORT`                                            | Local Redis                             | Queue/session/realtime infrastructure.                                                                   |
| `MAIL_TRANSPORT`                                                     | `memory` locally                        | `mailgun` for actual delivery.                                                                           |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`                  | Required for Mailgun                    | Private API key, verified domain, and sender. Optional `MAILGUN_URL` selects the provider region.        |
| `ENABLE_TEST_API`                                                    | `false`, enabled explicitly by `--demo` | Local fixtures/mailbox. Runtime rejects it in production.                                                |
| `GOOGLE_AUTH_CLIENT_ID`                                              | Empty / disabled                        | Public OAuth client ID; configure authorized origins separately.                                         |
| `AUTH_TOTP_ENROLLMENT_ENABLED`                                       | `true`                                  | Optional authenticator enrollment.                                                                       |
| `AUTH_TOTP_ENCRYPTION_KEY`                                           | Separately generated                    | Dedicated private encryption key; changing it requires a key migration strategy.                         |

## Production and optional integrations

Use [`deploy/production.env.example`](../../deploy/production.env.example) as a variable inventory, and store populated values in the deployment secret store. It is not a ready-to-deploy configuration.

Astro's canonical origin is a build-time setting: record `project.publicOrigin` in `template.json`, or supply `docker build --build-arg SITE_URL=https://app.example.com .`. A runtime-only `SITE_URL` change cannot rewrite an already built site's canonical URLs.

Production requires PostgreSQL with explicit migrations, a unique session secret, HTTPS/secure cookies, durable opaque storage configuration, and the pinned local-agent public key under the current runtime contract. Real mail delivery additionally needs Mailgun. Doctor `--production` rejects memory mail and checks origin consistency; presence of an OAuth ID does not prove provider authorization.

| Variable                                                 | Requirement                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `OPAQUE_SYNC_STORAGE`                                    | `durable` in production; `memory` is permitted for local development.                                             |
| `OPAQUE_SYNC_S3_ENDPOINT`                                | S3-compatible endpoint when durable storage is enabled; omit rather than assigning an empty URL.                  |
| `OPAQUE_SYNC_S3_BUCKET`                                  | Bucket for opaque encrypted envelopes.                                                                            |
| `OPAQUE_SYNC_S3_ACCESS_KEY`, `OPAQUE_SYNC_S3_SECRET_KEY` | Private object-store credentials.                                                                                 |
| `LOCAL_AGENT_PUBLIC_KEY`                                 | Pinned public key for the existing protected local-agent boundary; mandatory under current production validation. |
| `LOCAL_AGENT_URL`                                        | Existing local-agent service URL when that integration is used.                                                   |

```sh
pnpm template:doctor --production --env-file /path/to/private/production.env --offline --json
```

Offline success is configuration validation only. Online checks add authenticated database/Redis probes and read-only migration hash inspection; `--running` checks gateway readiness. No doctor mode modifies a database, rotates keys, sends email, or contacts Google to validate credentials.

Do not change WebAuthn RP IDs casually after issuing credentials: credentials are scoped to the relying party. A domain/key/database migration is a separate operational change, not a global search-and-replace.
