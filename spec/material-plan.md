# Material Design plan — Workler site

**Status:** plan, 2026-09-08. Nothing built. Founder directive: *the website must be designed with
the principles of Material Design.* This document says what that changes, what it keeps, in what
order, and what proves each step done.
**Scope:** `workler-site` (11 static pages, zero JS, tokens-only CSS). The hosted app (`web/`) is
a downstream consequence, named in §7, not built here.
**Labels:** VERIFIED (measured in this checkout) · INFERENCE · HYPOTHESIS · DECISION (taken here
as a default the founder can overturn) · UNKNOWN.

---

## 0. The one-paragraph version

Material Design 3 is a system of *roles* — colour roles, type roles, shape, elevation, motion,
window-size classes — not a look. Almost everything the current art direction argues for survives
translation into those roles: the achromatic ground becomes a neutral-seeded tonal palette, the
amber "signal" becomes the M3 `error` role, ink-on-paper buttons become filled buttons, the
threshold rule stays as the signature, the instrument margin becomes M3's supporting-pane layout.
Four things genuinely change: the shape scale (near-zero radius → M3 shape tokens, pill buttons),
elevation (no shadows → tonal surface containers, level-1 shadow at most), typography (Instrument
Sans / IBM Plex Mono, never loaded, → Roboto / Roboto Mono on the M3 typescale), and the icon rule
(none → Material Symbols permitted as inline SVG where a label has no room). Zero client-side JS
is kept, so there is no ripple, no JS theme toggle, and dark scheme follows the OS. The one real
risk is the banlist's own test: out-of-the-box M3 — violet `#6750A4`, a FAB, elevated cards — is
what ten studios produce. The theme below is built so that it is not that.

---

## 1. What "Material principles" means here (VERIFIED against the M3 spec)

| Principle | M3 mechanism | Applied to this site |
|---|---|---|
| Material as metaphor: surfaces, tonal layering | Surface roles `surface`, `surface-container-{lowest,low,default,high,highest}`; elevation levels 0–5, tonal by default | Sections and cards separate by surface-container tier. Shadow only at level 1 on the record cards; level 0 everywhere else |
| Bold, graphic, intentional | Colour roles from a seed via tonal palettes; typescale of 15 roles; shape scale | Neutral seed (the current ink hue), `error` role = the current signal amber; M3 typescale in rem; shape scale with pill buttons |
| Motion provides meaning | Easing sets (standard / emphasized), duration tokens short–long, state layers 8/10/10/16 % | State layers on every interactive element (CSS only); signature bar draw on `emphasized-decelerate`; nothing else moves |
| Adaptive layout | Window-size classes compact <600 / medium 600–839 / expanded 840–1199 / large ≥1200 dp; canonical layouts | Breakpoints re-based on the classes; hero = "supporting pane" canonical layout; 16 dp margins compact, 24 dp above |
| Accessibility built in | 48 dp targets, 3 dp focus indicator, 4.5:1 / 3:1 contrast, both schemes | Targets bumped from 36/44 to 48; focus 3 px; contrast verified by script in light **and** dark |
| Components | Top app bar, buttons (filled/tonal/outlined/text), cards (elevated/filled/outlined), divider, list, chip | Only the ones this site has content for. No FAB, no navigation bar, no bottom sheet — a marketing site has nothing to put in them |

## 2. Reconciliation with the existing spec — what changes and what stays

`CLAUDE.md` says later stages must not contradict earlier ones and `spec/banlist.md` is binding
unless `spec/brief.md` requests otherwise. So the directive is recorded as a founder constraint in
`spec/brief.md` §6 first, then `spec/art-direction.md` gets a dated *Revision 2* section, and only
then does `src/` change. Phase 0 below.

