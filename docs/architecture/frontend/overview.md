# Frontend Architecture

## Frontend Surfaces

Themis uses two frontend surfaces with different responsibilities.

### Astro Site

`apps/web/site` is the public-facing surface.

Recommended responsibilities:

- product positioning
- landing page
- marketing copy
- sign-in entry points
- future docs or public changelog pages if needed

### Angular App

`apps/web/app` is the richer product application surface.

Recommended responsibilities:

- projects overview
- inbox or triage
- task detail view
- today view
- initiative and relationship workflows

## Separation Rationale

- Astro is well suited for the public landing experience and lightweight content pages
- Angular is a better fit for dense, interaction-heavy task workflows and long-lived application state

This keeps the product architecture aligned with the original Themis direction while preparing the repo for future client expansion.

## Angular App Structure

`apps/web/app` follows a domain-first Angular structure:

- `activation/`, `auth/`, `projects/`, and future product-domain folders for route components
- `shared/` for cross-route state, guards, constants, layout, and form primitives
- noun-based state holders such as `Auth` and `Settings`
- dedicated functional guard files for each routing concern
- route-local Playwright coverage split by surface rather than one large auth spec

Generate new Angular web app components directly into their domain folder:

```bash
pnpm nx g @nx/angular:component apps/web/app/src/app/<thing>
```

Do not introduce `src/app/pages/` for route components.

See [Angular App Conventions](angular-conventions.md) for the working rules.
