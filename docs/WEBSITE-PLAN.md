# Website plan — Workler

**Status:** in build, 2026-09-07. Name = **Workler**; upstream relationship = **fork** (§0 Gate 3). Site repo scaffolded at `../workler-site`, `/intake` complete (`spec/brief.md`). The working copy of this plan now lives at `workler-site/spec/plan.md`; this file is the record of how it was decided.
**Method:** the stage-gated pipeline in `bootstrap-web-studio.sh` — `/intake → /positioning → /art-direction → /architecture → /copy → /build → /qa-gate → /growth`. This document is the input to `/intake` and the plan of record for every stage after it. Move it to `spec/plan.md` in the site repo once bootstrapped.
**Labels:** VERIFIED (checked in this checkout or a public API) · INFERENCE (follows from verified facts) · HYPOTHESIS (to test) · UNKNOWN (founder must answer).

---

## 0. Three gates before any brand investment

These are not risks to manage later. Each one changes what the site says, and two of them change what it is called.

### Gate 1 — The name is not usable as-is

- VERIFIED: `TRADEMARK.md` in this checkout reserves the "Jobber" name and brand to Santiago Fernández de Valderrama (santifer). Its own policy for forks: *"Naming a fork distinctly — pick your own product name."*
- VERIFIED: `package.json` `repository` → `github.com/santifer/jobber`; `SECURITY.md` → `hi@santifer.io`; `web/CHANGELOG.md` links `santifer/jobber` issues. The code lineage is unambiguous.
- INFERENCE: "Jobber" is also the established mark of Jobber Software (getjobber.com, field-service SaaS). A hosted SaaS under that name in classes 9/42 is a collision on two fronts — the upstream policy and a third-party mark.
- VERIFIED: `intake-material.md` §7.1 already names five candidates cleared at preliminary EUIPO/TMview screening: Kritir, Anakrin, Krinix, Ekloga, Workler. Full clearance in classes 9, 42, 35 outstanding.

**Name chosen, 2026-09-07: Workler.** From the §7.1 shortlist, preliminary EUIPO/TMview screening already passed. Full clearance in classes 9, 42 and 35 is still outstanding and remains counsel's week-1 task.

**Decision rule:** `/intake`, `/positioning` and `/architecture` proceed under Workler now. `/art-direction` may explore direction and tokens, but the **wordmark, favicon, OG images and domain purchase wait for full clearance** — those are the name-bound, expensive-to-redo artefacts. Same rule for the Gate 3 codebase rename.

**Critical path:** trademark clearance (2–4 weeks with counsel) runs in parallel with Stages 1–2 and is the longest pole in the schedule.

### Gate 2 — The proof inventory that is yours is close to zero

What the repo carries is largely upstream's, and cannot ship as this product's proof:

| Asset in checkout | Whose | Usable on the site? |
|---|---|---|
| `MANIFESTO.md` — "signed at 60,000 stars" | upstream (SIGNATURES.md is headed *"The CareerOps Manifesto"*, career-ops.org) | **No.** Not this product's number. |
| `.all-contributorsrc` — 193 contributors | upstream | **No.** |
| `SIGNATURES.md` — ~100 signature lines | upstream | **No.** |
| `docs/wordmark-*.svg`, `logo.png`, `hero-banner.jpg`, `og-image.jpg` | upstream brand, covered by TRADEMARK.md | **No.** Also 0.7–8.6 MB each — over budget by 20–100×. |
| `github.com/georgehadji/Jobber` | founder | VERIFIED via API 2026-09-07: **0 stars, 0 forks, 0 watchers**, created 2026-07-30 |

What *is* yours and verifiable (HAVE tier, small but real):

- VERIFIED: 91 commits on this repo, 45 by the founder's two accounts; 11 merged PRs; a public defect-hunt ledger of 19 batches (`docs/DEFECT-HUNT-LEDGER.md`, 2026-09-02 → 09-05) with a written assertion discipline (`AGENTS.md` "Writing Assertions"). This is engineering-rigour proof, not adoption proof — and it is the honest kind.
- VERIFIED (v1.24.0 checkout): 10 supported CLIs (`docs/SUPPORTED_CLIS.md`); 33 top-level skill modes plus the `interview/` set; 18 market vocabulary sets (ar, da, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, tr, ua, zh, zh-TW); 80 provider modules in `providers/`; 115 tracked companies, 52 search queries, 26 job boards in `portals.yml`; ~1,337 tests at the 2026-08-04 audit baseline (re-run before quoting).
- VERIFIED: the approval gate is enforced in code, not only in prompts — `web/test-submit-guard.mjs` exists; `AGENTS.md` makes "never submit" a hard rule; `LEGAL_DISCLAIMER.md` §3 states it.

**Decision rule:** the site is designed to convert with **zero social proof**. Proof comes from demonstration (the product doing the thing on the page), from openness (every claim links to the source file that implements it), and from stance (the promises the product makes against its own category). See §4. No testimonials, no user counts, no "trusted by", no success rates — `intake-material.md` §7.4 says this and the repo confirms there is nothing to put there.

### Gate 3 — RESOLVED: a distinctly named fork, maintained by the founder

