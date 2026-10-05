# Template deployment on Railway

This runbook adapts the working Nive gateway deployment without its project IDs,
domains, credentials, database names, or storage resources. It does not deploy
anything automatically.

## Resources and runtime

Build the gateway from the repository-root `Dockerfile`. Provision PostgreSQL,
Redis, and a private S3-compatible bucket for opaque ciphertext. Reference the
new application's infrastructure variables rather than copying credentials
from another application.

The gateway serves the site, Angular app, API, and realtime endpoint, and starts
the worker as a managed child. Keep one gateway replica until worker scheduling
has been assessed for multiple gateway instances. Disable service sleeping.

Set the following variables for the initialized application:

| Variable                      | Value                                              |
| ----------------------------- | -------------------------------------------------- |
| `NODE_ENV`                    | `production`                                       |
| `COOKIE_SECURE`               | `true`                                             |
| `TRUST_PROXY_HOPS`            | `1` for a single trusted TLS-terminating ingress   |
| `DATABASE_DRIVER`             | `pg`                                               |
| `DATABASE_AUTO_MIGRATE`       | `false`                                            |
| `ENABLE_TEST_API`             | `false`                                            |
| `ENABLE_LOCAL_ACTIVATION`     | `false`                                            |
| `OPAQUE_SYNC_STORAGE`         | `durable`                                          |
| `SITE_URL`, `WEBAUTHN_ORIGIN` | The application's HTTPS origin                     |
| `APP_BASE_URL`                | The HTTPS origin plus `/app`                       |
| `WEBAUTHN_RP_ID`              | The application's hostname, without scheme or path |

The default proxy hop count is zero for direct local traffic. Use a positive
count only when **all** incoming traffic passes through that many trusted
proxies. Do not expose the container directly with that configuration. Express
must recognize HTTPS at the ingress before it can issue secure session cookies.

Generate independent `SESSION_SECRET` and `AUTH_TOTP_ENCRYPTION_KEY` values.
Configure `DATABASE_URL`, `REDIS_URL`, and `OPAQUE_SYNC_S3_*` variables from the
new resources. `DATABASE_SSL=false` is appropriate only for an explicitly
trusted private database connection; configure TLS separately for public access.

The current template also requires `LOCAL_AGENT_PUBLIC_KEY` in production for
its inherited protected local-agent boundary. Pin the intended agent's public
key and configure `LOCAL_AGENT_URL` when using that integration. This port does
not remove that requirement or introduce a server-side plaintext fallback.
Validate the complete configuration with `pnpm template:doctor --production
--offline --json` before deploying; passing offline validation does not prove
service connectivity. See [template configuration](../template/configuration.md).

Mail requires `MAIL_TRANSPORT=mailgun`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and
`MAILGUN_FROM`. Google sign-in requires `GOOGLE_AUTH_CLIENT_ID` and the matching
authorized origin. Do not enable unported Nive notification or vault flags.

## Migrations and health

Run migrations in the pre-deploy phase with the production dependencies and an
explicit Drizzle client, not the development-only `drizzle-kit` CLI:

```sh
node -e "const {Pool}=require('pg'); const {drizzle}=require('drizzle-orm/node-postgres'); const {migrate}=require('drizzle-orm/node-postgres/migrator'); const pool=new Pool({connectionString:process.env.DATABASE_URL}); migrate(drizzle(pool),{migrationsFolder:'./drizzle'}).then(()=>console.log('Migrations complete')).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>pool.end());"
```

Start with `node dist/apps/web/server/main.js`. Configure `/readyz` as the health
check, allowing up to 300 seconds for startup and at least 15 seconds for
shutdown draining. `/healthz` is the separate liveness endpoint.

Wait for the **specific** deployment to reach `SUCCESS`, then verify `/readyz`,
the localized public site, sign-in, and secure cookies over HTTPS. Verify mail
delivery separately using an authorized test account.

## Backups

Configure database backups on the new persistent volume. Verify retention
periods in the provider rather than inheriting historical Nive settings. Private
bucket backups and restore verification are separate operational requirements;
database backups do not cover ciphertext objects in object storage.
