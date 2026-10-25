---
name: create-architectural-decision-record
description: 'Document an explicitly requested or agreed durable architecture decision with its context, alternatives, and consequences. Do not require an ADR for routine edits or every pull request.'
---

# Create Architectural Decision Record

Create an ADR for a durable decision that materially affects boundaries, dependencies, data handling, or long-term trade-offs. Confirm that an ADR is useful or requested before creating one. Follow applicable repository instructions, the existing domain-first architecture, privacy constraints, and user approval checkpoints. An ADR records a decision; it does not authorize implementation.

## Inputs

- **Context**: `${input:Context}`
- **Decision**: `${input:Decision}`
- **Alternatives**: `${input:Alternatives}`
- **Stakeholders**: `${input:Stakeholders}`

## Input Validation

If any of the required inputs are not provided or cannot be determined from the conversation history, ask the user to provide the missing information before proceeding with ADR generation.

## Requirements

- Use precise, unambiguous language
- Follow standardized ADR format with front matter
- Include both positive and negative consequences
- Document alternatives with rejection rationale
- Structure for machine parsing and human reference
- Prefer concise prose or bullets; coded identifiers are optional when an established template needs them

Use the repository's existing ADR location and naming convention. If none exists, propose a destination such as `docs/adr/` and agree it with the user before saving. Do not fabricate sequential numbers without checking existing records.

## Required Documentation Structure

Use the template below only as a starting point. Keep context, decision, alternatives, consequences, and status; omit irrelevant optional detail. Do not invent stakeholders, alternatives, metrics, or implementation notes to fill the template.

```md
---
title: 'ADR-NNNN: [Decision Title]'
status: 'Proposed'
date: 'YYYY-MM-DD'
authors: '[Stakeholder Names/Roles]'
tags: ['architecture', 'decision']
supersedes: ''
superseded_by: ''
---

# ADR-NNNN: [Decision Title]

## Status

**Proposed** | Accepted | Rejected | Superseded | Deprecated

## Context

[Problem statement, technical constraints, business requirements, and environmental factors requiring this decision.]

## Decision

[Chosen solution with clear rationale for selection.]

## Consequences

### Positive

- **POS-001**: [Beneficial outcomes and advantages]
- **POS-002**: [Performance, maintainability, scalability improvements]
- **POS-003**: [Alignment with architectural principles]

### Negative

- **NEG-001**: [Trade-offs, limitations, drawbacks]
- **NEG-002**: [Technical debt or complexity introduced]
- **NEG-003**: [Risks and future challenges]

## Alternatives Considered

### [Alternative 1 Name]

- **ALT-001**: **Description**: [Brief technical description]
- **ALT-002**: **Rejection Reason**: [Why this option was not selected]

### [Alternative 2 Name]

- **ALT-003**: **Description**: [Brief technical description]
- **ALT-004**: **Rejection Reason**: [Why this option was not selected]

## Implementation Notes

- **IMP-001**: [Key implementation considerations]
- **IMP-002**: [Migration or rollout strategy if applicable]
- **IMP-003**: [Monitoring and success criteria]

## References

- **REF-001**: [Related ADRs]
- **REF-002**: [External documentation]
- **REF-003**: [Standards or frameworks referenced]
```
