# Frontend SSR runtime policy patches

The pinned `@astrojs/node` middleware installs a process-wide rejection listener
when imported and logs raw request URLs and exceptions from its error handlers.
The adapter patch removes that listener, delegates middleware errors to Express,
and resolves the configured logger before accepting requests. Without an Express
callback, the standalone fallback emits a fixed error code.

The Astro patch replaces raw URL/exception output when response cancellation
fails with a fixed diagnostic. Request conversion, streaming, abort cleanup and
the official adapter's build behavior are retained.

The site's logger accepts only severity and emits controlled event codes. It
does not forward framework messages, labels, URLs or exception details.

These patches are applied through pnpm's `patchedDependencies`, included in
Docker dependency installs and hashed by frontend and gateway builds. Keep the pinned
versions until replacement releases pass the same import-safety, rejection,
stream-cancellation and request-error regressions. Do not remove the patches
merely because the upstream package installs successfully.

The pinned `@angular/ssr` patch keeps process failure handling with the executable,
even after the first Angular render. It removes implicit raw-error process
listeners, preserves host validation while returning a fixed JSON 400, replaces
redirect/critical-CSS diagnostics with a controlled render-failure event, and
keeps stream cancellation best effort without logging request URLs or errors.
The current application uses `AngularNodeAppEngine`; CommonEngine is not part of
the supported composition. Keep this patch until upstream behavior passes the
real compiled SSR listener/host-validation and response-cancellation regressions.
