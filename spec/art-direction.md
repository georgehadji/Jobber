# Art direction — Workler

**Stage:** `/art-direction`, 2026-09-08. Sources: `spec/brief.md`, `spec/message-map.md`,
`spec/banlist.md`, `spec/references/01-jobassist.md`.

## Reference base — stated before anything else

**One reference exists, and it is a competitor** (`spec/references/01-jobassist.md`). The skill
asks for 3–5; the founder asked to proceed. So this document is written, and it is honest about
what that costs: a single competitor reference tells me what to move *away* from and nothing about
what to move *toward*. Everything below is therefore derived from the brief's own subject material
(§5) rather than from visual precedent, which is the more defensible source anyway — but the
**typeface pairing and the density calibration are the two decisions most likely to change** when
2–4 non-competitor references arrive. Label: **HYPOTHESIS**, not VERIFIED.

The palette, the signature element and the colour logic are derived from the positioning and will
survive new references. Say so plainly rather than pretending the whole document is equally firm.

---

# PASS 1 — three directions

Three different arguments about what this business is. Not three palettes.

---

## Direction 1 — "The Instrument"

**Thesis.** Workler is a measuring instrument, so the site should look like a readout, not a
brochure — the 1–5 score and the 4.0 threshold (brief §5) are the product, and an instrument's
design job is to make a value legible and its threshold unmistakable.

**Palette** (OKLCH). Hue family: a single near-neutral cool axis (250°) for everything structural,
with exactly one chromatic value reserved for quantitative meaning.

| Token | Value | Reasoning |
|---|---|---|
| paper | `oklch(98.5% 0.003 250)` | Ground. Very slightly cool so it reads as instrument housing, not as the warm cream on the banlist. |
| paper-sunk | `oklch(95.6% 0.005 250)` | Section grounds. Separation by tone, never by a card border. |
| ink | `oklch(20% 0.014 250)` | Text and the bulk of the identity. Not pure black — pure black on paper-white is a screen artefact, not a printed instrument. |
| ink-muted | `oklch(47% 0.012 250)` | Secondary text, labels. |
| rule | `oklch(84% 0.008 250)` | Structural lines. |
| signal | `oklch(58% 0.152 65)` | **Amber. The only chromatic value on the site**, and it means one thing: below threshold, or flagged. |

**Contrast strategy.** Achromatic by default, chromatic only where the product makes a judgment.
ink on paper ≈ 16:1; ink-muted on paper ≈ 7.4:1; rule on paper ≈ 1.6:1, so `rule` is never used to
carry information alone. `signal` at 58% L is a fill/bar value only (≥3:1 against paper, meets
non-text 1.4.11); a darkened `signal-text` at `oklch(46% 0.14 65)` is used whenever it carries
text. No gradient anywhere, as an identity device or otherwise.

**Typography.**
- Display + body: **Instrument Sans** (SIL OFL 1.1, self-hosted woff2). A grotesk with slightly
  narrowed proportions and a tight, un-cute lowercase. Chosen for what it is *not*: not Inter,
  Geist, Poppins or Montserrat (banlist), and not a humanist face that would soften the argument.
  Weights 400, 600. Estimated ~24KB per weight, latin + latin-ext subset — **verify at build**.
- Utility + all numerals + machine output: **IBM Plex Mono** (SIL OFL 1.1). Every number on this
  site is data, so every number is monospaced. Weights 400, 500. Estimated ~28KB per weight.
- **Exactly 2 families, 4 weights — at the budget ceiling, not under it.** Nothing left for a
  third.
- Non-Latin market vocabulary (履歴書, ФОП) uses a `unicode-range` fallback to the system stack.
  Self-hosting CJK is a 4MB decision and this site will not spend it. Stated, not hidden.

**Type scale.** Base 1rem, ratio **1.25** below 1024px, **1.333** at and above. Steps:
`0.75 · 0.875 · 1 · 1.25 · 1.563 · 1.953 · 2.441rem` (mobile) → display step 3.052rem at desktop.

*Where it breaks on purpose, twice:*
1. **The score numeral** sits outside the scale entirely (a fixed 4.5rem / 6rem). It is a
   measurement, not a heading, and putting it on the text scale would file it as decoration.
