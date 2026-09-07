# QA report — Workler site

**Stage:** `/qa-gate`, 2026-09-08. Build under audit: `dist/`, 11 pages, `node build.mjs`.
**Method:** measured where measurement was possible, and marked UNMEASURED where it was not. Every
PASS below carries the number it passed on.

**Headline: this build must not be deployed.** Not because of how it is made — the contract
budgets pass with a large margin — but because the page that carries the site's one job has no
price on it, and the section that substitutes for social proof is a placeholder. Twelve
`[CLIENT INPUT REQUIRED]` markers remain. `node build.mjs --strict` now fails on all of them, which
is the gate this report added.

---

## A. CONTRACT COMPLIANCE

| Budget (CLAUDE.md) | Result | Measured evidence |
|---|---|---|
| First-load JS ≤ 60KB gz | **PASS** | **0 bytes.** `document.querySelectorAll('script:not([type="application/ld+json"])').length === 0` on the built home page. There is no client-side JavaScript on this site at all. |
| Zero third-party scripts | **PASS** | 0. No external origin is contacted by any page; there is no analytics, no font CDN, no consent banner. |
| Page weight | **PASS** | Home 7,729 bytes raw / **2,752 gzipped**. CSS 19,032 raw / **5,284 gzipped** for both files. Entire `dist/` is 109KB including 11 pages, sitemap and robots. |
| Max 2 font families, 4 weights, self-hosted woff2 | **PASS on budget, FAIL against art direction** | 0 web fonts are loaded. The `@font-face` block is commented out pending the subset files, so the site renders in the system stack. Under budget; not the specified design. See C1. |
| WCAG 2.2 AA | **PASS on 4 of 11 pages** | axe-core 4.10.2 run in-browser against the built output with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`: **0 violations** on `/` (Home template), `/how-it-works` (Argument), `/pricing` (Pricing), `/attribution` (Document). All four templates covered; the other seven pages reuse them and were not individually run. |
| Responsive from 320px, no horizontal scroll | **PASS** | At 320×700: `scrollWidth === clientWidth === 320`. At 1280×900: `scrollWidth 1265 === clientWidth 1265`. |
| LCP ≤ 2.0s, CLS ≤ 0.05 lab | **UNMEASURED** | No Lighthouse run has been performed. `lighthouserc.json` had no `staticDistDir`, so `lhci autorun` had nothing to collect; that is now set to `./dist`. A 2.75KB gzipped document with no JS, no web fonts and no images is very likely to pass, but "very likely" is not evidence and this row stays UNMEASURED until CI runs. |
| `prefers-reduced-motion` respected | **PASS by inspection, UNMEASURED in a browser** | Both a global reduce block and token overrides exist. Not verified under an emulated preference. |
| Visible keyboard focus | **PASS by inspection, UNMEASURED** | `:focus-visible` sets a 2px `--color-focus` outline at 2px offset. The shipped Playwright test asserts this; it has not been run (no `node_modules` in this environment). |

**Two fixes to the CI harness itself, made during this audit.** `lighthouserc.json` could not
collect anything, and `tests/a11y.spec.ts` shipped with `routes = ['/']` — a site is not accessible
because its home page is. The route list is now all eleven URLs, and `playwright.config.ts` and
`package-lock.json` were missing entirely, so `npm ci` and `npx playwright test` would both have
failed at the first step. The quality workflow has never actually run green; it could not have.

---

## B. AI-TELL AUDIT

Banlist, item by item, against the built output.

| Banlist item | Status |
|---|---|
| Purple/blue gradient hero, gradient headline text | **Clean.** No `gradient` appears in any stylesheet. |
| Cream + high-contrast serif display + terracotta accent | **Clean.** Ground is cool (`oklch(98.5% 0.003 250)`), display face is a grotesk, and the one chromatic value is amber at hue 65 — distinct from the banned clay at roughly hue 40 and higher lightness. |
| Near-black background + single acid accent | **Clean.** Light ground. |
| Broadsheet pastiche | **Clean.** No hairline rule grid, no multi-column body text. |
| Inter / Geist / Poppins / Montserrat as display | **Clean by specification, unverifiable in practice.** The stack names Instrument Sans; with no font files loaded the site currently renders in whatever `ui-sans-serif` resolves to on the visitor's OS. Not a banned face, but not a chosen one either. |
| Untouched shadcn defaults (rounded-xl + ring + soft shadow cards) | **Clean.** `--radius-sm` is 2px, `--shadow-none` is `none`, and cards exist only for records. |
| Centred hero headline + subhead + two buttons | **Clean.** Left-aligned hero, one button and one text link, with a score card in the right margin. |
| Nav as logo-left / links-centre / sign-in-right | **Clean.** Logo left, links right, no sign-in. |
| Three-icon feature row / Lucide / emoji as iconography | **Clean, structurally.** No icon library is installed and no icon appears anywhere. |
| Stock photography | **Clean.** No images at all. |
| `01 / 02 / 03` markers on non-sequences | **Clean.** A–G is a real sequence in the product. |
| Motion: decorative effects, >1 orchestrated moment, >400ms, not disabled under reduced-motion | **Clean.** One transition exists (the score bar, 320ms) and it is disabled under `prefers-reduced-motion`. |
| Copy banlist ("seamless", "cutting-edge", "empower", "journey", "solutions"…) | **Clean.** Zero matches across all built pages. |
| "Scraping" in any tense (brief §6) | **Clean.** Zero matches in `dist/`, `src/` or `copy/`. |

### The three most templated elements on this site

1. **The section rhythm.** Almost every section is `h2` → two paragraphs → a link, at identical
   spacing, down every page. It is legible and it is also the default shape of every
   AI-assisted marketing page. **Fix:** the Argument template should alternate — let
   `/how-it-works` carry the A–G table and the threshold rule as structural breaks (it does), and
   give `/ghost-jobs` a different internal shape from `/rights`, which currently share one.
   *Not yet applied; it is a design pass, not a patch.*
2. **The `.records` grid on `/pricing`.** Two bordered boxes side by side is the universal pricing
   table. **Fix:** the tier comparison should be a single table with a shared row axis, so the
   *boundary* between free and paid is one continuous line rather than two separate columns to
   compare by eye. That change also serves objection 7, which is the page's actual job.
   *Blocked on the pricing facts anyway.*
3. **The CTA button.** A dark rectangle with 2px radius is the most generic element on the site.
   **Fix applied in part:** it is ink rather than a brand colour, which at least keeps it inside
   the colour licence. The remaining move is to give it the threshold rule as an underline instead
   of a fill, so the signature carries the primary action. *Recommended, not applied — it changes
   the hit area and needs a contrast re-test.*

---

## C. ARTIFACT DRIFT

| # | Drift | Severity |
|---|---|---|
| **C1** | **The specified typefaces are not loaded.** `spec/art-direction.md` chose Instrument Sans and IBM Plex Mono; `src/styles/base.css` has the `@font-face` block commented out until subset woff2 files exist. Every typographic decision in the art direction is therefore currently unverified — including "every numeral is mono and tabular", which falls back to the OS monospace. | **High.** The visual system as specified has never been seen. |
| **C2** | **A raw value had escaped into markup.** The score bar carried `style="width:56%"`. `scripts/check-tokens.sh` never caught it because it scans `.css`, `.tsx`, `.jsx`, `.astro`, `.vue` and `.svelte` — and this site's components are `.html`. **Fixed:** the width is now a `--bar-fill` custom property. **The gap in the checker remains:** a raw hex colour in any page file would ship undetected. Extend the glob to `.html`. | **Medium**, and the checker gap is the real finding. |
| **C3** | **"The threshold rule appears at most once per viewport" is a rule with no enforcement.** The lockup's rule and a section's threshold rule can co-occur in the same viewport at desktop. | **Low.** Cosmetic, but it is the signature. |
| **C4** | **Physical direction properties throughout.** Six occurrences of `padding-left`, `border-left` and `left:` in `base.css`. `spec/ia.md` §4 plans a `de` locale now and does not rule out an RTL market later; these would need rewriting to logical properties (`padding-inline-start`, `border-inline-start`) at that point. Cheap now, tedious later. | **Low now, Medium at the second locale.** |

Everything else in `tokens.css` is consumed as specified: no component introduces a colour, size,
space or radius outside the token set, and `scripts/check-tokens.sh` passes.

---

## D. TRUST AUDIT

This is the section that stops the deploy.

| # | Finding |
|---|---|
| **D1** | **Twelve `[CLIENT INPUT REQUIRED]` markers survive into the built HTML**, on `/`, `/how-it-works`, `/ghost-jobs`, `/open-source`, `/pricing`, `/rights`, `/privacy`, `/terms`, `/about`, `/accessibility`. They render in a loud dashed amber box, deliberately — but a loud box in production is still a production defect. **Fixed structurally:** `node build.mjs --strict` now fails the build on any surviving marker, and that is the command a deploy must run. |
| **D2** | **Every claim-with-receipt is unresolved.** Ten `.claim` elements exist and all ten have `data-receipt="[CLIENT INPUT REQUIRED: repository URL…]"`; their visible "Receipt →" links currently point at other pages of this site rather than at files. **This is the single most serious trust problem in the build.** The whole site's argument is "every claim links to the thing that proves it" (brief §4). A sceptic who clicks a receipt and lands on more marketing copy learns that the mechanism is decorative. Better to ship fewer claims with real links than ten with none. |
| **D3** | **Unverified numbers are on a public page.** `/open-source` states 33 modes, 18 vocabulary sets, 80 provider modules, 10 CLIs. These come from the v1.24.0 checkout and a 2026-08-04 audit baseline (brief §1), not from the code as it stands today. Numbers on a public page get counted by exactly the audience this page targets. Re-verify at build time or remove them. |
| **D4** | **`https://workler.example` is baked into every canonical, every `og:url` and every JSON-LD `@id`.** It is overridable with `SITE_ORIGIN`, but nothing enforces that it was overridden. A deploy that forgets the variable ships a site whose structured data points at a domain nobody owns. **Recommend:** fail the strict build when `SITE_ORIGIN` is unset. |
| **D5** | **No `og:image` and no favicon.** Both are blocked on trademark clearance and shipping a placeholder would be worse (the OG card is the asset that gets screenshotted). The cost is real and should be named: every share of this site renders as a bare link, and every browser tab shows a default icon. |
| **D6** | **The `Organization` JSON-LD carries no legal name, address or founding date**, correctly, because the entity is unknown. It is a three-property Organization. That is honest and it is also thin; it will not establish an entity on its own until `/about` and external profiles exist (query-map §2). |
| **D7** | **Fonts and licensing: clean.** No font files are shipped, so there is no licence exposure. When they are added, both faces are SIL OFL 1.1 and self-hosting is permitted. |
| **D8** | **No unsubstantiated claim found in the shipped copy.** No testimonial, no user count, no success rate, no "trusted by", no star count, no compliance badge, no upstream brand asset. The `/rights` AI Act paragraph states an open question rather than a compliance claim, which is the correct and defensible position under consumer-protection law. |
| **D9** | **Blocked pages were indexable.** `/privacy`, `/terms`, `/about`, `/accessibility` and `/pricing` were in `sitemap.xml` with no `noindex`. A placeholder page in the search index is a trust cost that outlives the placeholder. **Fixed:** blocked pages now emit `<meta name="robots" content="noindex">` and are excluded from the sitemap. |

