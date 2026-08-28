# First-Run Activation — Validation

## Automated Tests

### API E2E

```bash
pnpm exec nx run api-e2e:e2e
```

Must cover:

- `GET /api/activation` returns state with milestones and keys
- `POST /api/activation/api-keys` creates key, returns one-time secret
- `GET /api/activation/api-keys` lists keys (no secrets)
- Re-creating key after revoke works
- `POST /api/activation/milestones` records milestone
- `GET /api/activation/seed-prompt` returns template
- Unauthenticated requests to activation endpoints return 401

### Playwright E2E

```bash
pnpm exec nx run app-e2e:e2e
```

Must cover:

- New user lands on `/app/activate` after first sign-in
- Returning user (has milestones) bypasses `/app/activate` and goes to `/app`
- API key create → reveal → copy flow
- MCP config copy button works
- Seed prompt copy button works
- Skip button navigates to `/app`
- Milestone "activation_skipped" recorded on skip

## Manual Validation

### Prerequisites

- Fresh user with no prior activation
- Running composed server with PostgreSQL

### Checklist

**First Auth → Activation**

- [ ] Sign up with new email, verify PIN
- [ ] After verification, land on `/app/activate` (not `/app`)
- [ ] Confirm three sections visible: API key, MCP setup, seed prompt

**API Key Flow**

- [ ] Click "Create API Key"
- [ ] See one-time reveal with full key
- [ ] Copy key, dismiss reveal
- [ ] Confirm key appears in list (public ID only, no secret)
- [ ] Create second key, confirm both listed
- [ ] Revoke first key, confirm it disappears from list

**MCP Config**

- [ ] See JSON config block with base URL and API key ID
- [ ] Click copy, confirm content in clipboard
- [ ] Instructions reference OpenCode MCP config location

**Seed Prompt**

- [ ] See seed prompt text block
- [ ] Click copy, confirm content in clipboard
- [ ] Prompt references project seeding via MCP

**Skip**

- [ ] Click skip, navigate to `/app`
- [ ] Sign out, sign in again
- [ ] Confirm bypass `/app/activate` and go directly to `/app`

**Return to Activation**

- [ ] Navigate to `/app/activate` from settings or URL
- [ ] Confirm existing state is preserved (keys shown, milestones recorded)
