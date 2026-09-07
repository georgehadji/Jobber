#!/usr/bin/env bash
# bootstrap-web-studio.sh
# Scaffolds a Claude Code template repo that turns the website production
# prompt system into a repo-embedded, enforced pipeline.
#
#   ./bootstrap-web-studio.sh <target-dir>
#
# Then: gh repo create vibe-studio-site-template --template ... (or just push it)
# and start every client project with: gh repo create client-x --template <this>

set -euo pipefail
ROOT="${1:-web-studio-template}"

mkdir -p "$ROOT"/{.claude/{skills,agents,hooks},spec/references,scripts,tests,.github/workflows}
cd "$ROOT"

# ---------------------------------------------------------------------------
# CLAUDE.md — short, always-on, facts and hard rules only
# ---------------------------------------------------------------------------
cat > CLAUDE.md <<'EOF'
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
EOF

# ---------------------------------------------------------------------------
# spec/banlist.md — the anti-generic contract, shared by art-direction and qa-gate
# ---------------------------------------------------------------------------
cat > spec/banlist.md <<'EOF'
# Banlist — binding unless spec/brief.md explicitly requests the item

## Visual defaults that read as machine-generated
- Purple/blue gradient hero, or any gradient-filled headline text.
- Cream (#F4F1EA-ish) background + high-contrast serif display + terracotta/clay accent (~#D97757).
- Near-black background with a single acid-green or vermilion accent.
- Broadsheet pastiche: hairline rules, zero radius, dense newspaper columns.
- Inter / Geist / Poppins / Montserrat as the display face.
- Untouched shadcn defaults: rounded-xl + 1px ring + soft shadow card grids.
- Centred hero headline + subhead + two buttons.
- Nav as logo-left / three-links-centre / sign-in-right.
- Three-icon feature row using Lucide icons.
- Emoji used as iconography.
- Stock photography of people pointing at laptops.
- `01 / 02 / 03` markers where the content is not actually a sequence.

## Motion
- Decorative scroll lines, meteor/comet trails, cursor-following glows, aurora blobs,
  animated gradient meshes, floating 3D shapes.
- More than one orchestrated moment per page.
- Any animation over 400ms that is not the signature element.
- Any animation not disabled under `prefers-reduced-motion`.

## Copy
- "In today's fast-paced world", "Unlock/Elevate/Empower/Transform your…",
  "We don't just X, we Y", "It's not about X — it's about Y", "seamless",
  "cutting-edge", "game-changing", "solutions" as a standalone noun, "journey".
- Any headline that stays true when the company name is swapped for a competitor's.
- Any proof not present in the brief's PROOF INVENTORY.

## Test
For every visual decision: if the same brief given to ten studios using AI tools would
produce this, it is a default, not a choice. Revise and say what changed and why.
EOF

for f in brief message-map art-direction ia query-map qa-report growth-plan; do
  [ -f "spec/$f.md" ] || printf '# %s\n\n_Not written yet. Run the matching stage skill._\n' "$f" > "spec/$f.md"
done

cat > spec/references/README.md <<'EOF'
Drop 3–5 screenshots or URLs per project here, each with a one-line note saying what
you want from it (proportions, type treatment, density, restraint).

A reference is a constraint. "Premium" is an adjective the model resolves to its median.
Skills read this directory; an empty directory means the design brief is under-specified.
EOF

# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------
mkdir -p .claude/skills/{intake,positioning,art-direction,architecture,copy,build,qa-gate,growth}

cat > .claude/skills/intake/SKILL.md <<'EOF'
---
description: Turn raw client material (transcripts, emails, old site copy) into spec/brief.md. Use at the start of a new client project, or when the brief needs updating after a client call.
argument-hint: [paste or path to raw material]
---

Write `spec/brief.md` with exactly these sections:

1. BUSINESS FACTS — what they sell, to whom, at what price, in which markets and
   languages, legal entity and jurisdiction, how they get customers today.
2. THE ONE JOB — the single commercial action this site must produce, in one sentence.
   If several candidates exist, rank them and mark one PRIMARY.
3. AUDIENCE — up to 3 segments. Each: the trigger event that starts the search, what they
   type into a search box or an LLM, what they fear, what makes them abandon a vendor,
   who else they are evaluating.
4. PROOF INVENTORY — every credibility asset, categorised HAVE (with actual content) /
   CAN GET (with who to ask) / DOES NOT EXIST. Nothing from the third category ships.
5. SUBJECT MATERIAL — the client's own vernacular, tools, artifacts, processes, owned
   photography. Concrete nouns only. This is the raw material for art direction.
6. CONSTRAINTS — existing brand assets, CMS the client must operate, hosting,
   integrations, budget, deadline, regulatory exposure.
7. OPEN QUESTIONS — numbered, each answerable in one line by the client.

Transcribe, do not embellish. Anything you infer goes under a separate INFERENCE heading.
Every unanswered item in §7 is a future fabrication risk: list it, do not fill it.

Material: $ARGUMENTS
EOF

cat > .claude/skills/positioning/SKILL.md <<'EOF'
---
description: Derive positioning, message hierarchy and voice into spec/message-map.md. Use after intake, before any design or copy work.
---

Read `spec/brief.md`. Write `spec/message-map.md`:

1. CATEGORY & CONTRAST — the category the visitor files this business under, and the one
   axis on which it is not interchangeable. State explicitly what the business is worse
   at. A positioning with no sacrifice is not a positioning.
2. VALUE PROPOSITION — three materially different versions: outcome-led, mechanism-led,
   identity-led. Each with: the proposition, who it wins, who it loses, and the strongest
   counter-argument a sceptical buyer raises. Recommend one and justify.
3. MESSAGE HIERARCHY — the ordered beliefs the visitor must acquire for the PRIMARY
   action to happen. Each: claim, supporting proof (PROOF INVENTORY only), objection killed.
4. OBJECTION LEDGER — the 6–10 real reasons this buyer does not convert, each mapped to
   the page element that answers it.
5. VOICE — 5 rules and 5 anti-rules, each with a rewritten example taken from the
   client's existing material. Rules, not adjectives.
6. UNANSWERED — every belief in §3 with no proof behind it. This goes back to the client
   verbatim as homework.
EOF

cat > .claude/skills/art-direction/SKILL.md <<'EOF'
---
description: Lock the visual system into spec/art-direction.md and src/styles/tokens.css. Use before any component or page is built. This is the stage that decides whether the site reads as machine-generated.
model: inherit
effort: high
---

## Binding constraints
```!
cat "${CLAUDE_PROJECT_DIR}/spec/banlist.md" 2>/dev/null || true
```

## References supplied for this project
```!
ls -1 "${CLAUDE_PROJECT_DIR}/spec/references" 2>/dev/null || true
```

If the references directory holds nothing but the README, say so and ask for 3–5
references before proposing anything. Do not substitute adjectives for references.

## Task
Read `spec/brief.md` and `spec/message-map.md`. Work in two passes and show me both.

**Pass 1 — three materially different directions.** Not three palettes of one idea:
three different arguments about what this business is. Each direction gives:
- Thesis in one sentence, traced to something concrete in brief §5 SUBJECT MATERIAL.
- Palette: 5–6 named values in OKLCH, with the reasoning for the hue family and a stated
  contrast strategy. No gradient as the primary identity device.
- Typography: named real typefaces for display / body / utility, with licence status and
  self-hosted file sizes. Type scale with an explicit ratio, and where it breaks on purpose.
- Layout system: grid, asymmetry rule, density rule, ASCII wireframe of the hero and one
  interior section.
- SIGNATURE: the single element this site is remembered by. One only.
- The one real aesthetic risk taken, and the argument for it.

**Pass 2 — self-critique before I choose.** For each direction answer honestly: if this
brief went to ten other studios using AI tools, how many arrive here? Anything above
2/10 gets revised, and you state what changed and why.

## Output
- `spec/art-direction.md` — the chosen direction, in full, including the rejected two and
  why they lost.
- `src/styles/tokens.css` — CSS custom properties only: colour, type scale, spacing scale,
  radius, shadow, motion duration and easing, container widths, breakpoints. Every later
  stage consumes these and may not introduce a raw value.

ultrathink
EOF

cat > .claude/skills/architecture/SKILL.md <<'EOF'
---
description: Produce the sitemap, template inventory, locale plan and the SEO/GEO query and entity map into spec/ia.md and spec/query-map.md. Use after art direction is locked, before copy.
---

Read `spec/brief.md`, `spec/message-map.md`, `spec/art-direction.md`.

## spec/ia.md
1. SITEMAP — every URL, its single job, funnel position, internal links in and out.
   URL scheme stated as a rule.
2. TEMPLATE INVENTORY — the minimum set of templates and the components each needs.
   Flag every component used on 3+ templates; those are built once.
3. NAVIGATION — primary, footer, crawl path. Justify every item; an item serving no
   segment in brief §3 is removed.
4. INTERNATIONAL — locale strategy (subfolder vs subdomain vs ccTLD) with the trade-off
   stated, hreflang matrix including x-default, currency/unit/date handling, and which
   pages are translated vs transcreated vs market-specific. Machine-translated sales copy
   does not ship.
5. CMS MODEL — content types and fields, designed so a non-technical editor cannot break
   the layout.

## spec/query-map.md
6. One page = one intent cluster. Per page: the primary question in the user's own words,
   5–15 real long-tail phrasings including full-sentence and conversational forms, and the
   pages currently answering them.
7. ENTITY MAP — organisation, people, products, services, locations to establish as
   entities, the pages and markup that establish each, and the external corroboration list
   (registries, profiles, directories, publications) where naming must stay consistent.
8. ANSWER BLOCKS — per page, the extractable 40–60 word direct answer that sits near the
   top, before the persuasion, written to survive being quoted out of context.
9. SCHEMA PLAN — JSON-LD types per template with required and recommended properties.
   Every schema statement must match visible page content. No FAQPage without a real FAQ.

Note in the file: Google's documented position is that no AI-specific markup, file, or
schema is required for AI Overviews or AI Mode eligibility — indexability and snippet
eligibility are the requirements. Do not sell or build tactics that contradict this.
EOF

cat > .claude/skills/copy/SKILL.md <<'EOF'
---
description: Write page copy into copy/<page>.md, constrained by the brief, message map, IA and query map. Use after architecture, before or alongside build.
argument-hint: [page-slug | all]
---

## Binding constraints
```!
cat "${CLAUDE_PROJECT_DIR}/spec/banlist.md" 2>/dev/null || true
```

Read all upstream artifacts. Write `copy/<page>.md` for: $ARGUMENTS

Per page, in this order:
- `<title>` (≤60 chars) and meta description (≤155), written as a promise not a summary.
- H1, then the answer block from `spec/query-map.md` §8.
- Section-by-section copy keyed to the message hierarchy. For each section state which
  belief it installs and which objection it kills. A section doing neither is cut.
- Every CTA: the label (a verb naming exactly what happens next), the friction-removing
  micro-copy under it, and what the visitor sees immediately after clicking.
- Alt text for every image slot, written for a screen reader user, not for keywords.
- Form fields, error, empty, success and confirmation states.

Rules: one idea per sentence; concrete nouns over category nouns; active voice; the button
that says "Publish" produces a toast that says "Published"; errors explain what happened
and how to fix it and do not apologise; specific beats clever. State the target reading
level at the top of each file.

Test every headline by swapping in a competitor's name. If it still reads true, rewrite it.

For the primary page produce two materially different directions (different lead,
different belief order) so they can be A/B tested, and say which you expect to win and on
what mechanism.
EOF

cat > .claude/skills/build/SKILL.md <<'EOF'
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
EOF

cat > .claude/skills/qa-gate/SKILL.md <<'EOF'
---
description: Adversarial pre-delivery audit producing spec/qa-report.md. Use before showing anything to a client and before every deploy.
context: fork
agent: qa-auditor
background: false
disable-model-invocation: true
---

## Banlist
```!
cat "${CLAUDE_PROJECT_DIR}/spec/banlist.md" 2>/dev/null || true
```

## Automated check output
```!
cd "${CLAUDE_PROJECT_DIR}" && bash scripts/check-tokens.sh 2>&1 || true
```

You were hired by the client to find reasons not to pay the final invoice. Read the
artifacts in `spec/`, review the built site, write `spec/qa-report.md`:

A. CONTRACT COMPLIANCE — every budget in CLAUDE.md, PASS/FAIL with measured evidence.
   "Looks fast" is not evidence.
B. AI-TELL AUDIT — walk the banlist item by item and report every violation that crept
   back in during build. Then name the three elements a designer would call the most
   templated on this site, and fix them.
C. ARTIFACT DRIFT — every place the built site contradicts `art-direction.md`,
   `tokens.css`, `message-map.md` or `ia.md`. Every raw value that bypassed the tokens.
D. TRUST AUDIT — anything a buyer could read as fabricated, unverifiable or legally
   exposed. Every remaining `[CLIENT INPUT REQUIRED]`. Unlicensed imagery or fonts.
   Claims needing substantiation under consumer-protection law.
E. FAILURE MODES — JS disabled, slow 3G, 400% zoom, screen reader only, a 60-character
   company name, an empty CMS field, a 2000-word testimonial, an RTL locale, a client who
   edits the hero badly.
F. CONVERSION LEAKS — every step between landing and the PRIMARY action, ranked by
   expected loss.
G. RANKED FIX LIST — impact × effort, each with the specific change. No generic advice.

A clean report on the first pass means you did not look hard enough. Say so if that is
what happened.
EOF

cat > .claude/skills/growth/SKILL.md <<'EOF'
---
description: Produce spec/growth-plan.md — measurement baseline, 90-day roadmap, content engine, handover and retainer scope. Use at launch.
---

Write `spec/growth-plan.md`:

1. MEASUREMENT — events mapping to the PRIMARY action, privacy-first analytics setup,
   consent-mode handling, and the launch baseline snapshot: CWV field data, current
   conversion rate, current query coverage. Without a baseline there is no case study,
   and the case study is what sells the next project.
2. 90-DAY ROADMAP — one high-impact item per fortnight, each with hypothesis, metric and
   the decision rule for keeping or reverting.
3. CONTENT ENGINE — cadence and the first 10 pieces, each mapped to a query cluster and
   each built on information only this client possesses: original data, their process,
   their numbers, named expertise.
4. EXTERNAL CORROBORATION — off-site work that makes the entity legible: consistent naming
   across registries and profiles, publications, partner pages, genuine citations.
5. HANDOVER — editor's guide, token map, the "what breaks if you change this" note,
   maintenance scope.
6. RETAINER — ongoing scope with a visible monthly deliverable. Priced.
EOF

# ---------------------------------------------------------------------------
# Subagents
# ---------------------------------------------------------------------------
cat > .claude/agents/qa-auditor.md <<'EOF'
---
name: qa-auditor
description: Hostile pre-delivery reviewer for client websites. Finds contract violations, design defaults, accessibility failures and fabricated proof. Use before any client hand-off.
tools: Read, Grep, Glob, Bash
---

You are a reviewer paid by the client, not by the studio. Your incentive is to find
reasons the work does not meet the contract.

Report only what you can evidence. Run the checks rather than reasoning about them:
build the site, read the generated HTML, grep the source, run the scripts in `scripts/`.
Measured numbers beat impressions. When you cannot measure something, say UNKNOWN and
name the measurement that would settle it.

Never soften a finding to be agreeable. Never pad the report with invented criticism
either — a fabricated finding costs the studio real time and destroys the value of the
report. Rank findings by what a paying client would actually withhold money over.
EOF

cat > .claude/agents/design-critic.md <<'EOF'
---
name: design-critic
description: Reviews a design direction or built page for genericness, drift from the locked tokens, and unjustified decoration. Use when a page feels templated or before locking art direction.
tools: Read, Grep, Glob
---

You are a design lead at a studio known for work that cannot be mistaken for anyone
else's. You are reviewing, not producing.

For anything you review, answer three questions in order:
1. If this brief went to ten studios using AI tools, how many arrive here? Above 2/10 is
   a default, not a choice.
2. Which single element is this page remembered by, and is everything else quiet enough
   to let it land?
3. What would you remove? Name one thing on every review.

Trace each judgement to the brief's subject material or to `spec/art-direction.md`.
Taste asserted without a reason is not a critique.
EOF

# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------
cat > .claude/hooks/stage-guard.sh <<'EOF'
#!/usr/bin/env bash
# PreToolUse on Write|Edit. Exit 2 blocks the call and shows stderr to Claude.
# Enforces: no source code before the visual system is locked.
set -uo pipefail
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

case "$FILE" in
  */src/*|*/app/*|*/components/*)
    if [ ! -s "spec/art-direction.md" ] \
       || grep -q 'Not written yet' "spec/art-direction.md" 2>/dev/null \
       || ! grep -q '[^[:space:]]' "src/styles/tokens.css" 2>/dev/null; then
      echo "BLOCKED: spec/art-direction.md and src/styles/tokens.css must exist and be non-empty before writing $FILE. Run /art-direction first." >&2
      exit 2
    fi
    ;;
esac
exit 0
EOF

cat > .claude/hooks/token-guard.sh <<'EOF'
#!/usr/bin/env bash
# PostToolUse on Write|Edit. Observability only: stderr is shown to Claude, which will fix.
# Flags raw design values that bypassed tokens.css.
set -uo pipefail
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

[ -f "$FILE" ] || exit 0
case "$FILE" in
  *tokens.css) exit 0 ;;
  *.css|*.tsx|*.jsx|*.astro|*.vue|*.svelte) ;;
  *) exit 0 ;;
esac

HITS="$(grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|[0-9]+px' "$FILE" | grep -vE '1px|0px|var\(--' | head -20 || true)"
if [ -n "$HITS" ]; then
  {
    echo "TOKEN DRIFT in $FILE — raw design values found. Replace with var(--…) from src/styles/tokens.css:"
    echo "$HITS"
  } >&2
fi
exit 0
EOF

cat > .claude/hooks/session-context.sh <<'EOF'
#!/usr/bin/env bash
# SessionStart. Plain stdout is injected into context, so this is the cheapest way to
# put pipeline state in front of the model on every session.
set -uo pipefail
echo "## Pipeline state"
for f in brief message-map art-direction ia query-map qa-report growth-plan; do
  p="spec/$f.md"
  if [ -s "$p" ] && grep -q 'Not written yet' "$p" 2>/dev/null; then
    echo "- $f: NOT WRITTEN"
  elif [ -s "$p" ]; then
    echo "- $f: written ($(wc -l < "$p" | tr -d ' ') lines)"
  else
    echo "- $f: NOT WRITTEN"
  fi
done
if [ -s "src/styles/tokens.css" ]; then echo "- tokens.css: present"; else echo "- tokens.css: MISSING — src/ is write-blocked"; fi
echo "Next stage is the first NOT WRITTEN artifact in that order."
EOF

chmod +x .claude/hooks/*.sh

cat > .claude/settings.json <<'EOF'
{
  "permissions": {
    "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./**/*.pem)"]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-context.sh\"" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/stage-guard.sh\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/token-guard.sh\"" }
        ]
      }
    ]
  }
}
EOF

