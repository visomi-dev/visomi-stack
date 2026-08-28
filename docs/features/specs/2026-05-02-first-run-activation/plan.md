# First-Run Activation — Implementation Plan

## Data Model

### `api_keys`

| Column       | Type              | Notes                          |
| ------------ | ----------------- | ------------------------------ |
| id           | text (PK)         | Public key ID (e.g., `ak_xxx`) |
| user_id      | uuid (FK → users) |                                |
| key_hash     | text              | Hashed secret, never plaintext |
| name         | text              | Optional label                 |
| last_used_at | timestamp         | nullable                       |
| expires_at   | timestamp         | nullable                       |
| revoked_at   | timestamp         | nullable                       |
| created_at   | timestamp         |                                |

### `user_activation_milestones`

| Column      | Type              | Notes                                                                                                              |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| id          | uuid (PK)         |                                                                                                                    |
| user_id     | uuid (FK → users) |                                                                                                                    |
| milestone   | text              | 'api_key_created' \| 'mcp_config_copied' \| 'mcp_marked_connected' \| 'seed_prompt_copied' \| 'activation_skipped' |
| recorded_at | timestamp         |                                                                                                                    |
| metadata    | jsonb             | Additional context                                                                                                 |

## API Endpoints

| Method | Path                              | Purpose                                          |
| ------ | --------------------------------- | ------------------------------------------------ |
| GET    | `/api/activation`                 | Get activation state (milestones, existing keys) |
| POST   | `/api/activation/api-keys`        | Create new API key                               |
| GET    | `/api/activation/api-keys`        | List API keys (public IDs only)                  |
| DELETE | `/api/activation/api-keys/:keyId` | Revoke API key                                   |
| POST   | `/api/activation/milestones`      | Record milestone                                 |
| GET    | `/api/activation/seed-prompt`     | Get seed prompt template                         |

## Angular Routes

| Path            | Purpose                     |
| --------------- | --------------------------- |
| `/app/activate` | First-run activation screen |

## Route Logic

- `activationGuard`: checks `GET /api/activation` — if user has no milestones (first auth), redirect to `/app/activate`
- If user has milestones (returning), skip `/app/activate` and go to `/app`
- `/app/activate` is accessible from settings for users who skipped

## Implementation Steps

1. Define Drizzle schema for `api_keys` and `user_activation_milestones`
2. Generate and apply migrations
3. Implement API key service (create with split-token, hash secret, one-time reveal)
4. Implement milestone service (append-only events)
5. Implement seed prompt template endpoint (server-owned template)
6. Build API route handlers
7. Build Angular activation component with three sections
8. Implement activation guard and first-auth detection
9. Wire settings entry point for returning to activation

## Security

- Split-token model: `ak_<public_id>.<secret>` — public ID stored in DB, secret hashed
- One-time reveal: secret returned only on creation response
- Never log or persist plaintext secrets
- Authenticated session required for all activation endpoints

## Frontend Design

- Single screen, three compact sections
- API key: create button → one-time reveal with copy + dismiss
- MCP config: JSON block with copy button, instructions text
- Seed prompt: text block with copy button, brief explanation
- Skip link always visible
- Calm, technical aesthetic aligned with existing auth UI
