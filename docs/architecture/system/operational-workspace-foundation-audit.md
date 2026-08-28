# Operational Workspace Foundation Audit

**Item:** `THM-OWV-001`
**Status:** Foundation audit for review; not an implementation contract
**Authority:** This audit records the current repository evidence and the decisions that later workspace work must not silently change.

## Purpose and boundaries

The operational workspace is a read-only comprehension surface for project
context, attention, active work, validation, review, and meaningful activity.
It is not a replacement for Themis execution controls, sprint operations, or a
cloud plaintext authority.

This artifact covers vocabulary, trust classification, visual semantics,
authoritative sources and tokens, human-readable state/event translation, and
review gates. It deliberately does **not** implement Angular routes, APIs,
prototypes, mutations, sprint operations, or product redesign.

## 1. Canonical vocabulary

| Term                              | Canonical meaning                                                                                                           | Relationships                                                                                       | Must not be conflated with                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Project**                       | A durable, tenant-scoped body of context and work with an owner/read boundary.                                              | Contains epics/outcomes, work items, runs, evidence, reviews, and activity.                         | A repository, account, sprint, or dashboard summary.                       |
| **Epic / outcome**                | A coherent product or operational outcome that groups related work.                                                         | A project contains zero or more; work items may belong to one epic/outcome.                         | A sprint, label, milestone, or individual work item.                       |
| **Work item**                     | The smallest reviewable unit with intent, scope, acceptance criteria, dependencies, and lifecycle state.                    | Belongs to a project; may belong to an epic; can have runs, evidence, reviews, and activity.        | A task card, a run, an event, or a mutation command.                       |
| **Run**                           | One claimed execution attempt for one work item, with an executor and bounded evidence.                                     | Belongs to a work item; has start/finish state and attached evidence.                               | Overall work-item status, an agent identity, or a log line.                |
| **Evidence**                      | A factual observation attached to a run, such as a command result, diff, report, screenshot, or security observation.       | Belongs to a run; supports review and validation claims.                                            | A claim, a test intention, a review decision, or raw telemetry.            |
| **Review**                        | An independent comparison of implementation and evidence against the work-item contract.                                    | Requested for a work item after run completion; produces accepted/rejected feedback.                | A verifier run, an approval button, or a validation result.                |
| **Activity / event**              | An append-only record of a meaningful state change or observation, with actor and time.                                     | References a project-domain object when available; may be human or agent authored.                  | A current state, an audit narrative without provenance, or a notification. |
| **Attention**                     | A derived, human-oriented indication that a person should inspect something next.                                           | Derived from authoritative state, missing validation/evidence, blockage, staleness, or review need. | A severity-independent priority score, an error, or an automatic mutation. |
| **Blocked**                       | A state in which progress cannot safely continue because a dependency, decision, capability, or environment is unavailable. | Has a cause, authority, timestamp, and next useful action when known.                               | Merely slow, stale, rejected, or awaiting review.                          |
| **Validation**                    | A check or evidence category that tests a defined behavior or risk.                                                         | May be required or not applicable; its result contributes to confidence.                            | A review decision, a build alone, or a green visual accent.                |
| **Iteration / sprint (optional)** | A planning window that groups selected work and has its own goal and gates.                                                 | May contain work items; is secondary and never required for a useful workspace.                     | The project, an execution run, or a mandatory board view.                  |

### Canonical relationships

```text
project
  ├─ epic/outcome
  │    └─ work item
  │          ├─ run
  │          │    └─ evidence
  │          └─ review
  ├─ activity/event (references any available object)
  └─ optional iteration/sprint (selects work items)
```

The current state is a projection of authoritative records; it is not a new
record. Attention is a derived presentation; it cannot establish ownership,
authorization, completion, or review acceptance. A run can finish while its
work item remains in review or rework. Evidence can show a failed check without
changing the work-item lifecycle. A rejected review is not the same as blocked
work.

## 2. Public, operational, and protected classification

Classification describes the intended trust boundary, not every value exposed
by the starter implementation. Existing server-readable context and activity
are migration risks recorded in ADR 004 and the zero-knowledge security review.