| Current rule (art-direction "Rules the build inherits") | Verdict | Material translation |
|---|---|---|
| 1. Colour licence — chromatic only for a negative judgment | **Keeps** | Signal amber becomes the `error` / `error-container` / `on-error-container` roles. M3's `error` role means exactly "negative judgment". Primary is the neutral-seeded ink (tone 40); tertiary is unassigned. A page with no negative judgment is still achromatic |
| 2. Threshold rule, 1 px ink, labelled 4.0 | **Keeps** | It is a custom `divider`. Colour `on-surface`, not `outline-variant`, so it stays the loudest line on the page |
| 3. Every numeral mono and tabular | **Keeps** | Roboto Mono replaces IBM Plex Mono; `font-variant-numeric: tabular-nums` unchanged |
| 4. No card without a record | **Keeps** | Records = M3 *outlined* card (surface + outline-variant border). Sunk sections = *filled* surface-container. Never outline + shadow together — that combination is the shadcn banlist entry |
| 5. One orchestrated moment, 320 ms, reduced-motion off | **Keeps, re-timed** | Bar draw → `medium-4` (400 ms) on `emphasized-decelerate`. State layers are `short-2` (100 ms) and are not "orchestrated"; the banlist's 400 ms cap on non-signature motion still holds |
| 6. Nav logo-left / links-right, threshold rule as border | **Keeps** | M3 *small top app bar*, 64 dp, `surface`, links right. The threshold rule remains its bottom edge instead of the app bar's on-scroll elevation (which needs JS or `scroll-state()`; see §5) |
| 7. No icons | **Changes** | Material Symbols permitted, inline SVG only, only where a control has no room for a label, always with an accessible name. The three-icon feature row and emoji stay banned. Expected count at launch: zero — the rule is a licence, not a requirement |
| 8. Focus 2 px offset 2 px | **Changes** | M3 focus indicator: 3 px `primary` outline, 2 px offset |
| Radius 0 / 2 / 3 px | **Changes** | M3 shape scale: xs 4, sm 8, md 12, lg 16, xl 28, full. Buttons `full`, cards `md`, code blocks `sm` |
| No shadows | **Changes** | Elevation tokens 0–5. Level 1 on record cards only. Tonal separation stays primary |
| Instrument Sans / IBM Plex Mono (HYPOTHESIS, never loaded — QA C1) | **Changes** | Roboto 400/500 + Roboto Mono 400/500. Two families, four weights: at the budget ceiling exactly as before. Both Apache-2.0/OFL, self-hostable. DECISION: the current pairing was labelled a hypothesis and has never rendered; replacing it costs nothing that has been seen |
| Type scale 1.25 / 1.333, 7 steps | **Changes** | M3 typescale (§3.2). H1 stays demoted: `headline-large` (32) compact, `display-small` (36) expanded — never `display-large`. The score numeral keeps its off-scale size (the deliberate break) |
| Breakpoints 30 / 48 / 64 / 90 rem | **Changes** | 37.5 / 52.5 / 75 rem (600 / 840 / 1200 px window classes) |
| `color-scheme: light` only | **Changes** | Light and dark schemes via `light-dark()` + `prefers-color-scheme`. No toggle (no JS) |

**Banlist amendments (Phase 0 writes them in):** ban the M3 baseline palette (`#6750A4` and its
containers) — a seed must be the site's own; ban FAB and bottom navigation on this site; ban
ripple via JS (contradicts the zero-JS contract). The ten-studios test still applies to every
decision: "Material" is not an exemption from it, it is the reason to run it harder.

## 3. Token design (Phase 1 output — `src/styles/tokens.css`)

### 3.1 Colour — HCT tone levels, expressed in OKLCH

DECISION: hand-map tones, do not add `@material/material-color-utilities`. The site has one seed
and it will not change until the wordmark clears (brief §1: name-bound brand investment waits).
Tone L values map roughly to OKLCH L; contrast, not tone fidelity, is the acceptance criterion and
a script measures it (§3.6). When a brand seed arrives, that is the moment to add the generator.

Seed: the current ink, hue 250, chroma ≈ 0.014 (near-neutral). Error seed: the current signal,
hue 65, chroma 0.15.