2. **The H1 is set one step below** what the scale suggests for its level. A restrained H1 is the
   argument: a site whose thesis is "this tool refuses to oversell" cannot open at 4rem.

**Layout system.** 12-column, but content never centred. The reading column occupies columns 3–9
(max measure 68ch), leaving a **permanent right margin** — the "instrument margin" — where scores,
threshold marks and receipts live. Asymmetry rule: the right margin is never filled edge-to-edge
and never becomes a second content column; it holds marks, not prose. Density rule: separation by
space and rule, not by boxes. A card exists only where the content genuinely is a record — the
report demo and the pricing tiers. Vertical rhythm on an 8px base.

```
HERO — Direction 1
┌──────────────────────────────────────────────────────────────┐
│ Workler        How it works  Ghost jobs  Open source  Pricing│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   It reads the posting, scores the fit                       │
│   out of 5, and stops before the                             │
│   send button.                                    ┌────────┐ │
│                                                   │  2.8   │ │
│   Workler never submits an application.           │ ────── │ │  ← threshold rule
│   You do.                                         │ do not │ │
│                                                   │ apply  │ │
│   [ See what it costs → ]  or run the free CLI    └────────┘ │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ ─────────────────────────────────────────────  4.0 threshold │
└──────────────────────────────────────────────────────────────┘
```

```
INTERIOR — the report demo, /how-it-works
┌──────────────────────────────────────────────────────────────┐
│ B  CV match                                          3.4  ▓  │
│    ├ 68ch of plain prose, the actual block text ─┐        │  │
│    └──────────────────────────────────────────────┘       │  │
│ ─────────────────────────────────────────────────────  4.0 ─ │
│ C  Level strategy                                    4.6  ▓  │
│ G  Posting legitimacy            flagged: relisted 3× / 90d  │
└──────────────────────────────────────────────────────────────┘
   ↑ block letter in the left margin, score + bar in the right
```

**SIGNATURE — the threshold rule.** A single horizontal line at the 4.0 position. It appears in
the logotype lockup, across every score display, as the section divider, and as the footer's top
edge. It is the same line every time, at the same weight, and its whole job is that scores can
fall *below* it. One element, load-bearing for the argument: the reference competitor's scores
never cross a line because it has no line.

**The one real aesthetic risk.** **Colour is quantitative only.** The site is entirely achromatic
until the product delivers a negative judgment — which means the most colourful thing on the home
page is a posting Workler tells you not to apply for. The argument: this makes the value
proposition a visual fact rather than a claim, and it is a rule a competitor cannot copy without
also being willing to show bad scores. The risk is that a page with one colour reads as unfinished
to a visitor expecting a SaaS palette.

---

## Direction 2 — "Redaction"

**Thesis.** Workler is defined by what it will not do, so the identity should be *removal* — the
approval gate and the do-not-apply verdict (brief §5) rendered as struck-through and withheld
content.

**Palette.** paper `oklch(97% 0 0)`; ink `oklch(15% 0 0)`; bar `oklch(15% 0 0)` at full opacity —
solid black bars as the primary device; one recovery tone `oklch(62% 0.19 25)` for the single
un-redacted word per section. Achromatic to the point of severity. Contrast strategy: absolute —
everything is either fully present or fully removed, no mid-tones, no muted grey text.

**Typography.** A single family, **Instrument Sans** 400/600, plus its own tabular numerals; no
mono, because a monospace would soften the severity into "developer tool". Scale ratio 1.2, tight,
with the display step used only once per page.

**Layout.** Single centred column, 62ch, with bars extending into both margins. Asymmetry rule:
the bars are asymmetric, the text is not. Density: high — this direction is dense on purpose,
close-set, minimal air.

```
HERO — Direction 2
┌──────────────────────────────────────────────────────────────┐
│  Workler                                                     │
│                                                              │
│  Every other tool ██████ ██████ ████ ███ ██ ███████.         │
│  Workler stops.                                              │
│                                                              │
│  ████ ████████ ██ ███ ███ ███████ █████ ████ ██████████.     │
│  The last click is yours.                                    │
│                                                              │
│  [ See what it costs → ]                                     │
└──────────────────────────────────────────────────────────────┘
```

