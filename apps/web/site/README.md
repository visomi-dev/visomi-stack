# Public website

`web-site` is an Astro 7 application compiled with the Node middleware adapter.
The Express gateway serves its `client` directory and imports the named `handler`
from `dist/apps/web/site/server/entry.mjs`. Importing that module does not listen.

Run from the workspace root:

```sh
pnpm nx serve web-site          # Astro development, http://127.0.0.1:4200/en/
pnpm nx build web-site
pnpm nx serve web-gateway       # Compiled site + API, http://localhost:3000/en/
pnpm nx typecheck web-site
pnpm nx lint web-site
pnpm nx e2e web-site            # Chromium against the compiled Express gateway
```

Public pages live at `/en/` and `/es/`; `/` redirects to English. `/api` and
`/app` remain reserved at the gateway, including their missing routes.
Unknown public pages return 404. The site does not implement authentication.

See [Web foundations](../../../docs/web-foundations.md) for shared styles,
themes, localization, build boundaries and verification.
