# Financial UX Research

Researched on 2026-09-30. These are design principles, not evidence that Nive has been user-tested. Nive-specific examples and preferences apply only when working on that product; they do not define the reusable stack's domain, storage, navigation, or design system.

## Primary usability and accessibility guidance

- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/):
  show core features first; defer secondary options behind visible, clearly named controls.
- [NN/g: Icon Usability](https://www.nngroup.com/articles/icon-usability/):
  icons are ambiguous without experience; normal navigation needs visible labels, not hover-only names.
- [NN/g: Accordions on Desktop](https://www.nngroup.com/articles/accordions-on-desktop/):
  concise headings let people choose supplementary information; do not indiscriminately collapse core content.
- [WCAG 2.2: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html):
  AA specifies 24px targets with exceptions. Nive's 44px touch-target preference is intentionally stronger,
  not a claim that WCAG AA universally requires 44px.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/):
  verify contrast, focus, keyboard access, reflow, names, and state; automated Axe checks are not certification.

## Financial-product application

- [Eleken: Trusted Fintech UI Examples](https://www.eleken.co/blog-posts/trusted-fintech-ui-examples):
  Wise and Revolut examples emphasize prominent final amounts, restrained dashboards, and clear navigation.
- [Eleken: Fintech UX Best Practices](https://www.eleken.co/blog-posts/fintech-ux-best-practices):
  reduce cognitive load with progressive disclosure; pair status colors with meaningful text or icons.
- [Lollypop: Banking App UI Design](https://lollypop.design/blog/2026/june/banking-app-ui-design/):
  prioritize balances, recent activity, and upcoming obligations; dark mode needs deliberate contrast and hierarchy.

Agency examples are secondary inspiration, not normative standards or proof of conversion claims.
Do not copy banking promises into Nive: it records and plans finances; it is not a bank.
Mobile gutters and the particular Nive tonal ladder are product decisions informed by these principles,
not universal numeric requirements from the sources.