| Role | Light tone | Dark tone | Current token it replaces |
|---|---|---|---|
| `surface` / `on-surface` | 98 / 10 | 6 / 90 | paper / ink |
| `surface-container-lowest … highest` | 100 · 96 · 94 · 92 · 90 | 4 · 10 · 12 · 17 · 22 | paper-sunk (one tier → five) |
| `on-surface-variant` | 30 | 80 | ink-muted |
| `outline` / `outline-variant` | 50 / 80 | 60 / 30 | rule |
| `primary` / `on-primary` | 40 / 100 | 80 / 20 | btn-bg / btn-text |
| `primary-container` / `on-primary-container` | 90 / 10 | 30 / 90 | — (tonal button, if ever) |
| `error` / `on-error` | 40 / 100 | 80 / 20 | signal (fills, bars) |
| `error-container` / `on-error-container` | 90 / 10 | 30 / 90 | signal-text on paper → text on container |
| `secondary`, `tertiary` | unassigned | unassigned | — (deliberately; adding them is the ten-studios move) |

Semantic aliases keep the current names (`--color-bg`, `--color-text`, `--color-below`,
`--color-threshold` …) pointing at the roles, so component CSS reads as the argument it already
makes and `scripts/check-tokens.sh` needs no new rule for colour.

### 3.2 Typography — M3 typescale, rem

`display` 3.5625 / 2.8125 / 2.25 · `headline` 2 / 1.75 / 1.5 · `title` 1.375 / 1 (500) / 0.875
(500) · `body` 1 / 0.875 / 0.75 · `label` 0.875 / 0.75 / 0.6875 (all 500), with M3 line-heights
and tracking as tokens. Roles map: H1 → headline-large / display-small; H2 → headline-small;
H3 → title-large; body → body-large; meta labels → label-medium (mono, uppercase kept);
score → `--size-score` (off-scale, unchanged). Measure stays 68ch.

### 3.3 Shape

`--shape-none 0 · xs 0.25rem · sm 0.5rem · md 0.75rem · lg 1rem · xl 1.75rem · full 9999px`.
Old `--radius-*` names are removed, not aliased; the checker catches any survivor.

### 3.4 Elevation

`--elevation-0 none` through `--elevation-5`, the M3 two-shadow recipe per level (umbra + penumbra
in `on-surface` at 30 % / 15 %). Only `--elevation-1` is consumed at launch.

### 3.5 Motion and state

Easing: `standard (0.2,0,0,1)`, `standard-decelerate (0,0,0,1)`, `standard-accelerate (0.3,0,1,1)`,
`emphasized-decelerate (0.05,0.7,0.1,1)`, `emphasized-accelerate (0.3,0,0.8,0.15)`. Durations:
`short-1…4` 50–200 ms, `medium-1…4` 250–400 ms. State layer opacities `hover 8 % · focus 10 % ·
pressed 10 % · dragged 16 %` as tokens; the layer itself is a `::after` on the component
(§4). All durations collapse to 0 under `prefers-reduced-motion`, as now.

### 3.6 Contrast gate (new script, `scripts/check-contrast.mjs`)

Parses `tokens.css`, resolves every `on-X` / `X` pair and every text-on-surface pair in both
schemes, computes WCAG contrast, fails under 4.5:1 for text and 3:1 for non-text. Runs in CI
before the token-drift check. Control pair built in: it must fail on a deliberately broken fixture
pair, or it is not a gate.

## 4. Component translation (Phase 3 output — `src/styles/base.css`)

