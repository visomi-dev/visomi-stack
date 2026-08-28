# Frontend Agent Guidance

These instructions apply to Angular frontend work in Themis. Read them before editing Angular components, routes, services, forms, templates, i18n, or frontend tests.

## Sources And Precedence

- The Angular v22 baseline is the official Angular AI guidance at `https://angular.dev/ai`, especially `https://angular.dev/ai/develop-with-ai` and `https://angular.dev/assets/context/best-practices.md`.
- Also follow the Angular style guide at `https://angular.dev/style-guide`, Signal Forms guidance at `https://angular.dev/guide/forms/signals/overview`, and effect guidance at `https://angular.dev/guide/signals/effect`.
- Recheck those sources when upgrading Angular because the official AI guidance changes with the framework.
- Themis-specific rules in this file take precedence where Angular offers multiple valid choices. Preserve the conventions of an existing file when they do not violate a mandatory repository rule.

## TypeScript

- Use strict type checking.
- Prefer type inference when the type is obvious.
- Avoid `any`; use `unknown` when the shape is uncertain.
- Prefer `type` over `interface`.
- Use `import type` for type-only imports.
- Mark stable dependencies, Angular-managed properties, signals, inputs, models, outputs, and queries as `readonly`.

## Angular Components

- Components are standalone by default. Do not create NgModules and do not set `standalone: true`.
- Do not set `changeDetection: ChangeDetectionStrategy.OnPush`; Angular v22 uses it by default.
- Keep components small, focused, and responsible for one UI concern.
- Do not create renderless initialization components, hidden controller components, or empty-template components merely to run side effects. Put view-owned lifecycle integration in the owning component, such as `Layout`, and domain state or operations in a focused service.
- Themis overrides Angular's general preference for inline templates: always use external templates and styles with relative `templateUrl` and singular `styleUrl` paths.
- Component class names are PascalCase nouns without a `Component` suffix.
- Component selectors use the `app-` prefix.
- Use the `host` property in `@Component`; do not use `@HostBinding` or `@HostListener`.
- Add `/* tw */` before Tailwind class strings in `host.class`.
- Use `input()`, `model()`, and `output()` signal functions. Do not use `@Input()` or `@Output()`.
- Use self-closing tags for components without projected content, such as `<app-navbar />` and `<router-outlet />`.
- Each component must keep companion `.html` and `.css` files with the same base name, even when the CSS file is empty.
- Group Angular-specific class fields near the top: injected dependencies, queries, inputs, models, outputs, and signals before methods.
- Use `protected` for members consumed only by the template. Keep implementation-only members `private`.
- Name event handlers for the action they perform, such as `saveProject()`, not for the event, such as `handleClick()`.
- Keep lifecycle hooks short, delegate to well-named methods, and implement the corresponding Angular lifecycle interface when a hook is required.
- Use `NgOptimizedImage` for static images, except inline base64 images.

## Signals And State

- Use `signal()` for local mutable state and `computed()` for derived state.
- Use `linkedSignal()` when state is derived but must also support deliberate local changes.
- Use `toSignal()` to convert Observables into signals.
- Never use `mutate` on signals; use `set` or `update`.
- Keep state transformations pure and predictable.
- Do not copy or propagate signal state with an effect when `computed()` or `linkedSignal()` can model the relationship.
- Effects are a last resort for synchronizing signal state with imperative, non-reactive APIs.
- Effects must be declared as descriptive `readonly` class properties, never created inside constructors. Examples include `setDeviceIdEffect`, `applyThemeEffect`, and `syncInputEffect`.
- Use `afterRenderEffect` for reactive DOM reads or writes that must happen after Angular renders. Select an explicit render phase; use `write` for DOM writes and never read layout in that phase.
- Use `afterNextRender` for one-time browser-only work after the first render.
- `afterRenderEffect`, `afterNextRender`, and `afterEveryRender` run only in the browser; do not add redundant `PLATFORM_ID` checks around work contained by those APIs.
- In the zoneless Angular app, async view state must use signals. Do not rely on plain mutable class properties for values that change after awaited work.
- Use `httpResource` from `@angular/common/http` for declarative component data fetching when appropriate.

## Services And Dependency Injection

- Design each service around one responsibility.
- Use `inject()` for dependency injection. Do not use constructor parameter injection.
- Mark injected dependencies as `private readonly` unless the template intentionally consumes the dependency, in which case expose only the narrow API required.
- New automatically provided singleton services use Angular v22's `@Service()` decorator.
- Use `@Injectable()` when the service requires explicit provider configuration, a non-root scope, or a platform-specific binding.
- Service classes are PascalCase nouns without a `Service` suffix, and service files use the bare kebab-case noun without a `.service` suffix.
- Keep writable signals private and expose readonly signals or computed state.
- Components should alias service signals as `readonly` class properties rather than duplicating service state.
- Register app-level abstractions in root `app.config.ts` providers. Use an abstract class or token with browser and server implementations when behavior differs by platform, and bind implementations with `useExisting`.
- Keep browser APIs inside browser-specific implementations. Prefer `DOCUMENT` and `document.defaultView` over direct global `window`, `document`, `navigator`, storage, or media-query access.
- Server implementations must remain deterministic and avoid browser APIs.
- Do not introduce a component solely to instantiate a service or trigger service initialization. Inject the service from the owning route/layout, or use `provideAppInitializer` only for genuine application bootstrap work that must finish before startup.
- Dynamic `import()` for external or heavy libraries is allowed only inside `shared/deps.ts`.