# ---------------------------------------------------------------------------
# Local checks
# ---------------------------------------------------------------------------
cat > scripts/check-tokens.sh <<'EOF'
#!/usr/bin/env bash
# Fails when component source carries raw design values instead of tokens.
set -uo pipefail
STATUS=0
FILES="$(find src app components -type f \( -name '*.css' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.astro' -o -name '*.vue' -o -name '*.svelte' \) 2>/dev/null | grep -v 'tokens.css' || true)"
[ -z "$FILES" ] && { echo "check-tokens: no source files yet"; exit 0; }
for f in $FILES; do
  HITS="$(grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' "$f" | grep -v 'var(--' || true)"
  if [ -n "$HITS" ]; then echo "TOKEN DRIFT $f"; echo "$HITS"; STATUS=1; fi
done
exit $STATUS
EOF
chmod +x scripts/check-tokens.sh

cat > lighthouserc.json <<'EOF'
{
  "ci": {
    "collect": {
      "numberOfRuns": 3,
      "settings": { "preset": "desktop" }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.95 }],
        "categories:accessibility": ["error", { "minScore": 1 }],
        "categories:seo": ["error", { "minScore": 1 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2000 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05 }],
        "total-blocking-time": ["error", { "maxNumericValue": 150 }],
        "unused-javascript": ["warn", { "maxNumericValue": 20000 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
EOF

cat > tests/a11y.spec.ts <<'EOF'
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = ['/']; // extend from spec/ia.md sitemap

for (const route of routes) {
  test(`no accessibility violations: ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test(`keyboard focus is visible: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`;
    });
    expect(outline).not.toBeNull();
    expect(outline).not.toMatch(/^none\|0px\|none$/);
  });
}
EOF

cat > .github/workflows/quality.yml <<'EOF'
name: quality
on: [push, pull_request]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - name: Design tokens not bypassed
        run: bash scripts/check-tokens.sh
      - run: npm run build
      - name: Accessibility (axe, WCAG 2.2 AA)
        run: npx playwright install --with-deps chromium && npx playwright test
      - name: Performance budgets (Lighthouse CI)
        run: npx @lhci/cli autorun
      - name: Structured data present
        run: |
          grep -rq 'application/ld+json' dist/ || { echo "No JSON-LD in build output"; exit 1; }
EOF

cat > README.md <<'EOF'
# Web studio site template

Stage-gated website production for Claude Code. `CLAUDE.md` holds the rules,
`.claude/skills/` holds the eight pipeline stages, `.claude/hooks/` enforces the two
rules that must not be negotiable, and `spec/` is the memory that keeps every page
consistent with every other page.

## Start a project
1. Create a repo from this template.
2. Drop 3–5 design references into `spec/references/`.
3. `claude`
4. `/intake` with the raw client material, then walk the pipeline in order.
   The SessionStart hook tells you which stage is next.

## The gates
- `stage-guard.sh` blocks writes to `src/` until the visual system is locked.
- `token-guard.sh` reports raw colour and spacing values back to Claude on every edit.
- CI fails on token drift, accessibility violations, performance budgets, and missing JSON-LD.

Instructions in `CLAUDE.md` are followed most of the time. Hooks and CI are followed
every time. Anything that must not happen belongs in the second category.
EOF

echo "Scaffolded: $(pwd)"
find . -type f | sort
