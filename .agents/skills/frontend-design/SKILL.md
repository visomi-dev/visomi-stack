---
name: frontend-design
description: Explore a distinctive visual direction when the user explicitly requests creative frontend design, a new marketing surface, or a redesign. Not the default for routine application UI, maintenance, accessibility fixes, or an existing design system.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and choose an intentional direction. Preserve the existing design system unless a redesign is authorized; a restrained, familiar interface is often the right choice for operational or financial workflows.

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Match the product, audience, and approved brief. Minimal, editorial, playful, refined, or expressive directions are options, not requirements. Avoid novelty that makes navigation or tasks harder.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What useful, context-specific quality should users notice without compromising clarity?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:

- Production-grade and functional
- Visually coherent and appropriate to the product
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Prioritize readability, hierarchy, localization, and existing tokens. Inter, Arial, Roboto, and system fonts are valid choices. Introduce a new typeface only when the brief justifies its licensing, loading, and maintenance cost.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Add motion only when it improves feedback or comprehension. Prefer existing framework/native CSS capabilities, respect reduced motion, and keep controls usable without animation. Do not add React-specific libraries to Angular or introduce animation dependencies without an approved need.
- **Spatial Composition**: Use clear hierarchy, appropriate density, and responsive spacing. Asymmetry or expressive composition is optional for an approved creative brief, not a reason to disrupt familiar application patterns.
- **Backgrounds & Visual Details**: Solid surfaces are valid. Add textures, gradients, or depth only when they support the approved visual direction, legibility, and performance budget. Native scrolling and cursors remain the default.

Avoid decoration and copy chosen without a product reason. Do not ban a font, color, familiar layout, or component pattern merely because it is common; consistency and usability take precedence over novelty.

Maintain consistency across screens and releases. Explore alternatives only inside the requested creative scope; do not vary themes, fonts, or navigation between generations without a product decision.

**IMPORTANT**: Use the simplest implementation that meets the approved brief. Prefer existing primitives and a few decisive improvements over extra dependencies, animations, or abstractions. Complexity needs a demonstrated user benefit.

For critique-only requests, return findings rather than editing. For authorized implementation, verify responsive layout, interaction states, accessibility, and the affected project's configured checks.
