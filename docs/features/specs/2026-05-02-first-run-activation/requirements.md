# First-Run Activation — Requirements

## Feature

Replace step-by-step onboarding with a single first-run activation screen. Move the user from "signed in" to "workspace connected" in one screen.

Source docs: [product/onboarding-activation-prd.md](../../product/onboarding-activation-prd.md)

## User Stories

1. As a newly authenticated user, I land on a single activation screen (not a wizard)
2. As a user, I can create an API key with a one-time reveal
3. As a user, I can see MCP configuration instructions for OpenCode
4. As a user, I can copy a ready-to-use MCP configuration snippet
5. As a user, I can copy a seed prompt to initialize my project in Themis
6. As a user, I can skip activation entirely and still reach the app

## Acceptance Criteria

### Activation Screen

- [ ] Shown after first successful authentication (no prior activation)
- [ ] Not shown to users who have already completed activation
- [ ] Single screen with three compact sections (API key, MCP setup, seed prompt)
- [ ] Calm, technical, operational feel (not tutorial-like)
- [ ] Can be skipped at any time

### API Key

- [ ] `POST /api/activation/api-keys` creates a key
- [ ] Key is split-token: public ID + hashed secret
- [ ] One-time reveal: secret shown once, never stored plaintext
- [ ] Can revoke and create new keys
- [ ] List existing keys (public IDs only)

### MCP Setup

- [ ] Display copyable MCP configuration JSON
- [ ] Configuration includes API key ID and base URL
- [ ] Instructions reference OpenCode MCP setup location
- [ ] Copy button for the configuration block

### Seed Prompt

- [ ] `GET /api/activation/seed-prompt` returns backend-owned template
- [ ] Display copyable seed prompt text
- [ ] Prompt instructs agent to seed project context via MCP

### Milestones

- [ ] Track completion: `api_key_created`, `mcp_config_copied`, `mcp_marked_connected`, `seed_prompt_copied`, `activation_skipped`
- [ ] Milestones stored in `user_activation_milestones` table
- [ ] `POST /api/activation/milestones` records milestones
- [ ] Milestone events are append-only (event sourcing style)

## Scope

### In Scope

- Single activation screen after first auth
- API key creation and management
- MCP configuration copy
- Seed prompt copy
- Milestone tracking
- Skip path to product

### Out of Scope

- Guided tours / interactive walkthroughs
- Multi-step wizards
- Automatic local MCP verification from browser
- Importing repository contents from frontend in V1
- Organization-level admin provisioning

## Edge Cases

- User closes browser during activation: resume where left off on next visit
- User skips activation: can return later from settings
- API key already exists: show existing keys, offer revoke + recreate
- MCP connection never verified: frontend cannot verify, this is acknowledged
