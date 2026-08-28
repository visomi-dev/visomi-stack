# Backend Content Model: Themis

## Purpose

This document defines the recommended backend content model for Themis.

## Short Answer

Yes, markdown should be used, but not as the only source of truth.

Recommended direction:

- use markdown for rich long-form task and project documentation
- use the application database for structured metadata, workflow state, relationships, permissions, and querying
- version markdown-backed content explicitly inside the product

## Hybrid Model

### Use Markdown For

- project briefs
- task descriptions
- problem statements
- outcome definitions
- scope notes
- decisions
- update narratives
- agent-readable long-form context

### Use The Database For

- ids
- status
- priority
- owner
- labels
- relationships
- project membership
- timestamps
- filtering fields
- audit records
- permissions
- version metadata

## Canonical Model

The database is the canonical operational source.

Markdown is the canonical narrative format for long-form content fields.

That means:

- the product does not rely on filesystem files as its main store
- markdown content is stored and versioned in the database
- the UI renders and edits markdown content through structured fields
