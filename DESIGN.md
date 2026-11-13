---
name: Jobber public site
description: Warm stone ground, olive serif headline, one orange accent; a calm, honest job-tool landing page with the real upload beside the headline.
colors:
  stone-ground: "#f7f6f3"
  paper-surface: "#ffffff"
  hairline: "hsl(40 9% 84%)"
  warm-ink: "hsl(30 10% 11%)"
  muted-ink: "hsl(35 9% 32%)"
  olive-headline: "#59592a"
  signal-orange: "#dd7627"
  orange-ink: "hsl(30 10% 9%)"
  burnt-orange-text: "hsl(26 80% 33%)"
  clay-danger: "hsl(8 65% 36%)"
  night-ground: "hsl(30 8% 6%)"
  night-surface: "hsl(30 7% 9.5%)"
  night-hairline: "hsl(30 6% 19%)"
  night-ink: "hsl(40 25% 95%)"
  night-muted: "hsl(35 9% 71%)"
  night-headline: "#e4e2d0"
  night-orange-text: "hsl(26 73% 55%)"
  night-danger: "hsl(8 80% 70%)"
typography:
  display:
    fontFamily: "Instrument Serif, ui-serif, Georgia, Times New Roman, serif"
    fontSize: "clamp(2.75rem, 5.2vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Instrument Serif, ui-serif, Georgia, Times New Roman, serif"
    fontSize: "clamp(2rem, 3.6vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Instrument Serif, ui-serif, Georgia, Times New Roman, serif"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "Instrument Serif, ui-serif, Georgia, Times New Roman, serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "10px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1.25rem"
  lg: "2rem"
  section: "clamp(3.5rem, 8vw, 6.5rem)"
  gutter: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.orange-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.65rem 1.25rem"
    height: "3.25rem"
  button-primary-hover:
    backgroundColor: "hsl(26 72% 56%)"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.warm-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.65rem 1.25rem"
    height: "2.75rem"
  panel:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.xl}"
    padding: "2rem"
  task-option:
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.85rem"
    height: "2.75rem"
  drop-zone:
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.lg}"
    padding: "1rem 1.1rem"
    height: "5.5rem"
  textarea:
    backgroundColor: "{colors.stone-ground}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.md}"
    padding: "0.8rem 0.9rem"
    height: "7.5rem"
  result-card:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.xl}"
    padding: "2.25rem"
  command-row:
    backgroundColor: "{colors.stone-ground}"
    textColor: "{colors.warm-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.5rem 0.5rem 1rem"
---

# Design System: Jobber public site

Scope: the static landing site in `site/` only. The Next.js dashboard in `web/` has its own look and is not described here.

## Overview

**Creative North Star: "The Plain-Spoken Desk"**

A desk lit by evening lamp: warm stone paper, a dark warm ink, a serif headline in olive, and exactly one orange thing to press. The site plays the job-tool category straight and at full craft, and lets honesty carry it. What happens to the CV, and what the tool cannot do, sit in ordinary type beside the upload instead of behind a link. There is no hype imagery, no gradient, no glow, and no illustration; the one picture of the product is a typeset example result built from real components.

Density is calm and generous. A single content width (1200px) holds a two-column hero (7:5), then full-width bands that alternate between ground and a slightly lighter paper surface, separated by hairlines. Hierarchy comes from the serif/sans contrast and from whitespace, never from shadow or color noise. Light and dark follow the system setting and keep the same warm hue: dark is the same room with the lamp lower.

Inter and Instrument Serif are the existing Jobber dashboard's brand faces. The header carries a text wordmark in the display serif because the available brand assets display a different name.

**Key Characteristics:**
- Warm neutrals tinted toward orange-brown; no cool grey, no pure black (ink is hsl(30 10% 11%)).
- Olive serif for the brand voice (wordmark, H1, section titles); near-black ink for everything the user reads or operates.
- One accent, orange: a bright fill for the primary action, a darkened orange for text-weight uses.
- Flat surfaces. One 1px hairline is the only elevation device; there are no shadows anywhere.
- Real controls rebuilt in the same vocabulary: dropzone, radios as selectable tiles, textarea, buttons.
- Motion is a single 600ms rise on hero load, gated by `prefers-reduced-motion`.

## Colors

A warm stone palette with a single orange accent; the neutrals do nearly all the work and the accent is rare enough to mean "act here".

### Primary
- **Signal Orange** (`#dd7627`): the fill of the one primary button, the form accent color for native controls, and the text-selection background. Always paired with Orange Ink for text on it. Never used as text on a light ground (it fails contrast); never decorative.
- **Burnt Orange Text** (`hsl(26 80% 33%)`): the accessible orange for anything that is orange and also text or a stroke: links, the "choose a file" prompt, the drop icon, the selected task border, the example score, focus rings, the text caret. In dark mode it lifts to `hsl(26 73% 55%)`.