## Signal Forms

- Use stable Signal Forms from `@angular/forms/signals` for all new and existing production forms.
- Do not introduce `FormGroup`, `FormControl`, `FormBuilder`, `ReactiveFormsModule`, template-driven forms, `NgModel`, `compatForm`, or `SignalFormControl` in production code.
- Define a typed plain model, store it in a `signal()`, and create a typed `FieldTree<T>` with `form(model, schema, options?)`.
- Import and use `FormField` for `[formField]` bindings and `FormRoot` for `[formRoot]` bindings or the shared `<app-form>` wrapper.
- Define validation centrally in the Signal Forms schema with rules such as `required`, `email`, `minLength`, `maxLength`, `pattern`, and `validate`.
- Put cross-field validation on the dependent field with `validate` and `valueOf`; do not reintroduce group-level Reactive Forms validators.
- Keep validation messages in `$localize` strings with custom IDs. Read field errors from the field tree instead of duplicating validation conditionals in templates.
- Use Signal Forms `submission.action` for async submission and return field/server errors through the Signal Forms submission contract when applicable.
- Shared custom controls accept typed `Field<T>` inputs and keep value, touched, disabled, invalid, and accessibility state synchronized with the field.
- Use shared form primitives under `shared/ui/forms/` for repeated labels, help text, controls, and error presentation.
- Keep form accessibility stable: explicit labels, correct descriptions, stable button names, straightforward headings, focus handling, and errors associated with their controls.

## Templates

- Use native control flow: `@if`, `@for`, and `@switch`. Do not use `*ngIf`, `*ngFor`, or `*ngSwitch`.
- Keep templates simple; move complex or reusable logic into the component class, usually as a `computed()` value.
- Use Angular `animate.enter` and `animate.leave` for transition animations.
- Do not use `ngClass` or `ngStyle`; use native `class` and `style` bindings.
- Use Tailwind utilities directly in Angular templates for layout and visual styling. Do not introduce semantic or BEM-style CSS class names such as `auth-controls`, `auth-card__title`, or `password-strength__bar` in route templates.
- Custom semantic CSS classes are exceptional. They are allowed only inside reusable primitives when Tailwind cannot express the behavior cleanly, such as keyframes, `@starting-style`, reduced-motion overrides, or very small element-level selectors. Prefer `data-slot` and `data-od-id` for testing hooks instead of private CSS class names.
- Do not assume browser globals, such as `new Date()`, are available in templates.
- Do not write arrow functions in templates.
- Use the `async` pipe for Observables that are intentionally exposed to a template.

## Routing

- Use lazy loading for feature routes through `loadComponent`.
- Lazy-loaded import paths point directly to the `.ts` file. Do not use barrels or `/index`.
- Use functional route resolvers (`ResolveFn`) to load route-critical data before the component renders.
- Resolver files follow `name.resolver.ts` and live alongside the route that uses them.
- Use functional route guards (`CanActivateFn`, `CanDeactivateFn`, `CanMatchFn`) for authentication, authorization, and preconditions.
- Guard files follow `name.guard.ts`. Shared guards live under `shared/guards/`; route-specific guards live alongside the feature route.
- Guards that redirect must return a `UrlTree` or `RedirectCommand`; never return `false` and navigate imperatively.
- Use `import type` for router types.

## Internationalization

- Use Angular built-in `i18n` attributes for template translation markers.
- Always use custom IDs with the `@@` prefix. Do not rely on auto-generated IDs.
- Use `i18n-{attribute}` for translatable attributes.
- Custom IDs follow `@@{page}{Section}{Description}`, such as `@@homeHeroTitle`.
- Use `$localize`: ``$localize`:@@customId:Default text` `` for translatable strings in TypeScript.
- Run `pnpm nx run website:extract-i18n` when extraction is needed.

## Accessibility

- Angular UI must pass AXE checks when feasible.
- Meet WCAG AA minimums for keyboard operation, focus management, visible focus, color contrast, semantic structure, accessible names, and ARIA usage.
- Prefer semantic HTML before ARIA, and do not add redundant ARIA attributes.

## Frontend Architecture

- Organize code by product domain, not generic framework type folders.
- Route components live directly under their domain folder, such as `activation/`, `auth/`, or `projects/`.
- Reusable layout components live under `shared/layout/`.
- Shared services live directly in `shared/` or their product-domain folder.
- Shared form primitives live under `shared/ui/forms/`.
- Constants live under `shared/constants/`.
- Smart route components connect to services and routing. Reusable UI/layout components receive data via inputs and emit via outputs.
- Keep one primary concept per file and colocate each component's TypeScript, template, styles, and tests.

## Component And Form Tests

- Use Angular TestBed with the component under test in `imports`.
- Await `fixture.whenStable()` before assertions when setup can trigger async behavior or render effects.
- Test Signal Forms through typed host models and `FieldTree` bindings.
- Keep tests named in English and focused on observable behavior.
- Accessibility-sensitive controls should preserve labels, names, focus behavior, and invalid/error associations in tests.