**Founder decision, 2026-09-07: option (b).** Workler is a distinctly named fork of the MIT-licensed Jobber core, maintained by the founder. The free CLI is Workler CLI; the hosted service is the tier above it. The site sells both, and the OSS is a real acquisition channel rather than a link to someone else's project.

VERIFIED context: `intake-material.md` §2 describes the open-core model; §6 lists santifer/career-ops (472 stars) as the closest competitor to the core; `package.json` still says this checkout *is* santifer's project — which is precisely what the fork has to change.

What (b) commits you to:

| Consequence | Scope |
|---|---|
| Re-brand the codebase | `package.json` (name, repository, bugs, homepage), `AGENTS.md` / `CLAUDE.md` / `CODEX.md` / `OPENCODE.md` / `KIMI.md` / `GEMINI.md`, every `modes/*` file naming the product in prose, `web/`, `README.md`, `MANIFESTO.md`, `SECURITY.md` contact, `docs/*` |
| Own the update channel | `update-system.mjs` must resolve its remote version from the fork's repo. Left pointing upstream, `node update-system.mjs apply` re-brands the fork back to Jobber on the next release |
| Attribution, permanently | `TRADEMARK.md` permits *"based on Jobber"*. `/attribution` states origin, the MIT licence and the upstream author. Not optional, not a footnote |
| No upstream brand assets, ever | Gate 2 already rules them out for honesty; under (b) it is also the licence boundary — MIT covers the code, not the marks |
| The SECONDARY CTA has a target | `/open-source` sends the technical segment to the **fork's** repo, VERIFIED at 0 stars. This is exactly why §4 designs for zero social proof; the OSS page has to convert on the code and the docs, not on adoption |

**Blocked on Gate 1.** Every item above is name-bound. Clear the name first, rename once. A rename executed twice costs the entity work in §6 twice as well.

Also UNKNOWN from intake §7: pricing (Q2), launch state (Q3), the one commercial action (Q5), launch markets (Q6), legal entity and hosting jurisdiction (Q7), operator after launch (Q8), free/paid boundary (Q9), whether the SaaS keeps "recommend against applying below 4.0" (Q10). §13 collects them with the default this plan assumes for each.

---

## 1. The one job

**PRIMARY (assumed, pending Q3/Q5):** a qualified job seeker in an EU market enters the waitlist — or, if the SaaS is live at launch, starts a free trial.
**SECONDARY:** a technical visitor runs the open-source CLI today (GitHub click-through to the repo per Gate 3).
**TERTIARY:** a journalist, policy person or hiring professional reads the rights page and understands the stance.

If the SaaS is at concept stage with no build date, the honest PRIMARY is a waitlist that promises a specific thing (early access, a fixed price lock) and *not* a launch date. A waitlist with nothing behind it is the one place this site could start lying. HYPOTHESIS to test before launch: whether "run it yourself today (free, local)" out-converts "join the waitlist" among the technical segment — if it does, the two CTAs swap weight for that segment.

## 2. Audience — three segments (INFERENCE from product + intake; validate in `/intake`)

| Segment | Trigger event | What they type | What they fear | What makes them leave | Also evaluating |
|---|---|---|---|---|---|
| **A. The burnt applicant** — 80–300 applications sent, mostly silence; EU-based, mid-career, any function | A rejection from a role that was obviously a fit, or discovering a posting was fake/reposted | "is this job posting real", "why am I not hearing back", "ATS resume checker", "ghost jobs" | Wasting more months; a tool that spams on their behalf and burns their name | Anything that looks like another auto-applier; a signup wall before seeing how it works | Jobscan, Teal, LazyApply-class tools, a spreadsheet |
| **B. The technical seeker** — developer/data/product, already runs an AI coding CLI | Sees the repo, or a colleague's report output | "claude code job search", "open source job application tracker", "ATS scan greenhouse lever api" | Black-box scoring; vendor lock-in; their CV in someone's training set | Closed source, a hosted-only story, marketing over mechanism | career-ops, JobSpy, their own scripts |
| **C. The careful European** — privacy-literate, possibly in regulated employment, DACH/FR/NL/Nordics | Hesitation to upload a CV to a US tool | "GDPR job search tool", "Lebenslauf KI", "AI Act employment tools" | Their CV — with health gaps, union membership, referees' names — leaving the EU | Vague privacy copy; US hosting; no accessibility statement | Local-language CV tools, doing it by hand |

Segment A is the volume; B is the credibility engine and the early adopter; C is the differentiator the intake ranks #4 and that no US competitor leads with. Every page serves at least one; nav items serving none are cut (`/architecture` rule).

## 3. Positioning and message hierarchy

**Category the visitor files it under:** AI job-search tool.
**The axis on which it is not interchangeable:** it is the tool that *refuses* — refuses to auto-send, refuses to recommend a bad fit, refuses to trust a posting that looks fake.
**What it is worse at, stated on the site:** volume. If you want 200 applications sent this week, this is the wrong product. A positioning with no sacrifice is not a positioning; this sacrifice is also the thing the category's buyers are exhausted by.

Three value-proposition versions, per the `/positioning` skill:

| Version | Proposition | Wins | Loses | Sceptic's counter |
|---|---|---|---|---|
| Outcome-led | "Land a better role with fewer applications." | Segment A | Everyone who asks for the number — there is none to give | "Prove it." (cannot, Gate 2) |
| **Mechanism-led** | "Every posting scored A–G against your real CV, legitimacy-checked, and nothing sent without your yes." | B, then A | Buyers who want a magic button | "So it's just a checklist?" — answered by the live demo |
| Identity-led | "Companies have AI to filter you. This is the AI on your side of the table." | A, C | Buyers who find it grandiose | "Every tool says it's on my side." |

**Recommendation: mechanism-led as the spine, identity-led as the frame.** With zero adoption proof, the mechanism is the only claim the site can *demonstrate* rather than assert — and the demonstration doubles as the proof (§4). The identity line survives as the H1's second half and on the rights page, where the manifesto's rights (invisible by default; no proposal without your yes; your yes is human; you never pay; whoever searches shows themselves first) are the product's public commitments, restated as this product's, not quoted as upstream's.

**Message hierarchy** — the beliefs the visitor must acquire, in order, each with the only proof available:

1. *This tool evaluates before it does anything else.* → Interactive A–G demo on a canned posting (§4).
2. *It will tell me not to apply.* → The demo includes a posting scored 3.1/5 with the "recommend against" verdict visible.
3. *It catches fake postings.* → Block G demo on a ghost-job pattern (reposted 3× in 90 days); link to `detect-reposts.mjs`.
4. *It never sends anything for me.* → The un-pressed Submit as the visual signature (§7); link to the submit-guard test.
5. *My CV stays under my control.* → Local-first for the CLI (verified today); for the SaaS, the EU-hosting and deletion promises — **only once Q7 and a DPIA exist**. Until then this belief is installed for the CLI only.
6. *The scoring is not a black box.* → Methodology page publishing the rubric and linking the mode files.
7. *Someone serious maintains this.* → Public changelog, test count, defect ledger, security policy with a real response SLA.

**Objection ledger** (the page element that answers each):

| Objection | Answered by |
|---|---|
| "Another auto-applier." | Hero line 2 + the un-pressed Submit signature; "What it refuses to do" section |
| "I have no proof it works." | Live demo; methodology page; "no testimonials yet, here is the code instead" said out loud |
| "My CV will be misused / trained on." | Privacy page written for humans; CLI local-first fact; SaaS promises gated on Q7 |
| "It's for developers only." | Segment A landing path with zero terminal on it; SaaS tier framing |
| "Too expensive / unclear price." | Pricing page (Q2) — until decided, a single honest sentence, no placeholder tiers |
| "It only works for US-style resumes." | Markets page: 18 vocabulary sets, market-specific CV conventions |
| "AI tools hallucinate my experience." | "Reformulate, never fabricate" rule, with the `verify-cv-facts.mjs` guard linked |
| "Is this even legal in the EU?" | AI-transparency page: what the AI does, what a human decides, the Annex III question stated as open (§11) |
| "What if the company dies / I want out?" | Export (Markdown/TSV is the native format), deletion flow, MIT core |

**Voice** — five rules and five anti-rules, examples taken from existing material (`README.md`, `MANIFESTO.md`):

Rules: (1) Declarative sentences, one idea each — *"It recommends against applying below 4.0/5."* (2) Name the mechanism, not the benefit — *"queried through public APIs and feeds, no LLM cost"*, not "lightning-fast discovery". (3) Say what it will not do, in the negative — *"never submits, sends, or clicks anything."* (4) Concrete nouns from the product: report, score, tracker, posting, CV — not "journey", "solutions". (5) Admit limits in the same breath — *"The first evaluations will be mediocre, and that's expected."*
Anti-rules: no "unlock/elevate/empower/transform"; no "seamless", "cutting-edge"; no headline that stays true with a competitor's name swapped in; no exclamation marks; no claim without a link to the file that makes it true.

## 4. Proof strategy for a site with no social proof

Because Gate 2 removes every conventional proof device, the site needs three that do not depend on other people having used it:

**4.1 Demonstration — the product on the page.** A static, precomputed demo: three real-shaped postings (one strong fit 4.4/5, one recommend-against 3.1/5, one Block G "Likely Ghost" with a repost history). The visitor picks one and reads the actual A–G report rendered as it would be produced, with the score breakdown and the verdict. No LLM call at request time — the reports are generated once with the real tool, committed as content, and rendered by a single island. Cost: one Astro island, ≤15 KB JS. This is the highest-value element on the site and the hero's object.

**4.2 Openness — every claim links to its implementation.** "Zero-token scanning" → `scan.mjs`. "Never submits" → the submit-guard test. "Legitimacy check" → the Block G section of `modes/oferta.md`. "Never fabricates" → `verify-cv-facts.mjs`. Pending Gate 3, links go to upstream or to the fork. A category of black boxes; this is the one that opens.

**4.3 Stance — promises against the category.** A "What it refuses to do" section, and the rights page. Stance is proof only when it costs something: *"We will tell you not to apply. A product that reduces your applications is a strange thing to sell. We are selling it anyway."*

Explicitly out: fabricated testimonials, upstream's numbers, "as seen in", star counts, placeholder logos. If a real testimonial appears later, it goes in with a name and a link, and the "we have no testimonials yet" line is removed — never softened into "loved by".