| Domain object / fields                                                                             | Class                                                                         | Allowed readers                                                                                       | Authority and boundary                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Project identity: stable project identifier, approved display name, coarse visibility label        | Public or operational by field policy                                         | Public readers only for explicitly published fields; authorized tenant members for operational fields | Cloud may serve approved metadata; a name is not proof of project plaintext authority.                                                    |
| Project context: summary, documents, architecture, decisions, commands, environment notes          | Protected                                                                     | Authorized user through the local agent; product app only through an approved mediated read           | `themis-agent` is the plaintext authority. Cloud stores/ships ciphertext or an explicitly approved projection.                            |
| Epic/outcome identity, title, ordering, relationship IDs                                           | Operational; protected if title/context is not approved metadata              | Authorized tenant members and approved operational readers                                            | Cloud may hold minimized routing metadata; protected descriptions remain local-agent-authorized.                                          |
| Work-item identity, lifecycle state, scope labels, dependency IDs                                  | Operational by approved field; protected when content reveals project context | Authorized tenant members, verifier, reviewer, local agent, and product projection                    | State is authoritative only when sourced from the Themis control plane/local-authority path; UI must not infer it from color or presence. |
| Work-item intent, acceptance criteria, scope details, decisions, comments                          | Protected                                                                     | Authorized user, local agent, and narrowly scoped mediated projection                                 | Never treat the public site, external AI, logs, or cloud database as plaintext authority.                                                 |
| Run identity, actor identifier, start/finish timestamps, lifecycle result, coarse command category | Operational                                                                   | Authorized tenant members, verifier, reviewer, local agent                                            | Cloud may retain minimized event metadata under tenant policy; content-bearing output is protected or redacted.                           |
| Run command output, diagnostics, environment details, prompts, tool arguments                      | Protected                                                                     | Local agent and explicitly authorized verifier/reviewer projection                                    | Logs, queues, realtime, backups, and error payloads inherit the most restrictive carried class.                                           |
| Evidence kind, check category, pass/fail/blocked result, artifact pointer                          | Operational when minimized                                                    | Authorized tenant members, verifier, reviewer, local agent                                            | A result is a fact only with command/check, target, observed result, and report location. Artifact content may be protected.              |
| Evidence report, screenshot, diff, trace, fixture data                                             | Protected unless explicitly redacted and approved                             | Authorized reviewer/verifier and local agent; product app receives minimum projection                 | Do not expose secrets, project plaintext, participant data, or credentials through evidence.                                              |
| Review identity, reviewer role, requested/submitted timestamps, verdict                            | Operational                                                                   | Authorized tenant members, verifier, reviewer, local agent                                            | Review acceptance is independent authority; implementation agents cannot self-approve.                                                    |
| Review feedback, unresolved findings, security rationale                                           | Protected when it includes project or security detail                         | Authorized reviewer, security/product owners, local agent; minimized product projection               | A review verdict must not be fabricated from a test result or current status.                                                             |
| Activity/event envelope: event ID, type, actor class, object ID, timestamp, coarse visibility      | Operational                                                                   | Authorized tenant members and approved operational readers                                            | Append-only provenance is authoritative for what was recorded, not necessarily for plaintext meaning.                                     |
| Activity/event payload, narrative, tool output, error detail, protected references                 | Protected                                                                     | Local agent and explicitly authorized projection                                                      | External AI and cloud operators are not default readers; redact before telemetry or public output.                                        |
| State fields and visibility conditions: loading/empty/locked/unavailable/error/stale               | Operational presentation metadata                                             | Authorized reader of the containing object                                                            | The state must identify authority and freshness; unavailable is not empty and locked is not error.                                        |
| Event fields that disclose secrets, keys, credentials, raw context, or cross-tenant identifiers    | Protected                                                                     | Local agent/capability holder only                                                                    | Never place in public metadata, ordinary API responses, logs, queues, realtime messages, or screenshots.                                  |

**Reader rule:** tenant/session authorization proves web identity and tenant
membership; it does not prove device possession, project-key possession, or
permission to decrypt. The product app must not downgrade protected data to
operational merely to render a populated card.

## 3. Visual state semantics

Every state has a text label or accessible description and at least one
non-color cue: icon shape, pattern, border/rail, heading, timestamp, progress
indicator, or action text. Color is supportive, never the sole encoding.

