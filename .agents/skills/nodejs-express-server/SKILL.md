---
name: nodejs-express-server
description: >
  Canonical backend skill for changes to the existing Express/Node APIs,
  middleware, routing, authentication, and error handling in this repository.
  Preserve installed versions, domain boundaries, privacy, and approved scope.
---

# Node.js Express Server

## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Reference Guides](#reference-guides)
- [Best Practices](#best-practices)

## Repository Scope and Priority

- Read applicable repository instructions and inspect the existing Express/Nx project before proposing changes. Use installed versions and existing Nx targets; do not reselect frameworks or add dependencies for a routine edit.
- This is the canonical backend skill. Load `nodejs-backend-patterns` or `nodejs-best-practices` only for a specific unresolved question or an explicitly requested architecture comparison, not as parallel default workflows.
- Organize by business capability first, preserving Screaming Architecture and DDD boundaries. Keep domain logic independent of Express. Add layers, repositories, or dependency-injection containers only when the current problem requires them; ordinary constructor/function injection is enough otherwise.
- Apply KISS/YAGNI: choose the smallest verifiable change and follow the user's approval checkpoints. Examples are references, not permission to scaffold infrastructure, introduce authentication systems, create branches, or publish changes.
- Telemetry must use an explicit allowlist of technical events and bounded measurements. Never record client/business data, payloads, identifiers, raw URLs/query strings, IP addresses, user agents, tokens, raw errors, or stacks. Return fixed public error codes, not internal exception messages.

## Overview

Create robust Express.js applications with proper routing, middleware chains, authentication mechanisms, and database integration following industry best practices.

## When to Use

- Building REST APIs with Node.js
- Implementing server-side request handling
- Creating middleware chains for cross-cutting concerns
- Managing authentication and authorization
- Connecting to databases from Node.js
- Implementing error handling and logging

## Quick Start

Minimal working example:

```javascript
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  // Technical event only: never include the request or exception object.
  console.error({ event: 'request_failed' });
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Reference Guides

Detailed implementations in the `references/` directory:

| Guide                                                                                                            | Contents                                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [Basic Express Setup](references/basic-express-setup.md)                                                         | Basic Express Setup                              |
| [Middleware Chain Implementation](references/middleware-chain-implementation.md)                                 | Middleware Chain Implementation                  |
| [Database Integration (PostgreSQL with Sequelize)](references/database-integration-postgresql-with-sequelize.md) | Database Integration (PostgreSQL with Sequelize) |
| [Authentication with JWT](references/authentication-with-jwt.md)                                                 | Authentication with JWT                          |
| [RESTful Routes with CRUD Operations](references/restful-routes-with-crud-operations.md)                         | RESTful Routes with CRUD Operations              |
| [Error Handling Middleware](references/error-handling-middleware.md)                                             | Error Handling Middleware                        |
| [Environment Configuration](references/environment-configuration.md)                                             | Environment Configuration                        |

## Best Practices

### ✅ DO

- Use middleware for cross-cutting concerns
- Implement proper error handling
- Validate input data before processing
- Use async/await for async operations
- Implement authentication on protected routes
- Use environment variables for configuration
- Add only approved, allowlisted technical logging and monitoring
- Use HTTPS in production
- Implement rate limiting
- Keep route handlers focused and small

### ❌ DON'T

- Handle errors silently
- Store sensitive data in code
- Use synchronous operations in routes
- Forget to validate user input
- Implement authentication in route handlers
- Use callback hell (use promises/async-await)
- Expose stack traces in production
- Trust client-side validation only