**SIGNATURE — the bar.** Content struck out rather than absent, so the visitor sees the shape of
what was withheld.

**The one real aesthetic risk.** Redaction imagery reads as surveillance, secrecy or leaks — the
opposite of a product whose entire trust argument is *openness* (belief 4, the readable
repository). It is also an accessibility problem: struck or obscured text must still be fully
available to a screen reader, which means the visual device and the accessible content diverge,
and that divergence is exactly the kind of thing an axe audit and a real user both punish.

---

## Direction 3 — "The Dossier"

**Thesis.** What the customer actually buys is a document — the A–G report (brief §5) — so the
site should be that document's cover and contents, treating the visitor as someone opening a case
file rather than reading an advertisement.

**Palette.** A true paper white `oklch(99% 0.004 95)` with a faint warm cast; ink
`oklch(24% 0.02 260)`; a marginalia tone `oklch(52% 0.03 260)`; a stamp colour
`oklch(50% 0.16 20)` used only for the do-not-apply stamp; two rule weights.

**Typography.** Display: a text serif with real editorial authority — **Source Serif 4** (OFL),
600. Body: **Instrument Sans** 400. Utility: none — the block letters A–G are set in the serif's
small caps. Ratio 1.333 throughout, generous leading.

**Layout.** Two columns: a wide document column and a persistent left margin carrying block
letters, dates and annotations. Density: low, generous, print-derived.

```
HERO — Direction 3
┌──────────────────────────────────────────────────────────────┐
│ WORKLER                                    EVALUATION REPORT │
│ ──────────────────────────────────────────────────────────── │
│ No. 001          Senior Software Engineer · Berlin           │
│ 2026-09-08                                                   │
│                                                              │
│ A │ Role summary        Lorem ipsum the actual block text    │
│ B │ CV match            …                                    │
│ C │ Level strategy      …                    ╔════════════╗  │
│ G │ Legitimacy          flagged              ║ DO NOT     ║  │
│                                              ║ APPLY  2.8 ║  │
│                                              ╚════════════╝  │
└──────────────────────────────────────────────────────────────┘
```

**SIGNATURE — the stamp.** A do-not-apply stamp, rotated, over the report.

**The one real aesthetic risk.** Serif display on warm paper with a clay-adjacent accent is one
adjustment away from the banned cream/serif/terracotta combination, and the dossier register
drifts toward the banned broadsheet pastiche the moment hairline rules and dense columns appear.
The stamp is also skeuomorphic in a way that will age badly and reads as decoration on a site
arguing that its judgments are real.

---

# PASS 2 — self-critique before choosing

The test: this brief, given to ten other studios using AI tools — how many arrive here?

| Direction | Arrivals | Why |
|---|---|---|
| 1 — Instrument | **4/10 as originally drafted.** | "Technical product → neutral palette, grotesk + mono, data-forward" is the median move for developer-adjacent tools. The mono-for-numerals idea is close to a reflex. **Above threshold — revised.** |
| 2 — Redaction | **1/10.** | Genuinely unusual. But it is unusual in the wrong direction: it argues secrecy for a product whose case is openness, and it fights the accessibility floor. Low arrival rate is not the only criterion. |
| 3 — Dossier | **3/10.** | "Make the software look like the document it produces" is increasingly common, and the serif-on-paper execution is close to two banlist entries. **Above threshold — revised.** |

### What changed in Direction 1, and why

The generic core was *"neutral palette + mono numerals + data cards"*. Three revisions take it off
the median:

1. **Colour became a rule instead of a palette.** Originally: neutral with an amber accent — an
   accent is a decoration and every studio adds one. Now: the single chromatic value is licensed
   *only* by a quantitative negative — below-threshold scores and legitimacy flags. Nothing else on
   the site may use it, ever. That is a constraint a competitor cannot adopt without changing its
   product behaviour, which is the definition of an identity rather than a style.
2. **The signature became the threshold rule, not the score card.** A score card is a component
   ten studios would draw. A single line at 4.0, reused as the logotype's underline, the section
   divider and the footer edge, is one idea carried everywhere — and it encodes the argument.
