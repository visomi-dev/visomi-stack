# Angular app working agreement

This applies to the Angular app in this directory and complements the root [AGENTS.md](../../../AGENTS.md). Leave the upstream Angular skill unchanged.

## Feature structure

- Organize `src/app` around product capabilities and user flows. Put route entry points and feature-specific state, services, and tests with the feature they serve. Do not introduce a generic `pages` directory or global folders that group files only by technical type.
- Give each component its own named folder. Keep its TypeScript, template, styles, and colocated spec together when those files exist. For example: `src/app/ui/forms/pin-input/pin-input.ts`. Introduce a subfolder only when it represents a distinct feature or responsibility, not just to reduce the file count.
- Use the established vocabulary and ownership boundaries (for example, `auth/session` for shared session behavior). For auth code, distinguish individual sign-in flows from shared account methods and session lifecycle. Do not add a parallel subsystem or redundant name when an existing boundary fits.
- Treat source folders and public URLs as separate decisions. A file move does not call for a URL change or an NgModule. For a consumer of Stack, compare against the agreed Stack revision before introducing a different structure; keep product-only features in the consuming app.

## UI composition

- Use the existing Angular `appUI` directives, components, recipes, and design tokens before adding local styling. Keep layout utilities that describe page composition, but do not duplicate a shared primitive's variants, tokens, states, or accessibility behavior as inline class lists.
- In a review or port, check the actual imports, directive and component usage, and responsibility of each folder, not just the rendered appearance. When unsure about a framework pattern, compare current repository code with [Angular's style guide](https://angular.dev/style-guide#organize-your-project-by-feature-areas).
