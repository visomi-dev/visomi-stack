# ADR: First-Run Activation Backend

## Status

Proposed

## Context

The new first-run flow depends on backend-owned state and secure credential handling.

The browser can guide the user through setup, but the backend must remain the source of truth for:

- whether activation should be shown
- API key lifecycle
- milestone persistence
- seed prompt payload generation
- authenticated ownership of all setup resources

The backend already owns session-backed authentication. First-run activation should extend that same model rather than introducing a client-only onboarding state.

## Decision

The backend will expose a dedicated activation surface for authenticated users.

This surface will provide:

- activation status payload
- API key creation endpoint with one-time secret reveal
- milestone recording endpoint or server-side milestone recording during relevant actions
- seed prompt payload generation

Activation state will be persisted server-side and associated with the authenticated user.

## Rationale

- first-run setup state should not depend on local storage alone
- API keys require server-side generation, hashing, and auditing
- activation milestones should be queryable for product analytics and support workflows
- server-owned activation status allows consistent behavior across sessions and devices

## Backend Shape

### Ownership

`apps/web/api` should own activation endpoints and persistence.

`apps/web/server` continues to own same-origin composition and session-friendly delivery, but it should not absorb activation business logic.

### Recommended Endpoints

Recommended V1 endpoint shape:

- `GET /api/activation`
- `POST /api/activation/api-keys`
- `POST /api/activation/milestones`
- `GET /api/activation/seed-prompt`

Possible future endpoint:

- `GET /api/activation/mcp-config`

If the MCP config is entirely derived from stable backend values plus a one-time API key response, it can also be assembled in the frontend from the activation payload.

### Activation Status Payload

The status payload should be compact.

Recommended fields:

- `shouldActivate`
- `hasApiKey`
- `hasCopiedMcpConfig` or equivalent milestone summary
- `hasMarkedMcpConnected`
- `hasCopiedSeedPrompt`
- `canSkip`
- `recommendedNextAction`

The payload should not include full secret material.

### API Key Model

API keys should follow a standard split-token pattern.

Recommended model:

- generate a public identifier for the key
- generate a secret token shown once to the user
- store only a hashed representation of the secret token server-side
- associate the key with the authenticated user
- support revocation later even if V1 only needs creation

Recommended fields:

- `id`
- `user_id`
- `label`
- `token_prefix`
- `token_hash`
- `last_used_at`
- `revoked_at`
- `created_at`

### Activation Milestones Model

Activation progress should be stored explicitly.

Recommended table direction:

- `user_activation_milestones`

Recommended fields:

- `id`
- `user_id`
- `milestone`
- `recorded_at`
- `metadata_json`

Recommended milestone values for V1:

- `api_key_created`
- `mcp_config_copied`
- `mcp_marked_connected`
- `seed_prompt_copied`
- `activation_skipped`

This event-style model is preferable to one large mutable onboarding row because it preserves intent and sequence.

### Seed Prompt Generation

The backend should return a ready-to-copy prompt template for V1.

The first version can be static text with light interpolation such as:

- workspace or user name
- API hostname reference
- optional project import guidance

The prompt generator should remain backend-owned so future variants can change without requiring a frontend redeploy.

## Security Considerations

- API key secret must be revealed only once at creation time
- plaintext keys must never be persisted after response generation
- activation endpoints must require an authenticated session
- milestone endpoints must validate allowed values server-side
- server logs must avoid secret exposure
- copy events recorded by the backend should be treated as product signals, not proof of local setup success

## Consequences

### Positive

- activation behavior remains consistent across devices
- API keys use a secure lifecycle from the beginning
- milestone data becomes available for analytics and support operations
- future setup variants can be rolled out with server-driven logic

### Negative

- more backend surface area than a client-only onboarding screen
- copy and local setup milestones remain partial proxies for real local completion
- event storage introduces another product table early in development

## Rejected Alternatives

### Client-Only Activation State

Rejected because it breaks across devices and cannot securely represent API key lifecycle.

### Reusing Auth Tables For Activation State

Rejected because activation milestones have different semantics from authentication concerns and should not be overloaded into auth records.

### Hard Boolean `onboarded` Flag

Rejected because it loses step-level signal and makes partial completion invisible.

## Implementation Notes

Recommended implementation order:

1. activation status endpoint
2. API key persistence and creation endpoint
3. milestone recording
4. seed prompt endpoint
5. later key revocation and settings management

## Follow-Up Work

- define Drizzle schema for API keys and activation milestones
- align endpoint contracts with Angular route needs
- define audit logging for API key creation and later usage
- document how OpenCode MCP should authenticate against Themis APIs
