# Studio operating rules

This repo builds one client website. The pipeline is stage-gated. Each stage is a
skill; each stage writes an artifact to `spec/`; later stages must not contradict
earlier ones.

## Pipeline
`/intake` → `/positioning` → `/art-direction` → `/architecture` → `/copy` → `/build` → `/qa-gate` → `/growth`

Artifacts, in dependency order:
`spec/brief.md` → `spec/message-map.md` → `spec/art-direction.md` + `src/styles/tokens.css`
→ `spec/ia.md` + `spec/query-map.md` → `copy/*.md` → source → `spec/qa-report.md` → `spec/growth-plan.md`

## Hard rules
- Never invent a fact. Testimonials, metrics, client names, certifications, dates:
  if it is not in `spec/brief.md`, write `[CLIENT INPUT REQUIRED: <question>]`.
- Never introduce a raw colour, font-size, spacing or radius value in component code.
  Every value comes from `src/styles/tokens.css`.
- Never write into `src/` before `spec/art-direction.md` and `src/styles/tokens.css` exist.
  A hook blocks this; do not work around it.
- `spec/banlist.md` is binding on every visual decision.
- Label non-obvious claims VERIFIED / INFERENCE / HYPOTHESIS / UNKNOWN.
- If a required input is missing, stop and ask. Do not proceed on assumption.

## Quality floor (never announced, never negotiable)
Responsive from 320px. Visible keyboard focus. `prefers-reduced-motion` respected.
Semantic landmarks. Real alt text. WCAG 2.2 AA.

## Budgets (enforced in CI, see .github/workflows/quality.yml)
LCP ≤ 2.0s and CLS ≤ 0.05 lab; field targets LCP ≤ 2.5s / INP ≤ 200ms / CLS ≤ 0.1 at p75.
First-load JS ≤ 60KB gzipped. Max 2 font families, 4 weights, self-hosted woff2.
Zero third-party scripts unless justified in `spec/growth-plan.md`.