## 5. Information architecture

**URL rule:** one page, one intent cluster, one job. Lowercase, hyphenated, no dates in URLs, no trailing slashes, locale as first path segment when locales exist (`/de/…`), `x-default` → English.

| URL | Job | Funnel | Template |
|---|---|---|---|
| `/` | Install beliefs 1–4, route to segment paths, PRIMARY CTA | Top | Home |
| `/how-it-works` | The A–G mechanism, the pipeline diagram, the demo in full | Mid | Long-form |
| `/ghost-jobs` | Belief 3 in depth; the repost/legitimacy check; the strongest SEO cluster the product owns | Top (search) | Long-form |
| `/what-it-refuses` | Beliefs 2 and 4; the stance page; the category contrast | Mid | Long-form |
| `/methodology` | Belief 6: rubric, weights, what a 4.0 means, limits | Mid (B) | Long-form |
| `/markets` | 18 vocabulary sets; market-specific CV conventions; locale roadmap | Mid (C) | Index + detail |
| `/markets/{de,fr,…}` | Per-market page in that market's terms (transcreated, not translated) | Top (search, local) | Detail |
| `/open-source` | Belief 7 and the SECONDARY action; relationship to upstream stated per Gate 3 | Mid (B) | Long-form |
| `/pricing` | Q2 answer; until then one paragraph, no tier grid | Bottom | Simple |
| `/waitlist` or `/start` | PRIMARY action; the form and its states | Bottom | Form |
| `/rights` | The five rights as this product's commitments | Cross | Long-form |
| `/privacy`, `/terms`, `/accessibility`, `/ai-transparency`, `/security`, `/attribution` (+ `/imprint` if DE/AT entity) | Legal and trust; §11 | Cross | Legal |
| `/changelog` | Belief 7; generated from the repo CHANGELOG | Cross (B) | List |
| `/docs` | **Not on this site.** Docs live with the code; the site links out. Keeps the site's job single. | — | — |

**Template inventory (minimum):** Home · Long-form · Detail (market) · Form · Legal · List. Components on 3+ templates, built once: header/nav, footer, CTA block, "claim → source link" inline component, code/terminal block, report card (from the demo), callout, FAQ item (real FAQs only, drawn from `docs/FAQ.md` where they apply to the product, not to CLI setup).

**Navigation (primary):** How it works · Ghost jobs · Markets · Open source · Pricing · [PRIMARY CTA]. Six items; "What it refuses" and "Methodology" are reached from the home page and footer — they serve beliefs, not entry. Footer carries legal, rights, changelog, security, attribution, GitHub.

**Locales:** English first. One additional market at launch, chosen by Q6 — German is the INFERENCE (largest EU market, `modes/de` is the most mature non-English set, and Segment C skews DACH). Subfolder strategy (`/de/`), hreflang matrix incl. `x-default`, currency in EUR everywhere, dates ISO. Market pages are transcreated by a native speaker, never machine-translated (`/architecture` rule). Greek is the founder's language and cheap to add; it is not a launch-market decision, it is a Q6 decision.

**CMS:** none at launch. Content is Markdown in the site repo (Astro content collections), copy files are `copy/*.md` from the pipeline, and the changelog is pulled from the product repo at build time. Add a CMS when Q8 names a non-technical operator; not before.

## 6. Query, entity and schema plan (`spec/query-map.md`)

Per page, the primary question in the visitor's words, plus long-tail and conversational phrasings — to be produced in full at `/architecture`. Seeds:

| Page | Primary question | Long-tail seeds |
|---|---|---|
| `/ghost-jobs` | "Is this job posting real?" | "how to tell if a job posting is fake", "job reposted every month", "ghost jobs 2026 how common", "why do companies post jobs they don't fill", "is [ATS] posting still open" |
| `/how-it-works` | "How does an AI evaluate whether a job fits me?" | "AI job match score explained", "compare my resume to a job description", "job fit score before applying" |
| `/what-it-refuses` | "Should I use an auto-apply tool?" | "do auto apply tools work", "lazyapply alternative that doesn't spam", "AI job search without mass applying" |
| `/markets/de` | "KI-Tool für die Bewerbung — was ist mit Datenschutz?" | "Lebenslauf KI DSGVO", "Bewerbung KI Tool Deutschland", "Stellenanzeige echt oder fake" |
| `/methodology` | "How is the score calculated?" | "what does a 4.0 fit score mean", "AI resume score transparent", "open source job evaluation rubric" |
| `/open-source` | "Can I run this myself?" | "open source job search agent claude code", "self-hosted job application tracker", "job search CLI" |

**Answer blocks:** each page carries a 40–60-word direct answer under the H1, written to survive being quoted alone. Example for `/ghost-jobs`: *"A ghost job is a posting an employer has no current intent to fill. Common signals: the same requisition reposted every 30–60 days, no closing date, a listing that stays open in the ATS feed after the role is filled. Workler checks postings against these signals before scoring fit."*

**Entities to establish:** the organisation (legal name per Q7), the product (SoftwareApplication), the founder (Person — only if the founder wants to be public), the open-source core (SoftwareSourceCode, with attribution). External corroboration list: GitHub org/repo, npm package page (if published under the new name), LinkedIn company page, Crunchbase/EU business register, the one or two directories that matter for the category (e.g., AlternativeTo). Naming must be identical everywhere; this is why Gate 1 precedes it.