---

## E. FAILURE MODES

| Scenario | Result |
|---|---|
| **JavaScript disabled** | **Full function.** There is no JS, so nothing degrades. Measured: 0 script elements beyond JSON-LD. |
| **Slow 3G** | 2.75KB gzipped document + 5.28KB CSS, no images, no fonts. First paint is effectively immediate. |
| **400% zoom** | **UNTESTED.** WCAG 2.2 AA 1.4.10 requires reflow at 320 CSS px equivalent; the 320px result is a good proxy but not the same test. |
| **Screen reader only** | axe clean; the score bar now carries `role="img"` with a label naming the value, the maximum and the verdict, so the meaning does not depend on the coloured fill. The `.todo` boxes read out as raw internal instructions — acceptable pre-launch, unacceptable after, and the strict gate now prevents it. |
| **Colour vision deficiency** | The colour licence means colour is never the only carrier: a below-threshold score also has the word "Do not apply" and a numeral below 4.0. Passes 1.4.1 by construction. |
| **RTL locale** | **Would break.** See C4. |
| **A 60-character company name / long content in a slot** | `h1` is capped at 20ch and wraps; `p, li` are capped at `--measure`. No overflow observed. |
| **An empty content field** | The build fails on a missing or wrongly-sized `answer_block` and on a `.claim` with no `data-receipt`. Verified: all eleven pages pass the word-count rule. |
| **The client edits the hero badly** | Content lives in typed front matter with build-time validation, so the common breakages (missing title, over-long description, missing answer block) fail loudly rather than shipping. |