3. **The H1 was demoted a step.** The default is a big confident headline. Setting the H1 *below*
   its scale position, and letting the score numeral be the largest thing on the page, makes the
   measurement outrank the marketing. This is the smallest change in the document and the most
   visible one.

Post-revision estimate: **2/10.** Honest, not flattering — the underlying register (neutral,
typographic, technical) remains a reasonable place for ten studios to land. What is unlikely to be
duplicated is the colour licence and the threshold rule. If that is not enough separation, the
thing that would buy more is references, which is the deficit named at the top.

### What changed in Direction 3

Serif display dropped, warm cast reduced, stamp removed. At which point it stops being a distinct
direction and becomes Direction 1 with a left margin — which is itself the finding. Rejected as a
direction, one element retained (below).

---

# CHOSEN — Direction 1, "The Instrument", revised

**Why it wins.** The recommended value proposition is mechanism-led (message-map §2B) and the
site's conversion mechanism is demonstration, because there is no social proof to convert on
(brief §4). An instrument register is the only one of the three that makes the *demonstration* the
hero rather than the frame around it. It also survives the reference deficit: it is derived from
the product's own subject material, so new references can adjust its typography and density
without invalidating its logic.

**Retained from Direction 3:** the block-letter left margin (A–G in the margin, prose in the
column). It is the one element of the dossier that carries information rather than atmosphere.

**Rejected — Direction 2, and precisely why.** Redaction argues secrecy; belief 4 argues
inspectability. The identity would contradict the message hierarchy on every page, and no amount
of craft fixes a device that says the opposite of the copy. It also puts the visual device and the
accessible text in permanent disagreement, which the quality floor does not allow.

**Rejected — Direction 3, and precisely why.** Two banlist adjacencies (cream + serif + clay
accent; broadsheet pastiche), a skeuomorphic signature that reads as decoration on a site arguing
its judgments are real, and — after the revisions that would fix both — no remaining distinction
from Direction 1.

---

## Rules the build inherits

1. **Colour licence.** `--color-signal` is used only for a score below 4.0, a legitimacy flag, or
   the threshold rule itself. Not for buttons, links, hovers, icons or emphasis. A button is ink
   on paper. **If a page has no negative judgment on it, that page is achromatic.**
2. **The threshold rule** appears at most once per viewport. It is `1px`, `--color-ink`, full
   bleed within its container, and always labelled `4.0` in mono at its right end.
3. **Every numeral is mono and tabular.** Scores, prices, counts, dates.
4. **No card without a record.** Cards exist for the report demo and the pricing tiers only.
   Everything else is separated by space and rule.
5. **Motion.** One orchestrated moment per page, maximum, and it belongs to the score: the score
   bar draws to its value on first view, 320ms, `--ease-out`. Nothing else moves. Fully disabled
   under `prefers-reduced-motion`, where the bar renders at its final value with no transition.
6. **The nav is not logo-left / links-centre / sign-in-right** (banlist). It is logo-left,
   links-right, no sign-in until there is something to sign into, with the threshold rule as its
   bottom border.
7. **No icons.** No icon set is installed. Where an icon would go, either a word goes or nothing
   does. This removes an entire banlist category (three-icon feature rows, Lucide, emoji) by
   removing the capability.
8. **Focus is designed, not inherited.** A 2px `--color-focus` ring at 2px offset, on every
   interactive element, visible against both grounds. `--color-focus` is a11y infrastructure and
   is exempt from rule 1 — it is the one other colour in the system, and it never appears except
   under keyboard focus.

## Open, and named

- **HYPOTHESIS:** the Instrument Sans / IBM Plex Mono pairing. Both are OFL and self-hostable; the
  pairing is chosen against the banlist rather than against references, because there is one
  reference and it is a competitor. Re-open when 2–4 arrive.
- **UNKNOWN:** the wordmark. Blocked on trademark clearance (brief §1). The site launches with the
  name set in Instrument Sans 600 with the threshold rule beneath it — a lockup, not a logo, and
  deliberately cheap to replace.
- **UNKNOWN:** the favicon and OG images, same blocker, same reason.