| State          | Meaning                                                                              | Required non-color cue                                                 | User-facing implication                                             |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Loading        | The authoritative read has not completed.                                            | Skeleton/“Loading” label and preserved region heading.                 | Wait; do not infer absence or failure.                              |
| Empty          | The authorized query completed and contains no records.                              | “No [thing] yet” copy and empty illustration/spacing.                  | No action may be needed; distinguish from unavailable.              |
| Attention      | A derived next-inspection signal exists.                                             | “Needs attention” label, leading marker, and reason.                   | Inspect the cause; it does not authorize mutation.                  |
| Blocked        | Progress cannot continue safely.                                                     | Lock/barrier icon, reason, dependency or decision reference.           | Resolve or escalate the named blocker.                              |
| In progress    | Work or a check is actively executing.                                               | Spinner/progress indicator, actor, start time, and text.               | It may change; do not call it complete.                             |
| Locked         | Content exists but the current reader lacks the required capability or local unlock. | Lock icon plus “Locked” and no protected preview.                      | Request/restore authorized access; never show fabricated plaintext. |
| Unavailable    | The source cannot currently provide a trustworthy response.                          | Dashed/quiet boundary, “Unavailable,” source and retry/next-step text. | Do not treat as empty, blocked, or failed validation.               |
| Stale          | Data is validly known but older than the freshness policy.                           | “Updated [time]” plus stale marker/age.                                | Re-check before making a decision.                                  |
| Error          | The read/check failed or returned malformed data.                                    | Error icon, explicit error label, correlation/reference when safe.     | Retry or escalate; do not invent a state.                           |
| Validated      | A required check has an observed passing result.                                     | Checkmark plus check name, timestamp, and evidence link.               | Confidence is scoped to that check, not universal correctness.      |
| Review pending | Implementation evidence exists and independent review is awaited.                    | Review icon, “Review pending,” reviewer/queue and timestamp.           | A human review decision is still required.                          |
| Accepted       | Independent review accepted the scoped result.                                       | Checkmark/seal, verdict text, reviewer, and time.                      | Accepted for this scope; not a production/security release claim.   |
| Rejected       | Independent review found the result insufficient.                                    | Cross/flag, finding summary, reviewer, and time.                       | Read findings; work may move to rework.                             |
| Rework         | The item is being corrected after rejected review or changed contract.               | Loop/return marker, linked finding, and current run.                   | Do not treat prior evidence as proof of the revised result.         |

Light and dark modes must preserve contrast and the same semantic ordering.
Status styling should use the existing surface, text, border, and accent roles;
the exact palette source remains subject to the token authority decision below.

## 4. Authority and token inventory

### Data-source authority

| Displayed concept                     | Authoritative source now                                                                   | Target/read-model boundary                                                             | Caveat                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Project and document context          | Existing project/domain services and database seams, currently server-readable             | Local-agent-mediated plaintext read with a minimum projection                          | Current implementation is explicitly a migration risk, not target authority. |
| Epic/outcome and work-item definition | Themis work-item records and local Themis control-plane state                              | Versioned protected read model fed by authorized local-agent projection                | No API/read-model implementation is part of this item.                       |
| Work-item lifecycle                   | Themis state transition events and current work-item state                                 | Read model must preserve state, actor, timestamp, and provenance                       | UI must not derive lifecycle from runs or attention.                         |
| Run execution                         | Themis run record plus executor evidence                                                   | Local agent owns sensitive content; product receives minimized operational projection  | A run result cannot replace evidence.                                        |
| Evidence and validation               | Evidence attached to the run, with command/check and observed result                       | Versioned read model with report/screenshot references and redaction                   | Unit evidence does not satisfy API, visual, or security categories.          |
| Review verdict                        | Independent review record                                                                  | Read-only projection with reviewer identity/role, verdict, time, and feedback boundary | The implementation agent cannot supply independent authority.                |
| Activity/event history                | Append-only Themis events and attached activity records                                    | Mediated, tenant-scoped projection with encrypted sensitive payloads                   | Ordering, retention, compaction, and field visibility remain open.           |
| Attention                             | Derived from authoritative states, missing evidence, blockers, staleness, and review gates | Deterministic read-model derivation with reason and source references                  | Attention is not stored authority and must not trigger a mutation.           |
| Optional iteration/sprint             | Themis sprint records when present                                                         | Secondary read-model context; absent sprint must not degrade workspace usefulness      | Sprint planning/activation is out of scope.                                  |

