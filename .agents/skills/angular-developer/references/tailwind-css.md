# Using Tailwind CSS with Angular

Tailwind CSS is a utility-first CSS framework that integrates seamlessly with Angular.

Inspect the installed Tailwind version and existing Angular/Nx integration first. For v4, use CSS-first practices below. Preserve a real v3 project until a migration is explicitly requested; Angular's version alone does not select Tailwind's version.

Reuse existing dependencies and configuration. Setup examples are conditional on an authorized setup change; do not run installs or `ng add` merely to style a component. Use the repository package manager and Nx workflow.**

## Automated Setup (Recommended)

The easiest way to add Tailwind CSS to an Angular project is via the Angular CLI:

```shell
ng add tailwindcss
```

This will automatically:

1. Install `tailwindcss` and peer dependencies.
2. Configure the project to use Tailwind CSS.
3. Add the proper import to your global styles.

## Manual Setup (Tailwind v4)

If setting up manually, use the following Tailwind v4 pattern:

### 1. Install Dependencies

Install Tailwind CSS and PostCSS:

```shell
pnpm add -D tailwindcss @tailwindcss/postcss postcss
```

### 2. Configure PostCSS

Create a `.postcssrc.json` file in the project root:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

_Prefer CSS-first configuration in v4. A legacy JavaScript config is supported only when deliberately loaded with `@config`; do not introduce one by default._

### 3. Import Tailwind CSS

In your global styles file (e.g., `src/styles.css`), add the standard v4 import:

```css
@import 'tailwindcss';
```

_Tailwind v4 is not designed to run through Sass/Less/Stylus. Keep its entry in a plain CSS file supported by the existing Angular/Nx pipeline; do not substitute Sass `@use` for this import or migrate unrelated component styles. See the [official compatibility guidance](https://tailwindcss.com/docs/compatibility#sass-less-and-stylus)._

### 4. Use Utility Classes

You can now use Tailwind classes directly in your component templates:

```html
<h1 class="text-3xl font-bold underline">Hello world!</h1>
```

## Summary for AI Agents

- **Do not use `@tailwind base; @tailwind components; @tailwind utilities;`**. Use `@import 'tailwindcss';`.
- Prefer CSS-first tokens; load legacy JavaScript configuration explicitly only when required by the existing setup.
- Apply v4 syntax to v4 projects; do not force a migration or install.
