# ADR: First-Run Activation Frontend

## Status

Proposed

## Context

The current authenticated Angular surface is a placeholder. The product now needs a first-run experience that reflects the real activation task for technical users.

The previous onboarding idea was a step-by-step flow. That model creates avoidable friction because most users will skip explanatory setup steps and look for the shortest path to a working integration.

The frontend must support:

- a single-screen activation page
- API key creation with one-time reveal handling
- copyable MCP configuration
- copyable seed prompt
- lightweight progress feedback
- a non-blocking skip path into the product

## Decision

The Angular app will implement onboarding as a single first-run activation route rather than a wizard.

The route will render three setup actions in one page:

1. create API key
2. copy MCP configuration
3. copy seed prompt

The frontend will treat activation as a route-level product surface, not as a modal or tooltip tour.

## Rationale

- one route is easier to understand, test, and revisit than a transient wizard
- action sections match the real setup tasks the user must perform
- copy-centric UX fits the editor and terminal workflow of the target user
- skippable activation avoids introducing a mandatory ceremony before product access
- route ownership stays aligned with the Angular app's responsibility for authenticated flows

## Detailed Frontend Shape

### Route Model

Recommended route additions inside `apps/web/app`:

- `/app/activate` as the dedicated first-run activation route
- existing home or dashboard route as the post-activation destination

Recommended behavior:

- authenticated users with incomplete activation may be redirected to `/app/activation` on first entry
- users can skip activation and continue into the product
- users can revisit `/app/activation` later from settings or workspace setup

### Component Structure

Recommended page ownership:

- `activation/activation.ts` as the route component directory under `apps/web/app/src/app/activation/`

Recommended local child components if needed:

- `api-key-card/`
- `mcp-setup-card/`
- `seed-prompt-card/`

If the page remains small, keep the implementation in a single route component and avoid premature decomposition.

### State Model

The page should use signal-based async UI state.

Recommended state groups:

- activation status payload from the API
- API key creation request state
- one-time secret reveal state
- copy feedback per section
- optional local acknowledgement state such as "I connected MCP"

The page should avoid plain mutable class properties for async feedback.

### Data Loading

Activation status should be loaded before the route renders important decisions.

Recommended direction:

- use a route resolver for the activation payload if the route needs immediate server-backed state
- keep the payload narrow and operational
- avoid embedding secret values in preload payloads except the one-time API key creation response

### Interaction Design

The page should:

- prioritize API key creation as the main action
- present MCP config in a copy-friendly code block
- present the seed prompt in a copy-friendly text block
- surface concise completion badges or status labels
- keep the skip action visible but secondary

### Feedback Rules

Required feedback states:

- loading
- ready
- copied
- key created
- server error
- skipped or continue later

Feedback copy should be short and operational.

### Mobile Behavior

The page should stack all setup cards vertically by default and enhance into a denser layout on larger screens.

The screen must remain usable on laptop-sized terminals and smaller mobile viewports.

## Consequences

### Positive

- simpler user journey than a wizard
- easier route testing with Playwright
- clearer ownership inside the Angular app
- activation logic remains durable and revisitable

### Negative

- frontend cannot truly verify local MCP installation from the browser
- a single route can become cluttered if too many setup actions are added later
- server payload design must stay disciplined to avoid turning the page into a dashboard surrogate

## Rejected Alternatives

### Multi-Step Wizard

Rejected because it optimizes for guided explanation instead of fast activation.

### Modal On Top Of The App

Rejected because it is easier to dismiss accidentally, harder to revisit intentionally, and less stable for a setup sequence with copyable content.

### Tooltip Tour Of The Main Product

Rejected because the user has not yet connected the integration that gives the product its real value.

## Testing Impact

Frontend coverage should include:

- first authenticated visit redirected to activation when required
- skip path into the product
- API key creation success and one-time reveal behavior
- copy actions for MCP config and seed prompt
- re-entry into activation after partial completion

## Follow-Up Work

- define exact activation route constants
- define activation resolver payload contract with backend
- implement page layout in Angular
- add end-to-end coverage for first-run activation
