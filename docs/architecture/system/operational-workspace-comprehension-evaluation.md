# Operational Workspace Comprehension Evaluation

**Item:** `THM-OWV-004`
**Run:** `RUN-147`

This structured evaluator walkthrough used the approved phase-3 prototype with synthetic, redacted fixtures. One evaluator completed 18 task runs: six required questions across mobile (375px), tablet (768px), and desktop (1280px), covering workspace, work-item detail, validation/evidence, timeline, and loading, empty, stale, locked, unavailable, error, blocked, evidence-missing, active-execution, and review states. It is not a claim of a statistically representative user study.

## Measures

| Question                    | Median | Errors | Ignored elements                 | State confusion          | Signal  |
| --------------------------- | -----: | -----: | -------------------------------- | ------------------------ | ------- |
| What needs attention?       |    21s |      0 | control-plane freshness          | —                        | Useful  |
| What is blocked?            |    29s |      1 | changed time                     | blocked vs rejected      | Useful  |
| What did the agent do?      |    34s |      1 | latest evidence                  | run complete vs accepted | Useful  |
| What validation is missing? |    38s |      2 | redaction boundary, exact target | missing vs unavailable   | Unclear |
| What changed?               |    26s |      0 | event ID                         | —                        | Useful  |
| Can I decide acceptance?    |    31s |      0 | reviewer role                    | —                        | Useful  |

Mobile stayed answerable without horizontal scroll, but evidence needed one extra scroll. Tablet stayed scannable while the state gallery competed with evidence below the fold. Desktop was fastest for workspace; detail-sidebar authority cues were less prominent.

## Findings and decisions

- **High / state-event:** blocked was initially read as rejected. Revise blocker cause and changed time immediately after the label.
- **High / authority:** a run summary was read as acceptance. Add “Run status is not work-item acceptance.”
- **High / flow:** missing evidence was confused with an unavailable source. Add a missing/source/protected-artifact summary before the evidence list.
- **Medium / visual:** reviewer role was skipped on desktop. Accepted risk: Angular must keep role beside verdict and timestamp in the first review block.
- **Medium / vocabulary:** “inspection need” implied priority once. Change to “inspection context” and repeat that attention is not a priority score.
- **Low / visual:** event ID was ignored while provenance worked. Keep it as a secondary support cue.

Four evidence-backed prototype revisions were made before Angular. Accepted risks and Angular handoff constraints are recorded in the JSON companion.

## Privacy and traceability

No participant identity, tenant secret, credential, protected report, prompt, or raw project context was captured. Locked states show no protected preview; attention remains derived/read-only; review acceptance remains independent and has no self-approval control. The evaluation traces to the phase-1 audit, phase-2 flow specification/manifest, and revised phase-3 prototype named in the JSON record. Angular remains gated on review of these findings.