**Schema (JSON-LD) per template:** Home → `Organization` + `SoftwareApplication` (`applicationCategory`, `operatingSystem`, `offers` only when pricing exists, no fabricated `aggregateRating`). Long-form → `Article` with `about`. Market detail → `Article` + `inLanguage`. FAQ items → `FAQPage` **only** where a visible FAQ exists. All → `BreadcrumbList`. Every property must match visible content.

**Machine readability:** server-rendered HTML for everything (Astro static); `robots.txt` that does not block AI crawlers unless the founder decides otherwise; `llms.txt` generated with the installed `geo-llmstxt` skill; sitemap.xml; canonical on every page. Google's documented position — no AI-specific markup is required for AI Overviews; indexability and snippet eligibility are — is noted in the file so nobody builds tactics that contradict it.

## 7. Art direction brief (input to `/art-direction`; the direction itself is that stage's output)

**Subject material — concrete nouns only (brief §5):** the evaluation report as a document (`reports/###-slug-date.md`, Blocks A–G, the Machine Summary YAML); the 1–5 score; the Legitimacy tier label; the tracker table with its nine columns; the terminal; TSV rows; the Submit button that is never pressed; the manifesto's short declarative lines; the 18 market names in their own scripts; the pipeline ASCII diagram in `README.md`; the redacted CV. The product's own artefacts are typographic and tabular — the visual language should come from *documents and evidence*, not from "AI".

**Signature candidates (one will be chosen):**
- *The un-pressed button.* A real, styled Submit/Send control, rendered in its hover state, with a cursor stopped just short — the product's whole stance in one element. Risk: cute. Argument: it is literally true, enforced in code, and no competitor can use it.
- *The report as hero.* The home page opens on an actual A–G report, typeset as a document, scrolling into the demo. Risk: dense above the fold. Argument: the object *is* the proof (§4.1).
- *The score that says no.* A 3.1/5 verdict, large, with "Recommend against applying" — the strange promise made visible first.

**Three directions required (`/art-direction` pass 1), as theses to explore — HYPOTHESIS:**
1. *Evidence.* Typeset like a well-produced technical report: a text face with real italics for body, a compact grotesk for data, a two-column rhythm, generous margins, rules only where tables need them. Colour as annotation, not decoration. Reads as "a serious instrument".
2. *Terminal, un-cliché'd.* Monospace as a *display* voice, not a code-block gimmick; dense, tabular, left-aligned, one accent colour taken from the tracker's status semantics. Risk of the banlisted "near-black + acid green" — the direction lives only if the palette avoids it.
3. *Civic.* The rights page as the origin: the visual register of a public document — a charter, a ballot, an official notice — in an EU-institutional key. Speaks to Segment C and the manifesto. Risk: cold.

**Constraints in force:** `spec/banlist.md` from the bootstrap, binding — no purple/blue gradient hero, no cream-and-terracotta, no Inter/Geist/Poppins/Montserrat display, no Lucide three-icon rows, no centred-hero-plus-two-buttons, no emoji iconography, one orchestrated motion moment per page max, everything off under `prefers-reduced-motion`. Note: `web/` (the product UI) uses `lucide-react` and `@paper-design/shaders-react` — the marketing site does not inherit the app's visual defaults; the app is the app.

**Typography and colour** are outputs of the stage (named typefaces with licence and woff2 sizes, OKLCH palette with contrast strategy, type scale with a stated ratio, `src/styles/tokens.css`). The plan fixes only the budget: ≤2 families, ≤4 weights, self-hosted, subset.

**References required before the stage runs:** 3–5 into `spec/references/`, each with one line on what is wanted. Gather: one technical-report or annual-report site with real typographic discipline; one software product page that leads with the product artefact rather than a device mock-up; one public-institution or charter page with a strong document register; one page whose *restraint* you admire; one you dislike, labelled why. An empty references directory means the brief is under-specified and the stage will say so.

**Imagery:** real product artefacts only — rendered reports, the tracker, the terminal — produced from the tool with sample data; no stock, no people pointing at laptops, no AI-generated "illustrations" of job seekers. Wordmark and logo are new, produced after Gate 1; the `design` and `graphic-designer` skills installed on this machine can drive exploration, but the chosen mark is a human decision.

## 8. Copy plan (`copy/*.md`)

Per page: `<title>` ≤60 chars written as a promise; meta ≤155; H1; answer block; sections each keyed to one belief and one objection (a section doing neither is cut); every CTA with a verb label, friction-removing micro-copy, and the post-click state; alt text for every image slot written for a screen-reader user; form field, error, empty, success and confirmation states. Reading level stated at the top of each file — target Grade 8 for Segment A pages, technical register permitted on `/methodology` and `/open-source`.

Home page ships as **two materially different directions** for A/B: (A) leads with the demo and the mechanism; (B) leads with the stance — "What it refuses to do" — and reaches the demo second. Expected winner: A for search traffic, B for referred traffic; the mechanism is that cold visitors need to see the object before they will read a stance.

