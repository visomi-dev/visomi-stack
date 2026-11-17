# Shared backend infrastructure

`@visomi-stack/backend-shared` contains backend infrastructure independent of
HTTP. Applications and other backend modules consume its public exports.

Database resources, tokens, schemas and migrations live in
[`backend-db`](../db/README.md). This library does not re-export database capabilities.

## Email

`src/lib/mail/` owns the SMTP adapter, authentication code and security-notice
content, MJML templates, generated HTML, escaping and plain-text alternatives.
Consumers use `AuthMail`, `CodePurpose` and `SecurityNotice` through the library's
public exports. Mail failures carry only a fixed message; HTTP translation stays
in the calling application.

The owning executable calls `smtpConfig()` and `createSmtp()` and closes the
transport during shutdown. Importing the library does not connect to SMTP.
`AuthMail` resolves the optional `MAIL_TRANSPORT` token without owning its lifecycle.

Generate or check the committed resources from the workspace root:

```sh
pnpm nx run backend-shared:emails-build
pnpm nx run backend-shared:emails-check
```

`tools/mail/build-templates.ts` compiles MJML in strict mode, without remote fonts
or includes. Generated resources are bundled by the API; the compiled gateway
continues consuming the compiled API exports. Tests use the isolated SMTP fixture
in `tests/support/smtp.cjs`; production executables never load it.

## Dependency injection

`injection-js` is pinned to `2.6.1`. Import the supported surface from this library:
`createInjector`, `inject`, `InjectionToken`, `Injector`, `runInInjectionContext`,
`Provider` and `Type`. Decorator APIs are not exposed.

```ts
import { createInjector, inject, InjectionToken } from '@visomi-stack/backend-shared';

const SETTINGS = new InjectionToken<{ name: string }>('settings');

class Greeting {
  private readonly settings = inject<{ name: string }>(SETTINGS);

  message(): string {
    return this.settings.name;
  }
}

const injector = createInjector([{ provide: SETTINGS, useValue: { name: 'Synthetic example' } }, Greeting]);
const greeting = injector.get<Greeting>(Greeting);
```

Services use property initializers or parameterless constructors. Database tokens `DATABASE` and `DATABASE_POOL` belong to `backend-db`;
`MAIL_TRANSPORT` belongs to this library. Each capability
owns its configuration tokens. Resolve services once in a composition root, then
use their captured dependencies normally in async methods. `inject()` itself is
synchronous and cannot be called after an `await` outside a new explicit context.
Each injector caches its own graph; there is no global application injector or
implicit request scope. Tests replace dependencies through providers.

Creating an injector does not initialize resource providers until they are
resolved. Executables retain explicit database/SMTP/telemetry startup and shutdown;
the injector does not close externally provided resources. The API and gateway
keep `injection-js` external in their runtime manifests so the compiled CommonJS
and ESM artifacts use the package's injection context rather than bundled copies.

Our backend projects disable decorators and metadata emission. DI does not import
or require `reflect-metadata`; its existing transitive use by SimpleWebAuthn is
independent of this composition. The library retains its upstream compatibility
code without requiring a metadata polyfill for our service classes.
