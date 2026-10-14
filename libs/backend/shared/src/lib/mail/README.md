# Transactional email

Three generic MJML templates cover verification, email-change notices and
recovery notices. Branding comes from the template's configured app name at
delivery time; no Nive brand, financial copy, family invitation or product
reminder is included. English source copy and Spanish translations share a
single catalog shape. There are no remote fonts, tracking images or encrypted
record contents.

`shared:emails-build` compiles strict MJML at build time and embeds the resources
in committed TypeScript. MJML is development-only and never handles production
codes. Runtime Handlebars escapes all HTML values. Plain text uses the same
catalog, and Luxon formats expiry in the selected locale and UTC. The shared
library build regenerates resources automatically. Commit regenerated resources
when changing MJML or catalogs so source-based tests use the same templates.

API delivery uses the recipient's saved preference when available, defaults
unknown recipients to English, and preserves the initiating user's locale when
sending email-change messages to new and old addresses. Memory transport keeps
the rendered body for test assertions; it never sends real mail.

Verification:

```sh
pnpm nx run shared:emails-build
pnpm nx run shared:emails-check
pnpm nx run shared:test --runInBand --testPathPatterns=render-mail
pnpm nx run api:test --runInBand --testPathPatterns=account-router
```

Load Node with `fnm` and export `NX_DAEMON=false` before running these commands.
`emails-check` captures twelve mobile/desktop English/Spanish previews in
`dist/email-previews` and checks heading structure, overflow and WCAG A/AA with
axe. This is browser validation, not Gmail/Outlook email-client certification.