### Website and design-token authority

| Authority layer                    | Repository location                                                                               | Role                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public visual intent               | `docs/design/design-system-reference.md`                                                          | Named “Slate & Syntax” light and “Night Edition” dark references, typography, and semantic token intent.       |
| Workspace token contract           | `docs/design-system/tokens.md`                                                                    | Current Tailwind v4 utility, surface ladder, typography, status, radius, shadow, and dark-mode usage contract. |
| Executable shared foundation       | `styles.base.css`                                                                                 | Actual shared font/radius/shadow/theme wiring and reusable `ui-*` utilities.                                   |
| Public website implementation      | `apps/web/site/src/styles/global.css` and Astro components                                        | Public-site consumption of the executable styling foundation.                                                  |
| Authenticated/prototype references | `apps/web/app/src/app/shared/ui/**` and `apps/web/ui-designer/src/prototypes/app-auth-shell.html` | Existing Catalyst-aligned component language and composition examples; not a new token authority.              |
| Accessibility contract             | `docs/design-system/accessibility.md` and `docs/architecture/adr/003-aria-foundation.md`          | Names, focus, touch target, dialog, listbox, and keyboard expectations.                                        |

**Known authority conflict:** the visual reference lists Slate & Syntax hex
tokens, while the current token contract describes raw Tailwind zinc/blue/
design-system owner must confirm whether the reference is intent-only, whether
the executable token contract is stale, or whether both are versioned for
different surfaces. Until then, use semantic roles and existing utilities;

## 5. Machine-to-human translation table

The product should show the human meaning and causal context, not a raw enum.
Where authority or freshness is uncertain, the caveat is part of the message.

| Machine state/event     | Human-readable meaning                           | Causal context                                                           | Actor                | Time         | Next useful action                                     | Confidence / authority caveat                                           |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------- | ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `work_item.in_progress` | “Work is in progress.”                           | A run is active or the item is being executed.                           | Executor identity    | Started at   | Inspect current run and latest evidence.               | Current control-plane state; not proof of success.                      |
| `work_item.blocked`     | “Work is blocked: [reason].”                     | Dependency, capability, environment, or decision prevents safe progress. | State-changing actor | Changed at   | Open blocker reference or escalate to owner.           | Trust only with an authoritative event and reason.                      |
| `run.completed`         | “The execution run finished.”                    | The executor ended this attempt.                                         | Executor             | Finished at  | Review attached evidence and required validation.      | Does not mean the work item is accepted.                                |
| `validation.failed`     | “Validation failed: [check].”                    | Observed command/check returned a failing result.                        | Verifier/executor    | Observed at  | Read report and address the finding.                   | Scoped to the check; report is required.                                |
| `validation.blocked`    | “Validation could not run: [blocker].”           | Environment or dependency prevented observation.                         | Verifier             | Attempted at | Restore environment and rerun; keep blocked status.    | Must not be translated to pass or fail.                                 |
| `validation.passed`     | “Validation passed for [category].”              | Required check has a recorded observed result.                           | Verifier             | Observed at  | Confirm all required categories, not only this one.    | Category-scoped confidence; no universal quality claim.                 |
| `evidence.added`        | “Evidence was recorded for [check/observation].” | A factual artifact was attached to a run.                                | Agent/verifier       | Recorded at  | Open report, diff, screenshot, or command output.      | Evidence provenance and redaction still apply.                          |
| `review.requested`      | “Independent review is pending.”                 | Run finished and implementation/verification evidence exists.            | Coordinator          | Requested at | Wait for the named reviewer.                           | No acceptance authority yet.                                            |
| `review.accepted`       | “Independent review accepted this scope.”        | Reviewer compared implementation and evidence to the contract.           | Reviewer             | Decided at   | Treat the item as review-approved; follow later gates. | Not a production release or security sign-off.                          |
| `review.rejected`       | “Review found work to correct.”                  | Reviewer recorded actionable findings.                                   | Reviewer             | Decided at   | Read findings and enter rework.                        | Rejection is authoritative for review, not necessarily all validations. |
| `work_item.rework`      | “Work is being corrected after review.”          | A rejected review or contract change requires a new result.              | Executor             | Entered at   | Address linked findings and produce fresh evidence.    | Prior evidence may not cover revised scope.                             |
| `read.locked`           | “This project context is locked.”                | The reader lacks an authorized local capability/unlock.                  | Local agent / policy | Observed at  | Unlock or request approved access.                     | No plaintext preview; cloud response is not authority.                  |
| `read.unavailable`      | “Project context is temporarily unavailable.”    | Source did not provide a trustworthy response.                           | Source/gateway       | Observed at  | Retry or inspect source health.                        | Not evidence of emptiness, blockage, or deletion.                       |
| `read.stale`            | “This view was last updated [time].”             | Data exceeds the freshness policy.                                       | Source               | Last updated | Refresh before deciding.                               | Known data with reduced recency confidence.                             |
| `activity.recorded`     | “[Actor] recorded [meaningful event].”           | Append-only event references a domain object.                            | Human or agent       | Event time   | Follow the object/evidence link.                       | Human-readable detail may be redacted or locally authoritative.         |

