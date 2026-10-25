---
name: financial-product-ux
description: Review and improve financial-product navigation, information hierarchy, dark surfaces, mobile spacing, and concise copy without weakening financial correctness or privacy warnings.
---

# Financial Product UX

Use this skill for financial dashboards, budgeting, accounts, transaction flows, and financial UI reviews.
Read `references/research.md`, repository frontend/design guidance, and the browser-vault decision first.

## Workflow

1. Inspect the actual routes, shared primitives, translations, and the PR diff. Record findings by severity
   with paths and lines. Passing snapshots are not product-owner approval or proof of good hierarchy.
2. Identify each screen's user question, primary amount/status, and next action. Put these before general help.
3. Group navigation by user purpose: finances, household, settings. Keep groups shallow, with explicit
   labels and real destinations. Settings should contain profile, security, and devices, not the main money flow.
4. Use distinct, consistent outline icons (wallet, shield, person, devices, household). Keep visible text
   in normal navigation. Icon-only utilities need accessible names, visible focus, and 44px touch targets.
   A bell may represent notifications; retain sync status and required actions on its destination.
5. Put navigation collapse beside the page toolbar, not in an isolated row beneath the brand.
   Check expanded, collapsed, mobile, active-route, direct-link, and keyboard behavior.
6. Use different canvas, card, and raised-control tones in BOTH themes. Inspect computed backgrounds
   in context: changing a token alone does not fix a parent and child using the same token.
   Do not imply WCAG requires a 3:1 contrast between every decorative card and its canvas.
7. Use at least `p-0.5` outer mobile inset; normally use 12–16px readable content gutters and respect
   safe-area insets. Check 320px, 390px, tablet, desktop, zoom, long Spanish labels, and horizontal overflow.
8. Reduce repeated intros, taglines, setup forms, and implementation vocabulary. Show routine help on demand
   through clearly labeled native details or existing disclosure primitives. Do not hide recovery-key loss,
   external-provider access, stale totals, pending writes, destructive consequences, fees, or transaction errors.
9. Keep date, currency, period, realized/planned distinctions, and exact amounts visible near the relevant data.
   Never change arithmetic, access control, or plaintext boundaries as a visual cleanup.
10. Add interaction and accessibility regressions, run focused Nx lint/unit/build/E2E targets, and visually
    review screenshots before updating baselines. Record failures and limitations honestly.

## Review checklist

- Can users identify the financial result and primary action without reading an essay?
- Are unrelated setup controls absent from transaction, budget, and overview screens?
- Can every destination still be reached with keyboard/touch, including a collapsed sidebar?
- Do navigation links preserve the selected financial scope without leaking it to unrelated settings?
- Are cards distinguishable from the page in dark mode, and warnings distinguishable without color alone?
- Are both locales concise, accurate, and consistent, with no unlabeled icon-only actions?
- Have existing consumers and financial trust boundaries been checked, not just the changed screenshot?
