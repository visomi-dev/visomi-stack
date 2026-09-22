# Getting Started

## Requirements

- Linux, macOS, or WSL2; fnm initialized in your shell.
- Node from `.node-version` and pnpm from `package.json#packageManager`.
- Docker Compose or Podman Compose for PostgreSQL/Redis.
- Git, and network access for the first package/image download.

Start in a new repository created from the template. Do not initialize an existing application to rename it: initialized projects and existing `.env`/custom README files are protected against replacement.

```sh
fnm install
fnm use
export NX_DAEMON=false
corepack enable
pnpm install --frozen-lockfile
pnpm template:init --name "My App" --slug my-app --organization "My Team" --demo
docker compose up -d
pnpm db:migrate
export NX_DAEMON=false
pnpm template:doctor
pnpm nx run server:serve
```

The root `.env` is generated with separate random session, database, and TOTP secrets and owner-only permissions. The initializer does not print these values. Its public counterpart, `template.json`, contains branding, origins, locale choice, and upstream version metadata, never private credentials.

Use `--local-origin http://localhost:8180 --postgres-port 55432 --redis-port 56379` when the default ports are occupied. Compose reads its connection settings from `.env`. Initialization rejects conflicting ports and insecure remote development origins. `--public-origin https://app.example.com` records deployment metadata; it does not configure DNS or deploy anything.

Both English and Spanish remain built. `--locale es` changes the default public-site entry; localized sign-in links preserve the selected language. Google is optional through `--google-client-id`; TOTP enrollment defaults to enabled and can be disabled with `--totp disabled`. Worker/realtime remain part of the composed runtime and require Redis; this initializer does not pretend they can be removed by a flag.

## Complete your first sign-in

With explicit `--demo`, open `/app/en/auth/sign-up`, choose password registration or create a browser passkey, and request verification. Read the local verification message from the existing fixture mailbox:

```sh
curl 'http://localhost:8080/api/test/mailbox/latest?email=you%40example.test&purpose=password_signup'
```

For passkey signup use `purpose=bootstrap_recovery`; for the email second step of password sign-in use `purpose=password_second_step`. These responses contain a local verification code: do not include their bodies in diagnostic reports. The demo API also exposes deterministic test helpers, so keep it loopback-only. Normal development can instead use Mailgun with `ENABLE_TEST_API=false`.

Once the gateway is running, use `pnpm template:doctor --running`. Before startup, use `pnpm template:doctor`; it checks the gateway port is free. `--offline` checks versions/configuration without contacting services, and `--json` emits structured diagnostics on stdout (build progress is on stderr).

## Clean-copy verification

```sh
export NX_DAEMON=false
pnpm template:smoke
```

This uses a disposable copy and isolated PostgreSQL/Redis containers. It includes uncommitted source changes for local verification, but excludes dependencies, build caches, local secrets, and machine-specific Themis registry state. It verifies a second initialization is idempotent and a frozen install still works after the package is renamed.

If container execution is unavailable, `pnpm template:smoke --memory` can use a local `redis-server` and PGlite. The result explicitly identifies memory mode. CI uses actual PostgreSQL. Alternatively, supply `SMOKE_DATABASE_URL` and `SMOKE_REDIS_URL` through the environment, pointing only to disposable test services: smoke applies migrations and creates fixture accounts. It never implicitly uses your normal `DATABASE_URL`.

Logs and `result.json` remain under `tmp/template-smoke-*`; the temporary application and owned services are removed automatically. `--keep` retains the ignored application copy for debugging, including its temporary `.env`.

## Troubleshooting

| Diagnostic                                | Action                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Node/pnpm mismatch                        | Run `fnm install`, `fnm use`, and `corepack enable`. Do not regenerate the lockfile with an arbitrary pnpm version.    |
| Existing `.env`                           | Initialization refuses to rotate secrets. Use doctor for an existing project; initialize a new copy for a new project. |
| PostgreSQL unavailable                    | Start Compose, inspect its health, and check the connection keys without publishing their values.                      |
| Migrations missing                        | Run `pnpm db:migrate` against the intended local database. Doctor never applies migrations.                            |
| Redis unavailable                         | Start Redis. The composed runtime includes BullMQ workers.                                                             |
| Gateway port occupied                     | Use `--running` for your running instance or choose another local port. Do not kill unrelated processes.               |
| Passkey origin mismatch                   | Keep `SITE_URL`, `APP_BASE_URL`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_ID` consistent. RP ID excludes scheme and port.   |
| No delivered code                         | Memory transport does not send mail. Use the explicit demo mailbox or configure Mailgun.                               |
| Protected local-agent feature unavailable | Configure that integration only if the derived product needs it; see architecture/configuration.                       |

Existing users of the former `themis-local` Compose setup must keep or migrate their existing database/volumes deliberately. The new generated project names identify new environments; initialization does not rename volumes or migrate existing data. Never use `compose down -v` as an upgrade step.