## 6. Open decisions, risks, and review gates

These are intentionally open. Later work must link a decision or create a
scoped follow-up rather than choosing silently.

| ID        | Open decision/risk                                                                                                                                                              | Owner needed                                 | Gate                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `OWV-D01` | Resolve the conflict between Slate & Syntax reference tokens and the raw Tailwind utility contract.                                                                             | Design-system owner                          | Human token review before prototype or Angular styling.                                                   |
| `OWV-D02` | Approve the exact public versus operational metadata fields, including project names, IDs, state, timestamps, labels, and sizes.                                                | Product and security owners                  | Security classification review before a read model exposes fields.                                        |
| `OWV-D03` | Choose the mediated product-read architecture: browser agent, local daemon/IPC, encrypted client custody, or another design, including offline and browser-compromise behavior. | Product and platform owners                  | Architecture/security sign-off before protected context is rendered.                                      |
| `OWV-D04` | Define activity privacy, retention, compaction, deletion, and whether narratives/evidence are encrypted or projected.                                                           | Product, security, and data-lifecycle owners | Data-lifecycle review before timeline implementation.                                                     |
| `OWV-D05` | Define freshness policy and source outage semantics for stale, unavailable, empty, and error.                                                                                   | Platform owner                               | Contract review before UI state mapping is frozen.                                                        |
| `OWV-D06` | Define the minimum human-readable translation payload and how actor identity is shown without exposing protected data.                                                          | Product and security owners                  | Comprehension and security review before prototype evaluation.                                            |
| `OWV-D07` | Decide whether optional sprint/iteration is only metadata or a first-class read-model relationship.                                                                             | Product owner                                | IA review; no sprint may remain a valid primary state.                                                    |
| `OWV-R01` | Current server-readable project context/activity, secondary queues, realtime payloads, logs, fixtures, and backups may disclose protected plaintext.                            | Migration/data owners                        | Existing ZK security review remains blocked; no workspace surface may normalize this as target authority. |
| `OWV-R02` | A visual status cue can be mistaken for an authority or completion signal.                                                                                                      | Design and security reviewers                | Visual review must inspect text, provenance, timestamps, and non-color cues.                              |
| `OWV-R03` | A derived attention queue can become an implicit priority or mutation system.                                                                                                   | Product owner                                | UX review must keep reasons, source links, and read-only behavior explicit.                               |

### Required review gates

1. **Vocabulary gate:** product/architecture review confirms relationships and
   prohibited conflations.
2. **Trust gate:** security review confirms classification, local-agent
   authority, disclosure limits, and no cloud-plaintext fallback.
3. **Token/state gate:** design-system review checks light/dark tokens,
   contrast, and non-color semantics against the named sources.
4. **Comprehension gate:** human evaluation confirms that attention, blockage,
   agent work, validation gaps, changes, and review decisions are understood.
5. **Read-boundary gate:** API/read-model owners define versioning,
   authorization, redaction, freshness, and locked/unavailable/error behavior.

No gate is satisfied by this audit alone. The artifact is a foundation input
for later work and remains review-pending until an independent reviewer and the
named human owners accept the applicable decisions.