### Secondary
- **Olive Headline** (`#59592a`): wordmark, H1 and section titles only. It is the brand voice, never body text and never a control. In dark mode it becomes a pale parchment `#e4e2d0`.

### Neutral
- **Stone Ground** (`#f7f6f3`): page background and the inset fill of the textarea and command row.
- **Paper Surface** (`#ffffff`): the upload panel, the example result card, and full-width bands.
- **Hairline** (`hsl(40 9% 84%)`): every border and divider; the only elevation device.
- **Warm Ink** (`hsl(30 10% 11%)`): body text, labels, quiet-button text.
- **Muted Ink** (`hsl(35 9% 32%)`): hints, second lede, table values, footer, nav links. Used for secondary text, never for the sole carrier of an instruction.
- **Orange Ink** (`hsl(30 10% 9%)`): text on the orange fill, in both themes.
- **Clay Danger** (`hsl(8 65% 36%)`): errors, invalid borders, failed status text. Lifts to `hsl(8 80% 70%)` in dark.
- **Night set**: Night Ground `hsl(30 8% 6%)`, Night Surface `hsl(30 7% 9.5%)`, Night Hairline `hsl(30 6% 19%)`, Night Ink `hsl(40 25% 95%)`, Night Muted `hsl(35 9% 71%)`, applied through `prefers-color-scheme: dark` only. The orange fill and its ink do not change.

### Named Rules
**The One Orange Rule.** Orange appears as a fill on exactly one control per view (the primary submit), and otherwise only in its darkened text form for links, selection, focus and the score. If a second thing wants to be orange, it should be ink.

**The Olive Is a Voice Rule.** Olive is for the brand and its headings. Anything the user clicks, reads as data, or must act on is ink or burnt orange, never olive.

**The Same Warm Room Rule.** Dark mode is not a different palette: every neutral keeps its warm hue (30-40 degrees) and tinted chroma. Never substitute neutral grey or blue-black.

## Typography

**Display Font:** Instrument Serif (400 only; falls back to ui-serif, Georgia)
**Body Font:** Inter (variable 100-900, self-hosted; falls back to system-ui)
**Label/Mono Font:** Inter 600 for labels; system monospace stack for the one command line

**Character:** A high-contrast, slightly editorial serif for the few sentences that carry the brand, set against a neutral grotesque for everything operational. The serif is only ever regular weight with tight negative tracking; weight is expressed by size, never by synthetic bold.

### Hierarchy
- **Display** (400, clamp(2.75rem, 5.2vw, 4.5rem), 1.02, -0.02em): the single H1. `text-wrap: balance`, olive.
- **Headline** (400, clamp(2rem, 3.6vw, 3rem), 1.08, -0.015em): section titles, olive, balanced.
- **Title** (400, 1.625rem, 1.2, -0.01em): feature-row titles; the panel title (1.75rem), result role (1.5rem) and fact leads (1.5rem) follow the same register in ink.
- **Wordmark** (400, 1.875rem, 1, -0.01em): header brand text, olive.
- **Body** (Inter 400, 1.0625rem, 1.6): running copy, capped near 32-38rem. Lede is 1.1875rem / 1.55.
- **Label** (Inter 600, 0.9375rem): field labels, buttons, dt terms. Hints and notes are 0.875rem and 0.8125rem in Muted Ink.
- **Score** (Instrument Serif 400, 2.25rem, tabular-nums, burnt orange): the single numeral that is allowed to be loud.

### Named Rules
**The Serif Is Quiet Rule.** Instrument Serif is only ever weight 400. Never bold it, never italicize it, never set it below about 1.5rem, and never use it for UI controls or form labels.

**The Measure Rule.** Prose columns stop at 32 to 38rem (about 60 to 70 characters). Never let body copy span the 1200px container.

## Layout

One container: `min(100% - 3rem, 1200px)` centered, narrowing to a 2rem gutter at 560px and below. Page rhythm is generous vertical sections (`clamp(3.5rem, 8vw, 6.5rem)`) alternating plain ground and a bordered paper band (`border-block: 1px hairline`).

- **Hero:** a 7fr / 5fr grid with a clamp(2rem, 5vw, 5rem) gap, top-aligned. Copy left (H1, lede, quieter second lede, a privacy line over a hairline), the real upload panel right.
- **Feature rows:** a ruled list, not a card grid. Each row is a 5 / 5 / 3 grid: serif title, sentence, and a side note with its action link, separated by one hairline per row.
- **Example:** a 5 / 6 split, copy left, a typeset result card right.
- **Facts:** two-column definition-style list; each fact opens with a serif lead.
- **Local install:** a 6 / 5 split with a copyable command row.
- **Responsive:** every multi-column layout collapses to one column at 1000px, with the upload panel directly under the hero copy. At 700px the inline nav hides and the quiet header button moves right.