---

## F. CONVERSION LEAKS

Ranked by expected loss between landing and the PRIMARY action (purchase).

| Rank | Leak | Expected loss |
|---|---|---|
| 1 | **There is no price and no checkout.** The PRIMARY action does not exist. | **100%.** Nothing else on this list matters until it is fixed. |
| 2 | **The demo section is a placeholder.** The site's entire substitute for social proof — three real evaluations, one of them negative — is an amber box saying it is missing. | Very high. This is the element that was supposed to answer "nobody uses this". |
| 3 | **Receipts do not resolve** (D2). The proof mechanism is visible and non-functional, which is worse than not having it: it invites a click that disproves the claim. | High, concentrated in segment B — the segment most likely to click. |
| 4 | **`/privacy` is a placeholder.** Segment C's entire trigger event is unanswered, and they reach it from `/pricing`, one step from converting. | High for segment C. |
| 5 | **No `/about` and no named person.** On a site with no testimonials and no users, anonymity removes one of the few remaining trust signals. | Medium, and it is free to fix. |
| 6 | **No `og:image`.** Every share — the cheapest acquisition channel a site with no budget has — renders as a bare link. | Medium, blocked on clearance. |
| 7 | **The free CLI competes with the paid tier** and the boundary is undrawn (brief §7 Q4). `/open-source` currently sends a motivated visitor to a free product with no argument for the paid one. | Medium to high, unknowable until the boundary exists. |

