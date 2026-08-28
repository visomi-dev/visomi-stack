# Themis Notes — login-flow

## Provenance

- Upstream: https://github.com/nexu-io/open-design/tree/main/skills/login-flow
- Vendored into Themis on 2026-06-26 as part of the [`2026-06-26-ui-designer-app`](../../../docs/specs/2026-06-26-ui-designer-app/) spec.

## How Themis uses this skill

Pair this skill with [`themis-ui-prototype`](../themis-ui-prototype/) to author auth-related prototype screens (sign-in, sign-up, recover-password, reset-password, OTP). The mobile-first constraints here align with Themis's first-mobile mandate.

When composing the prototype:

- Use the Themis Catalyst Tailwind v4 token set from [`/docs/design-system/tokens.md`](../../../docs/design-system/tokens.md).
- Follow the auth chrome recipe in [`/docs/design-system/recipes.md`](../../../docs/design-system/recipes.md) for layout rhythm.
- The seed prototype `apps/web/ui-designer/src/prototypes/app-auth-shell.html` is the canonical example.

## Upstream version

This is the upstream `SKILL.md` content as fetched on 2026-06-26 from the `main` branch of `nexu-io/open-design`. To upgrade, diff against the upstream and copy the new `SKILL.md` and `references/checklist.md` into this folder.

## Local modifications

None. The upstream content ships verbatim.