### Named Rules
**The Ruled List Rule.** Parallel items (capabilities, facts) are rows separated by hairlines, not a grid of identical cards.

## Elevation & Depth

Fully flat. There are no shadows, no blur, no gradients. Depth is expressed only by a tonal step (Stone Ground to Paper Surface) and a 1px Hairline. State changes darken or tint a border or fill; nothing lifts.

### Named Rules
**The Hairline Is the Only Edge Rule.** Separate and contain with a 1px Hairline or a tonal band step. Never add a shadow, a thick border, or a colored side stripe to a container.

## Shapes

Soft but disciplined: controls and fields use a 10px radius, the dropzone 12px, and large containers (panel, result card) 16px. Focus rings use a 4px radius. Nothing is pill-shaped and nothing is square-cornered except the hairline rules. The dropzone is the one dashed-border element (1.5px, ink at 30% opacity), signalling "drop here" and becoming solid once a file is held.

## Components

### Buttons
Quiet and confident; one loud button per view.
- **Shape:** 10px radius, 1px transparent border, min-height 2.75rem (44px).
- **Primary:** Signal Orange fill, Orange Ink text, Inter 600 at 1rem, full-width, 3.25rem tall, only inside the upload panel. Hover lightens the fill to `hsl(26 72% 56%)`. Disabled drops to 45% opacity with a not-allowed cursor.
- **Quiet:** transparent, Warm Ink text, 1px Hairline border; hover darkens the border to Muted Ink. Used in the header ("Upload your CV") and Copy.
- **Text button:** underlined, burnt orange, Inter 500 at 0.875rem ("Use a sample job", "Remove file"); hover turns ink.
- **Transitions:** 150ms on background, border, color and opacity, easing `cubic-bezier(0.22, 1, 0.36, 1)`.

### Upload Panel (signature)
A white 16px-rounded panel holding the whole task: a 2 x 2 grid of radio tiles for the task, the dropzone, the job textarea, the primary button, status line, and a one-line privacy note. It is the only place the orange fill appears.
- **Task tiles:** 10px radius, hairline border, 2.75rem tall; the checked tile takes a burnt-orange border, a 9% orange tint and weight 600. Focus shows a 2px focus ring.
- **Dropzone:** 12px dashed border, 5.5rem tall, with an upload line-icon, the prompt "Drop your CV here or choose a file" (the link part in burnt orange), and a real file input stretched invisibly over the whole zone. Hover and drag-over tint it orange 8% and recolor the border; a held file turns the border solid hairline; an invalid file turns it Clay Danger.
- **Textarea:** 10px radius, Stone Ground fill, hairline border, min-height 7.5rem; hover darkens the border; invalid state uses Clay Danger.
- **Errors and status:** inline, Clay Danger at 0.875rem weight 500, `role="alert"` or `role="status"`; empty status and error lines collapse to nothing.

### Result Card
A typeset example of the product output: serif role title, a large orange tabular score ("3.4 out of 5"), a plain verdict, and a hairline-ruled definition list (bold term, muted explanation) with an honest "Example only" caption. It reads like a document, not a dashboard widget.

### Navigation
Header: serif olive wordmark on the left, four muted text links on the right, then the quiet "Upload your CV" button. Links are 0.9375rem Muted Ink, underline plus Warm Ink on hover. Below 700px the text links hide and only the quiet button remains. Footer: a single muted line plus a wrapped row of text links.

### Command Row
Stone Ground inset with hairline border and 10px radius, holding a horizontally scrollable monospace command and a quiet Copy button; a `role="status"` line below confirms the copy.

## Do's and Don'ts

### Do:
- **Do** keep orange to one filled control per view (Signal Orange `#dd7627`) and use Burnt Orange Text `hsl(26 80% 33%)` for every orange link, stroke or numeral.
- **Do** set the H1, section titles and wordmark in Instrument Serif 400, olive, with `text-wrap: balance`.
- **Do** separate content with 1px Hairline rules and tonal bands; keep every surface flat.
- **Do** keep tap targets at 44px minimum and every state (hover, focus-visible, disabled, invalid) visible on both themes.
- **Do** state privacy and limits in plain body type next to the action, and write errors that say what happened and what is kept.
- **Do** honor `prefers-reduced-motion` and `prefers-color-scheme`; both are real, tested modes.

### Don't:
- **Don't** add shadows, glows, gradients, blur, decorative illustration or AI-hype imagery; the system is flat and typographic.
- **Don't** use Signal Orange as text on a light ground, or Olive as a link, button or data color.
- **Don't** switch dark mode to neutral grey or blue-black; keep the warm 30-40 degree hue.
- **Don't** bold or italicize Instrument Serif, or use it for form labels and controls.
- **Don't** turn parallel items into a grid of identical bordered cards; keep ruled rows.
- **Don't** let prose span the full container width; hold it to 32-38rem.