| Current | Becomes | Notes |
|---|---|---|
| `.site-head` | Small top app bar: 64 dp, `surface`, threshold rule as bottom edge | Links get 48 dp targets via padding, not negative margin |
| `.cta` | Filled button: 40 dp height, `full` shape, `primary` / `on-primary`, state layer, 48 dp target via margin | The secondary text link becomes a *text button* (same height, no fill) — the "one CTA + one text link" hero shape stays |
| `.record` | Outlined card, `md` shape, `outline-variant` border, `surface`, elevation 0 | The hero's example record alone gets elevation 1: it is the single elevated object on the page, which is the M3 way of saying "this one is the product" |
| `.section--sunk` | `surface-container-low` | Additional tiers available; use at most two per page |
| `.threshold`, `.lockup__rule` | Unchanged geometry, `on-surface` colour | Signature survives |
| `.score`, `.bar` | Unchanged; fill colour → `error` when below; track → `surface-container-highest` with `outline-variant` border | Bar draw re-timed (§2) |
| `.flag` | Assist chip, `error-container` / `on-error-container`, `sm` shape, 32 dp | The one place a chip has content |
| `.blocks` table | M3 list, one-line items, block letter as leading `label-large` mono | Table semantics kept (`<table>` stays; only the presentation changes) |
| `.terminal` | `surface-container-highest`, `sm` shape | — |
| `.todo` | Unchanged | It is a pre-launch defect marker, not a component |
| `:focus-visible` | 3 px `primary`, 2 px offset | Both schemes checked |
| Physical properties (QA C4) | Logical (`padding-inline-start` …) | Folded in here since every line is being touched anyway |

State layer pattern, CSS only, one rule shared by every interactive element:

```css
.state { position: relative; isolation: isolate; }
.state::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: currentColor; opacity: 0; transition: opacity var(--duration-short-2) var(--ease-standard); }
.state:hover::after { opacity: var(--state-hover); }
.state:focus-visible::after { opacity: var(--state-focus); }
.state:active::after { opacity: var(--state-pressed); }
```

No ripple. M3 specifies the ripple as pressed feedback; a JS-free state layer at 10 % is the
documented fallback and it keeps the 0 KB script budget honest.

## 5. Optimisations (Phase 5)

Ordered by what the CI budgets can measure.

1. **Fonts, done properly.** Roboto 400/500 + Roboto Mono 400/500, latin + latin-ext subsets,
   woff2, self-hosted under `public/fonts/`. Metric-matched fallbacks computed with fontpie
   (never guessed), inserted into the stacks. `<link rel=preload>` for Roboto 400 only. Budget:
   ≤ 4 files, ≤ 100 KB total, CLS ≤ 0.05 in LHCI with fonts loaded. The recipe in `base.css` header
   already says this; it has never been executed.
2. **Dark scheme at zero cost.** `light-dark()` in the token layer, `color-scheme: light dark`.
   No second stylesheet, no JS, no flash. VERIFIED baseline-2024 CSS.
3. **Icons never as a font.** If a Material Symbol is used, it is an inlined `<svg>` with a
   `<title>`, ≈ 300 bytes. The icon font is 300 KB+ and never ships.
4. **App bar elevation on scroll without JS.** `container-type: scroll-state` +
   `@container scroll-state(stuck: top)` where supported (Chromium 133+); elsewhere the bar is
   flat and still correct. HYPOTHESIS that it is worth the six lines — measure first, decide after.
5. **Below-fold rendering.** `content-visibility: auto` with `contain-intrinsic-size` on sections
   after the hero. Verify it does not move CLS; drop it if it does.
6. **Text wrapping.** `text-wrap: balance` on headings, `pretty` on paragraphs. Free.
7. **CSS weight.** Inlined CSS is 5.3 KB gzipped today (QA A). M3 roles roughly double the token
   count; budget the inlined CSS at ≤ 9 KB gzipped. If it exceeds that, the unused surface tiers
   and elevation levels go, not the inlining.
8. **Checker coverage.** `scripts/check-tokens.sh` gains patterns for raw `box-shadow:`,
   `border-radius: <px>`, `cubic-bezier(` and `<number>ms` outside `tokens.css`. Each new pattern
   is proven against a one-line fixture that must fail.
