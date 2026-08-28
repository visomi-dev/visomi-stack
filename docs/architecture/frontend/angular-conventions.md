# Angular App Conventions

## Scope

These conventions apply to `apps/web/app`.

They are derived from the stronger Angular patterns used in the reference application and are now the default for Themis.

## Structure

- Route components live directly under their domain folder, such as `src/app/activation/`, `src/app/auth/`, and `src/app/projects/`.
- Reusable cross-route state and UI live under `src/app/shared/`.
- Shared layout controls live under `src/app/shared/layout/`.
- Shared form primitives and helpers live under `src/app/shared/form/`.
- Avoid `core/`, `features/`, and suffix-heavy naming when a simpler domain-first folder communicates ownership more clearly.
- Generate new components with `pnpm nx g @nx/angular:component apps/web/app/src/app/<thing>` and then adjust generated files to match project conventions.
- Do not create a generic `src/app/pages/` folder.

## Naming

- Use noun-based class names for state holders: `Auth`, `Settings`, `SEO`, `Deps`.
- Do not use `*.service.ts` files or `Service` suffix class names.
- Keep one guard or resolver per file.

## Routing

- Use lazy route components with `loadComponent`.
- Keep route protection in functional guard files.
- When a route needs preconditions, establish them before render through guards or resolvers instead of redirecting from the component.
- Prefer separate route components for `sign-in`, `sign-up`, and `verify-email` rather than one route component switching mode through route data.

## State

- Use signals for app state and derived state.
- In the zoneless app, async UI feedback must also use signals.
- Effects belong on `readonly` properties, never in constructors.
- Browser storage access must stay SSR-safe.

## Forms

- Keep reactive forms typed.
- PrimeNG controls are allowed and preferred for the current auth surface.
- Wrap repeated field presentation in shared primitives so labels, inline help, and validation errors stay consistent.
- Validation messages should come from shared helpers or component methods, not repeated template conditionals.

## Testing

- Unit tests should cover shared state holders and route guards.
- Playwright coverage should be split by route:
  - `auth/sign-in.spec.ts`
  - `auth/sign-up.spec.ts`
  - `auth/verify-email.spec.ts`
  - `app/index.spec.ts`
  - `theme/theme.spec.ts`
- Shared Playwright helpers belong in `apps/web/app-e2e/src/support/`.
