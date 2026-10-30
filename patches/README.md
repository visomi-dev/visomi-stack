# Astro runtime policy patches

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
Docker dependency installs and hashed by the site build. Keep the pinned
versions until replacement releases pass the same import-safety, rejection,
stream-cancellation and request-error regressions. Do not remove the patches
merely because the upstream package installs successfully.