---

## G. RANKED FIX LIST

Impact × effort. Specific changes only.

| # | Fix | Impact | Effort | Owner |
|---|---|---|---|---|
| 1 | **Supply the price and the free/paid boundary**, then write `/pricing` and wire a checkout. | Blocking | Founder decision + build | Founder |
| 2 | **Produce the three demo records** as `src/data/demo-records.json` — one below 4.0 with `do-not-apply`, one with `legitimacy_flag`. The build already validates both constraints and the component is already in place. | Blocking | Half a day of real evaluations | Founder |
| 3 | **Resolve the ten receipt URLs** to actual files in the public repository. If a claim has no file behind it, delete the claim rather than link it loosely. | Very high | An hour | Founder |
| 4 | **Counsel: `/privacy` and `/terms`.** They gate the launch and finish last, so start them first. | Blocking | External | Counsel |
| 5 | **Answer the `/about` question** and, if public, ship the page and the `Person` entity. | High | One decision | Founder |
| 6 | **Fail the strict build when `SITE_ORIGIN` is unset** (D4). Six lines. | High | 10 minutes | Build |
| 7 | **Extend `scripts/check-tokens.sh` to `.html`** (C2). One glob. | High relative to cost | 5 minutes | Build |
| 8 | **Add the two woff2 subsets and uncomment the `@font-face` block** (C1), then re-run the audit — the visual system has not actually been seen yet. | High | An hour | Build |
| 9 | **Run the CI workflow once, green.** It has never run: no lockfile, no Playwright config, no LHCI dist dir — all now added, none yet executed. Until it runs, the LCP and CLS rows in section A stay UNMEASURED. | High | CI run | Build |
| 10 | **Re-verify the counts on `/open-source`** against the current checkout, or remove them (D3). | Medium | 20 minutes | Founder |
| 11 | **Test at 400% zoom** and record the result (E). | Medium | 15 minutes | Build |
| 12 | **Break the section rhythm** on at least `/ghost-jobs` versus `/rights` (B, templated element 1). | Medium | Design pass | Design |
| 13 | **Convert physical direction properties to logical ones** (C4) before the second locale. | Low now | 20 minutes | Build |
| 14 | **Give the CTA the threshold rule as an underline** instead of a fill (B, templated element 3), then re-test contrast and hit area. | Low | Design pass | Design |

---

## Was this report clean on the first pass?

No — and the places it was not clean are worth naming, because two of them were in the harness
rather than the site. The CI workflow could never have passed: `package-lock.json`,
`playwright.config.ts` and the LHCI `staticDistDir` were all missing, and the accessibility suite
tested one page out of eleven. A quality gate that has never run is not a quality gate.

In the site itself the audit found a raw value that had escaped the token system through a file
type the checker does not scan, five placeholder pages that were indexable and in the sitemap, and
a set of proof links that all point at nothing. Three of those are fixed. The fourth is the most
important thing on the fix list after the price.