Headline test: swap in a competitor's name. *"AI-powered job search, simplified"* survives the swap and is dead. *"It will tell you not to apply."* does not survive the swap. Ship the second kind only.

Sources for copy are the same as for everything else: `README.md`, `MANIFESTO.md` (rewritten as this product's commitments, not quoted as upstream's), `LEGAL_DISCLAIMER.md` (the CLI's posture — the SaaS's differs, §11), `intake-material.md`, and the founder's answers to §13. No other source introduces a factual claim.

## 9. Build plan

**Repository:** a new repo from the bootstrap template — run `./bootstrap-web-studio.sh [product]-site`, push it, and start there. Not inside this repo: the site is not part of the product's packaging, CI or updater, and the stage-guard hooks assume they own the tree.

**Stack (per the `/build` skill default, and the right call here):** Astro 5, static output, one island for the demo (§4.1), plain CSS consuming `src/styles/tokens.css` (Tailwind is optional and adds nothing a six-template site needs). No auth, no personalisation, no application surface on the marketing site → Next.js is not warranted. The product app in `web/` stays Next.js; the two do not share code, only tokens if the founder wants visual continuity later.

**Hosting and jurisdiction (Q7-dependent, decision needed):** Segment C and intake §4 differentiator #4 make EU hosting a positioning claim, so it has to be true. Options in order of least legal work: (1) static files on an EU-incorporated host with EU data centres, no US-entity CDN in front; (2) a US-headquartered CDN with an EU-region configuration — requires a transfer-impact analysis before the site says "EU-hosted". The plan assumes (1) until counsel says otherwise. The waitlist form posts to an EU-hosted endpoint (self-hosted or an EU processor with a DPA) — never to a US form SaaS by default.

**Analytics:** cookieless, privacy-first, EU-hosted or self-hosted (Plausible EU cloud, or Umami self-hosted). If genuinely cookieless and PII-free, no consent banner — confirm with counsel, since the banner-free claim is itself a compliance claim. Events: PRIMARY action, SECONDARY action, demo interaction (which posting picked), scroll to "what it refuses". Nothing else at launch.

**Budgets (acceptance criteria, enforced by `lighthouserc.json` and the quality workflow):** LCP ≤ 2.0 s and CLS ≤ 0.05 lab on Moto-G-class throttling; field LCP ≤ 2.5 s / INP ≤ 200 ms / CLS ≤ 0.1 at p75; first-load JS ≤ 60 KB gzipped (target ≤ 25 KB — only the demo island ships JS); fonts self-hosted woff2, subset, preloaded, `font-display: swap`; images AVIF + WebP, intrinsic dimensions, `fetchpriority="high"` on the LCP image, lazy below the fold; zero third-party scripts (analytics is first-party-hosted or justified in `spec/growth-plan.md`); zero layout shift from fonts, images or the (absent) consent banner.

**Accessibility (WCAG 2.2 AA — a legal floor under the EAA, not a target):** semantic landmarks; designed focus styles; contrast ≥ 4.5:1 body, ≥ 3:1 large text and UI boundaries; touch targets designed to 44 px; bound labels and programmatically associated errors on the form; no error-by-colour-alone; `prefers-reduced-motion` honoured; no accessibility overlay widget; the demo island fully keyboard-operable and readable as static HTML with JS disabled (render the first report server-side, enhance the switcher).

**Mobile-first literally:** base stylesheet at 320 px; verified at 320 / 360 / 390 / 768 / 1024 / 1440; no hover-only affordances; no horizontal scroll at any width.

**Machine markup:** JSON-LD per §6; canonicals; hreflang per §5; Open Graph and Twitter cards with real dimensions (1200×630, ≤ 200 KB — not the 5.7 MB `docs/og-image.jpg`); `sitemap.xml`; `robots.txt`; `llms.txt`.

**Demo content pipeline:** three postings authored as fixtures → evaluated once with the real tool (`oferta` mode) → the three reports committed under `src/content/demo/` → rendered by the island. Regenerate when the rubric changes; the reports carry the tool version in their footer so the demo never claims a newer capability than the one that produced it.

**CI (`.github/workflows/quality.yml` from the bootstrap):** token-drift check → build → axe (WCAG 2.2 AA tags) via Playwright → Lighthouse CI budgets → JSON-LD presence. Add: link check (no dead links to the product repo), and a grep gate for banlisted copy phrases and for the strings `60,000`, `193 contributors`, `trusted by` — the specific fabrication risks Gate 2 found, made mechanical.

## 10. QA gate (`spec/qa-report.md`, hostile reviewer)

Run the `qa-gate` skill with the `qa-auditor` subagent; then the installed `geo-audit`, `geo-schema`, `geo-technical` skills against the built output. Sections A–G per the skill: contract compliance with measured evidence; AI-tell audit against the banlist; artefact drift from `art-direction.md`/`tokens.css`/`message-map.md`/`ia.md`; trust audit (every remaining `[CLIENT INPUT REQUIRED]`, every claim without a source link, every statement about EU hosting, GDPR or the AI Act — see §11); failure modes (JS off, slow 3G, 400 % zoom, screen reader, a 60-character product name, an empty demo, an RTL locale); conversion leaks between landing and PRIMARY; ranked fix list.