9. **CI, green, once.** The quality workflow has never run (QA §9). This plan does not end until
   it has: token drift, contrast, build, axe on 11 routes × 2 schemes, LHCI 3 runs.

## 6. Phases and gates

| # | Phase | Deliverable | Gate (measured, or it did not happen) |
|---|---|---|---|
| 0 | **Decision record** | `spec/brief.md` §6 constraint; `spec/art-direction.md` "Revision 2 — Material" with a re-run ten-studios estimate; `spec/banlist.md` amendments (§2) | Revision 2 names what changed and why for every row in §2. Ten-studios estimate ≤ 3/10 with reasons |
| 1 | **Tokens** | `tokens.css` rewritten (§3); `scripts/check-contrast.mjs`; `check-tokens.sh` still passes | Contrast script passes both schemes and fails its control fixture; no `--radius-*` or `--shadow-none` survivor |
| 2 | **Fonts** | Four woff2 subsets, fontpie fallbacks, preload | CLS ≤ 0.05 in LHCI with fonts; total font bytes ≤ 100 KB |
| 3 | **Components** | `base.css` rewritten (§4), logical properties | axe 0 violations on all 11 routes in light and dark; every target ≥ 48 dp measured by a Playwright test; reduced-motion run shows 0 running animations |
| 4 | **Pages** | Minimal markup edits: button/chip/list classes, hero supporting pane, `/pricing` tiers as one comparison table (QA G12), `/ghost-jobs` rhythm broken from `/rights` (QA G12) | `node build.mjs` warnings unchanged in count (still the CLIENT INPUT set, nothing new); banlist audit clean including §2 amendments |
| 5 | **Optimisations** | §5 items 2–9 | LHCI: performance ≥ 0.95, LCP ≤ 2.0 s, CLS ≤ 0.05, TBT ≤ 150 ms, 3 runs; inlined CSS ≤ 9 KB gz; CI green |
| 6 | **QA re-run** | `spec/qa-report.md` appended with a dated Material section, every A/B/C row re-measured | No row regresses; C1 (fonts unseen) closes |

Order is strict: 0 before anything in `src/` (the stage-guard hook enforces existence, not
content, so this is discipline, not tooling). 1–2 can overlap. 3 needs 1. 4 needs 3. 5 needs 4.

Effort, INFERENCE: 0 half a day · 1 one day · 2 half a day · 3 one to two days · 4 one day ·
5 one day · 6 half a day. The design pass on `/pricing` and `/ghost-jobs` is the elastic part.

## 7. Consequences outside this repo

- `docs/HOSTED-APP-PLAN.md` §4.4 DECISION skins the hosted app with *this site's tokens* and
  names Instrument Sans, IBM Plex Mono, near-zero radius and no shadows explicitly. After Phase 1
  that paragraph is stale; it should point at the Material token set and its `web/globals.css`
  work (hosted phase 3) inherits the M3 roles instead. The app is Tailwind 4 + a burnt-orange
  brand today — a different palette entirely — so the skin work there is real, and not started by
  this plan.
- The founder's directive is a *design* decision. Nothing here touches copy, claims, receipts or
  the twelve `[CLIENT INPUT REQUIRED]` markers, which still block the deploy exactly as
  `spec/qa-report.md` says.

## 8. Open, and named

- **DECISION (default, overturnable):** Material 3, not Material 2.
- **DECISION:** Roboto / Roboto Mono over Instrument Sans / IBM Plex Mono. Reversible in the token
  file and the four font files; the typescale does not care which family fills it.
- **DECISION:** neutral seed now; re-seed when the wordmark clears. One token.
- **DECISION:** zero JS stays. No ripple, no theme toggle, no JS app-bar elevation.
- **HYPOTHESIS:** a Material marketing site can pass the banlist's ten-studios test with a
  neutral seed, no FAB and the threshold signature. Phase 0 has to argue it, not assume it.
- **UNKNOWN:** whether the founder wants the hosted app moved to Material in the same pass. §7
  says what that costs; it is not scheduled.
