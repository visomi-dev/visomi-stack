# Error Handling Middleware

Follow the canonical `nodejs-express-server` skill and the repository's approved error contract. Never serialize exception objects, raw messages, stacks, request data, or validation issues into responses or telemetry. Use explicit fixed public codes; add field-level feedback only through an approved static mapping.

```javascript
class ValidationError extends Error {}

// Register routes first, then the 404 handler and error middleware.
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    // Do not pass the original error to a default handler that may log it.
    res.destroy();
    return;
  }

  if (err instanceof ValidationError) {
    return res.status(400).json({ error: 'VALIDATION_FAILED' });
  }

  // Allowlisted technical event only. Never include err or req.
  console.error({ event: 'request_failed' });
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
});
```

Map additional known application errors explicitly to fixed codes and statuses when required by the existing API. Do not infer a safe public message from an arbitrary exception or trust an arbitrary `statusCode`.