Specific checks this plan adds: (1) no upstream number or asset anywhere in the build output; (2) the Submit signature is decorative *and* the real form's submit is unambiguous — the joke must not cost a conversion; (3) the demo's 3.1/5 posting actually renders the "recommend against" verdict; (4) every legal page exists with real content or the page and its nav link are absent — no "coming soon" legal pages.

A clean report on the first pass means the reviewer did not look.

## 11. Legal, regulatory and trust pages

VERIFIED baseline: `LEGAL_DISCLAIMER.md` describes the CLI — local execution, maintainers are not a controller or processor, no telemetry. **The SaaS inverts every one of those sentences.** The site must not reuse the CLI's disclaimer for the hosted tier.

| Page | Content | Gate |
|---|---|---|
| `/privacy` | Controller identity (Q7), lawful basis, categories (CVs routinely contain special-category and third-party data — say so), processors incl. every LLM provider under a DPA, retention, deletion flow, EU hosting statement, rights and contact | Cannot ship truthfully before the DPIA and processor DPAs exist |
| `/terms` | Service terms; no employment-outcome warranty; acceptable use mirroring `LEGAL_DISCLAIMER.md` §4–5 (no spam, no ToS violations, no mass applications) | Counsel |
| `/accessibility` | Accessibility statement — required by the EAA (enforceable since 2025-06-28; EN 301 549 / WCAG 2.1 AA benchmark; site built to 2.2 AA); known limitations; contact | Ship at launch |
| `/ai-transparency` | What the AI does (evaluates, drafts), what it never does (submits, sends), what a human decides, which models/providers, how to contest a score. The EU AI Act Annex III(4) question stated as **open** — a candidate-side tool's classification is not settled and the site makes no compliance claim until counsel does | Copy reviewed by counsel; no "AI Act compliant" wording |
| `/security` | Vulnerability disclosure, response SLA — this product's contact, not `hi@santifer.io` | Ship at launch |
| `/attribution` | Origin and lineage per `TRADEMARK.md` — MIT core, upstream author, what is and is not upstream's; open-source licences of site dependencies. Gate 3 = fork, so this page states the fork lineage in plain words, not a licence dump | Ship at launch |
| `/rights` | The five rights as this product's commitments, including "you never pay" — which must be reconciled with Q2 (a paid tier and "you never pay" cannot both be on the site unless the free tier is the seeker's and the paid tier is something else, e.g. an employer-side or team product). **This is a positioning decision, not a copy edit.** | Founder |
| `/imprint` | Only if the entity is in DE/AT (Impressumspflicht) | Q7 |

Language discipline site-wide: "public APIs and feeds", never "scraping"; "recommendation", never "guarantee"; "EU-hosted" only when true; "GDPR" only in sentences describing what is actually done.

## 12. Growth (`spec/growth-plan.md`, at launch)

**Measurement baseline at launch day:** CWV field data (CrUX will be empty; use RUM from the analytics tool), conversion rate on PRIMARY, query coverage snapshot from Search Console for the six clusters in §6. Without a baseline there is no case study.

**90-day roadmap (one item per fortnight, each with hypothesis, metric, decision rule):**
1. Home A/B (§8) — which lead wins per traffic source.
2. `/ghost-jobs` expansion — the cluster with the most independent search demand and the least competition from auto-appliers.
3. Second market page (Q6).
4. Demo: add a fourth posting from a live public ATS feed, refreshed weekly by a scheduled build — shows the tool on *today's* postings without any user data.
5. Changelog-as-content: each product release gets a two-paragraph note on the site.
6. First outbound corroboration pass (§6 entity list).

**Content engine — built on information only this product has (HYPOTHESIS, high value):** the scanner and `detect-reposts.mjs` run over *public* ATS datasets. Aggregated, anonymised findings — "of N postings across M public ATS feeds in [month], X % were reposted at least twice within 90 days; median repost interval Y days; the sectors with the highest repost rates were…" — are original data nobody else publishes, use no user data, and feed `/ghost-jobs` directly. Ten first pieces: monthly ghost-job index (×3), per-ATS advance-rate notes from the methodology (×2), market-convention explainers for the launch markets (×2), a "how the score is computed" walkthrough, an "what we refused to build" note, and the demo methodology. Every piece maps to a §6 cluster.

**Handover:** editor's guide, token map, "what breaks if you change this", maintenance scope — written even if the founder is the operator, because the founder in six months is a different person.

## 13. Decisions the founder owns (defaults this plan assumes until answered)

