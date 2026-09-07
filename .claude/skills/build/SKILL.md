---
description: Build the site from the locked artifacts — components, JSON-LD, accessibility and performance budgets. Use after art direction, architecture and copy exist.
---

## Design tokens in force
```!
cat "${CLAUDE_PROJECT_DIR}/src/styles/tokens.css" 2>/dev/null || echo "MISSING — run /art-direction first"
```

Read all upstream artifacts. Build the site.

**Stack.** Default to Astro with islands for content and marketing sites; Next.js App
Router only when the brief requires auth, personalisation or a real application surface.
State the choice and the reason before writing code. Tailwind consuming `tokens.css`, or
plain CSS with the same tokens. No component-library defaults left visible.

**Budgets — acceptance criteria, not aspirations.**
- LCP ≤ 2.0s, CLS ≤ 0.05 lab on Moto-G-class throttling. Field: LCP ≤ 2.5s, INP ≤ 200ms,
  CLS ≤ 0.1 at p75.
- First-load JS ≤ 60KB gzipped. Anything above needs a written justification.
- Fonts self-hosted woff2, subset, preloaded, `font-display: swap`, ≤2 families, ≤4 weights.
- Images AVIF with WebP fallback, intrinsic width/height on every element, responsive
  srcset, lazy below the fold, eager + `fetchpriority="high"` on the LCP image.
- Zero layout shift from fonts, images, embeds or the consent banner.
- Third-party scripts: default zero.

**Accessibility — WCAG 2.2 AA.** Semantic HTML first, ARIA only where semantics run out.
Contrast ≥4.5:1 body and ≥3:1 for large text and UI boundaries. Every interactive element
keyboard-reachable with a designed focus style. Touch targets ≥24×24 CSS px (2.5.8);
design to 44px. Forms: bound labels, programmatically associated errors, no
error-by-colour-alone, autocomplete attributes. No accessibility overlay widget, ever.

**Mobile-first literally.** Base stylesheet written for 320px, complexity added upward.
Verify at 320 / 360 / 390 / 768 / 1024 / 1440. Thumb-reachable primary actions. No
hover-only affordances. No horizontal scroll at any width.

**Markup for machines.** JSON-LD per the schema plan, matching visible content exactly.
Canonicals, hreflang per the IA, Open Graph and Twitter cards with real dimensions. XML
sitemap. `robots.txt` that does not block AI crawlers unless the client decides otherwise,
and verify the CDN or WAF is not blocking them either. Server-rendered content: anything
reachable only after client-side JS is invisible to a meaningful share of crawlers.

Deliver the file tree first, then the files, then one paragraph per non-obvious decision.
