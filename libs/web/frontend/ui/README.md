# Frontend UI styles

Framework-independent Tailwind recipes, generated with `@nx/js:library` as an
internal, non-buildable library. Consumers compile the TypeScript source.
The library has no Angular, Astro, DOM or Node runtime dependencies.

```ts
import { button } from '@visomi-stack/web-frontend-ui';
import type { ButtonOptions, ButtonSize, ButtonVariant } from '@visomi-stack/web-frontend-ui';

button.classes(); // primary, md
button.classes({ variant: 'secondary', size: 'sm' });
```

The function returns a class string. Supported variants are `primary` and
`secondary`; sizes are `sm` and `md`. Both sizes retain a minimum 44px target.
Focus, disabled, hover, active and dark styles are shared. Native `disabled`,
event handling, labels and form semantics remain the consumer's responsibility.
These button recipes are not intended for anchors; links have different native
disabled and interaction semantics.

Keep class names complete and include this library's source in each consumer's
Tailwind `@source` declarations. Extra layout classes can live at the call site;
the order of conflicting utilities in a class string does not define precedence.

Angular's adapter is `apps/web/app/src/app/ui/button.ts`: a directive on a native
button, used as `<button appUi variant="secondary" size="sm">…</button>`.
Astro's adapter is `apps/web/site/src/components/button.astro`: a server-rendered
component with the same visual options and native button attributes. Its recipe
does not ship to the browser. The isolated demo adds only native click handlers.

Try the Angular foundations at `/app/en/` or `/app/es/` and the Astro sample at
`/en/button/` or `/es/button/` through the gateway.

```sh
pnpm nx run-many -t lint,typecheck,typecheck-tests,test -p web-frontend-ui
pnpm nx run-many -t build,lint,typecheck,test -p web-app,web-site
pnpm nx run-many -t e2e -p web-app-e2e,web-site
```