| # | Question | Source | Default assumed here |
|---|---|---|---|
| 1 | Product name | intake §7.1, Gate 1 | **Answered 2026-09-07: Workler.** Full clearance (classes 9/42/35) outstanding; name-bound assets wait on it |
| 2 | Relationship to upstream: (a) hosted tier on santifer's core with attribution, or (b) distinct fork | Gate 3 | **Answered 2026-09-07: (b)** — distinctly named fork, founder-maintained |
| 3 | Launch state of the SaaS — concept / in build / built; waitlist? | intake §7.3 | In build; waitlist is PRIMARY |
| 4 | The one commercial action | intake §7.5 | Waitlist signup with a specific promise, not a date |
| 5 | Pricing model and free/paid boundary | intake §7.2, §7.9 | Not shown; one honest paragraph on `/pricing` |
| 6 | "You never pay" vs a paid tier | §11 `/rights` | Unresolved — must be answered before `/rights` is written |
| 7 | Launch markets month 1 / month 12 | intake §7.6 | EN + DE at launch |
| 8 | Legal entity, jurisdiction, hosting location | intake §7.7 | EU entity, EU static host; nothing US-fronted |
| 9 | Site operator after launch and their technical level | intake §7.8 | Founder; no CMS |
| 10 | Keep "recommend against below 4.0" in the SaaS | intake §7.10 | Yes — it is belief 2 and the stance |
| 11 | Founder public as a Person entity? | §6 | Yes, by name, no photo required |
| 12 | Analytics vendor (EU cloud vs self-hosted) | §9 | Self-hosted Umami on the same EU host |
| 13 | Waitlist/form processor | §9 | Self-hosted endpoint on the EU host |
| 14 | Counsel engaged for: name clearance, DPIA, AI Act classification, EAA statement, consent-banner-free claim | §0, §11 | Not yet — the schedule below assumes it starts in week 1 |

## 14. Sequence and schedule

Calendar time assumes one founder-operator with Claude Code driving the pipeline, and counsel engaged in week 1. Name clearance is the critical path; everything name-agnostic proceeds in parallel.

| Week | Stage | Gate to pass | Output |
|---|---|---|---|
| 1 | **Decisions** — answer §13; engage counsel on Gate 1 + DPIA scope; `./bootstrap-web-studio.sh [product]-site`; push repo | — | Answered §13; site repo; counsel brief |
| 1 | `/intake` with `intake-material.md` + this plan | Every §13 item unanswered is transcribed as `[CLIENT INPUT REQUIRED]`, not filled | `spec/brief.md` |
| 2 | `/positioning` | Message hierarchy has proof for every belief from §4 only | `spec/message-map.md` |
| 2 | Gather 3–5 references (§7); author the three demo postings; run the real tool to produce the three reports | — | `spec/references/`; `src/content/demo/` |
| 2–5 | *Counsel:* trademark clearance (classes 9/42/35), DPIA, AI Act opinion, hosting transfer analysis | — | Cleared name; legal page inputs |
| 3 | `/art-direction` — three directions, self-critique, choice | **Name cleared** (or the stage runs name-blind with the wordmark deferred, at the cost of a second pass) | `spec/art-direction.md`, `src/styles/tokens.css` |
| 3 | `/architecture` | Every nav item serves a §2 segment | `spec/ia.md`, `spec/query-map.md` |
| 4 | `/copy all` — two home directions; DE transcreation commissioned | Headline swap test on every H1/H2 | `copy/*.md` |
| 4–5 | `/build` | Stage-guard hook passes (tokens exist); budgets green locally | Source; CI green |
| 5 | Wordmark, favicon, OG images — after Gate 1 only | Name cleared | Brand assets, ≤ 200 KB OG |
| 5 | **Fork re-brand** (Gate 3 table) — rename the codebase, repoint `update-system.mjs` at the fork's remote, new `SECURITY.md` contact, publish the renamed repo | Name cleared; done once, not iteratively | The SECONDARY CTA target exists |
| 6 | `/qa-gate`; `geo-audit`; fix list; legal pages populated from counsel's inputs | No `[CLIENT INPUT REQUIRED]` left in the build; no page shipped without real content | `spec/qa-report.md` |
| 6 | Launch on the EU host; analytics baseline snapshot | Privacy and accessibility pages live | Live site |
| 7+ | `/growth`; 90-day roadmap; first ghost-job index run | — | `spec/growth-plan.md` |

If counsel's clearance slips past week 5, launch slips with it. Do not launch under an uncleared name to hit a date; a rename after launch costs the entity work in §6 twice.

## 15. Command sequence (Claude Code, in the site repo)

```bash
./bootstrap-web-studio.sh [product]-site && cd [product]-site && git init && git add -A && git commit -m "chore: scaffold from web-studio template"
```

Then, in order, each gated by the SessionStart hook's pipeline state:

```
/intake  ../Jobber/intake-material.md ../Jobber/docs/WEBSITE-PLAN.md
/positioning
/art-direction            # after spec/references/ has 3–5 entries
/architecture
/copy all
/build
/qa-gate
/growth
```

Installed skills that plug into specific stages on this machine: `design` / `design-system` / `graphic-designer` (art direction exploration and token architecture — outputs still go through the stage's self-critique), `brand` (voice rules in `/positioning`), `banner-design` (OG image variants, after Gate 1), `humanizer` (a final pass on copy — verify it does not reintroduce banlisted phrasing), `geo-llmstxt` / `geo-schema` / `geo-technical` / `geo-audit` (architecture inputs and the QA gate), `analytics-dashboard` (the §12 baseline view).

## 16. What this site is not

Not the product's documentation (that lives with the code). Not a job board. Not an employer-facing page. Not a blog at launch — the content engine starts after the baseline exists. Not a place where any number appears that a visitor could not verify by clicking.

---

*One practical note: this site, built through the pipeline above, is itself a delivered website built with Claude Code — a portfolio artefact the founder's current applications can point to. That is a side effect, not a reason to build it; the reason is §1.*
