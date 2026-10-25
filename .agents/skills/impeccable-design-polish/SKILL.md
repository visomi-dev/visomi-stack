---
name: impeccable-design-polish
description: |
  Follow-up design polish skill inspired by Impeccable. Use after a web or HTML artifact exists to audit, critique, polish, animate, harden, and prepare the page for a live/share pass.
triggers:
  - "impeccable"
  - "design polish"
  - "polish page"
  - "anti ai polish"
  - "critique design"
  - "animate page"
  - "harden ui"
  - "live review"
  - "反 AI 味"
od:
  mode: prototype
  surface: web
  platform: desktop
  category: creative-direction
  upstream: "https://github.com/pbakaus/impeccable"
  preview:
    type: html
  design_system:
    requires: true
  craft:
    requires:
      - typography
      - color
      - anti-ai-slop
      - animation-discipline
      - accessibility-baseline
  example_prompt: |
    Use impeccable-design-polish on the current HTML artifact: audit visual hierarchy, remove AI tells, tighten copy, add restrained motion, and harden responsive/accessibility issues.
---

# Impeccable Design Polish

Use this skill as the post-generation pass for an existing design. It should not restart the project from scratch; it should make the current artifact sharper, more usable, and closer to something a designer would ship.

## Follow-Up Modes

- **Audit**: identify the highest-impact issues in hierarchy, spacing, color, type, interaction states, responsiveness, and accessibility.
- **Critique**: explain what feels generic, overdesigned, underdesigned, or inconsistent.
- **Polish**: directly edit the artifact to improve the top issues while preserving the user's intent.
- **Animate**: add restrained, useful motion only where it improves feedback or storytelling.
- **Harden**: repair mobile overflow, text clipping, contrast problems, missing states, broken links, and fragile layout assumptions.
- **Live**: prepare the artifact for presentation or sharing, including final visual QA and clear next actions.

## Operating Rules

1. Inspect the current HTML/page before editing. Do not guess from the prompt alone.
2. Keep the existing content, brand, and scenario unless the user explicitly asks to change them.
3. Prefer a few decisive fixes over broad cosmetic churn.
4. Remove common AI tells:
   - purple-blue glow gradients with no product reason
   - generic 3-card feature rows
   - oversized rounded cards everywhere
   - empty marketing adjectives
   - inconsistent spacing and type scale
   - decorative effects that do not support comprehension
5. Preserve accessibility: focus states, contrast, semantic controls, readable text, and reduced-motion fallbacks.
6. Keep audit and critique modes read-only: return prioritized findings and proposed fixes. Edit only when the user requested implementation or approved the fixes; then verify the affected artifact and repository checks.
7. Reuse the repository's design system and tooling. Adding motion libraries, assets, or dependencies requires a concrete need within the approved scope.

## Best Pairings

- Pair with `design-taste-frontend` or `gpt-taste` for stronger anti-slop redesign work.
- Use a motion-specific reference only for requested motion work; prefer existing CSS/framework capabilities and do not add GSAP or another library implicitly.
- Pair with image/video skills when the artifact needs real visual assets rather than CSS-only decoration.
