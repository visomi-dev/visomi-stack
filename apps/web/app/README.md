# Web application

`web-app` is an Angular 22.2 standalone, zoneless application with SSR,
hydration and native compile-time localization. It runs independently of the
gateway in this slice. Its initial route demonstrates the shared foundations;
it does not represent an authenticated workspace or implement auth UI.

Run from the workspace root:

```sh
pnpm nx serve web-app                         # English, http://localhost:4201/app/en/
pnpm nx serve web-app --configuration=development-es  # Spanish, /app/es/
pnpm nx build web-app                         # Both languages, browser + server
pnpm nx run web-app:preview                   # Compiled SSR, http://127.0.0.1:4201/app/en/
pnpm nx run web-app:extract-i18n
pnpm nx test web-app
pnpm nx e2e web-app-e2e                       # Chromium against compiled SSR
```

The compiled server serves `/app/en/` and `/app/es/`; `/app/` redirects to
English. It accepts `localhost` and `127.0.0.1` as SSR hosts. Additional hosts
must be deliberately configured before hosting. The server owns its listener
only when executed directly; importing `reqHandler` does not start it.

English source messages are extracted into `src/locales/messages.xlf`.
Spanish translations live in `src/locales/messages.es.xlf`. Missing production
translations fail the build. The development server supports one locale at a time.

See [Web foundations](../../../docs/web-foundations.md) for the shared contract.
