# Jobber public site: research brief

Scope: public **landing + docs** site. Audience: **any job seeker**. Deliverable: research and shaped brief only. No design direction chosen, no code written.

Product truth lives in `PRODUCT.md`. This file holds findings and decisions for the site only.

## 1. What the research says (functional only, no visual references used)

Source quality: all findings below come from secondary sources. Primary pages (NN/g, web.dev, diataxis.fr, w3.org) were named by the sources but not opened. Verify any number before quoting it publicly.

| Topic | Finding | Confidence |
|---|---|---|
| First viewport | Visitors decide fast. The first screen must answer: what is this, what problem does it solve, what do I do next. One primary action beats several. | Principle widely repeated. The percentages (80% of time above the fold, 11.4 s median, 10-20 s) conflict across sources and are unverified. Do not cite them. |
| Docs structure | Diátaxis: four reader needs, four doc types: tutorial (learn by doing), how-to (solve a task), reference (facts), explanation (why). No fixed reading order. Treat it as a strong default, not a law. | High. Origin Daniele Procida, adopted by Canonical, primary source diataxis.fr. |
| Speed | Core Web Vitals "good": LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1, at the 75th percentile. Reported unchanged through 2026. | Medium. Confirm on web.dev. |
| Accessibility | WCAG 2.2 AA. New criteria that bite a marketing site: Focus Not Obscured (sticky header, cookie banner), Target Size 24x24 CSS px, Dragging Movements, Consistent Help, Accessible Authentication (no cognitive test). 4.1.1 Parsing was removed. | High. Manual keyboard and zoom testing still required. |
| Job-seeker trust | In one 1,000-person US survey, 37% believed their data goes only to prospective employers; nearly half skim or skip privacy policies. In a separate vendor-commissioned survey (1,008 US adults), about 90% want companies to disclose AI use, and privacy was a top concern (53.87%). | Low to medium. Single studies, one commissioned by a vendor. Use as direction, not as a headline stat. |

## 2. What that means for Jobber specifically

1. **The tension to resolve:** the audience is "any job seeker", but the install path is an AI coding CLI plus `git clone` and `npm install`. `docs/FAQ.md` says a no-terminal route exists via Claude Cowork (`docs/COWORK.md`), with one gotcha: clone and install in a terminal first. The landing page must sell the outcome before any terminal talk, then be honest that setup needs a one-time terminal step. Hiding that would break the first-evaluations-are-mediocre honesty the README already shows.
2. **Trust is the strongest asset and it is already true.** Local, no cloud component, no sync, never submits or sends, recommends against applying below 4.0/5, MIT licensed. Job seekers distrust platforms that share data. The site should state these as facts with the file-level reason ("everything is files in your checkout"), not as marketing adjectives.
3. **"Filter, not spray" is the differentiator** a neighbouring tool could not truthfully copy. It should lead the story, not sit in a footnote.
4. **No proof exists yet to show.** `PRODUCT.md` records no testimonials, user counts, benchmarks, or press. Proof available today: the real demo (`docs/demo.gif`), the real scoring model (blocks A-F, Block G legitimacy), real counts from the README (70+ provider modules, ATS list), and the origin story credited to santifer. Do not fabricate anything beyond that.
5. **Docs map cleanly onto Diátaxis** using what already exists:
   - Tutorial: `docs/ONBOARDING.md`, `docs/SETUP.md`
   - How-to: `docs/COWORK.md`, `docs/FREE_TIER.md`, `docs/RUNNING_ON_A_BUDGET.md`, `docs/CUSTOMIZATION.md`, `docs/AUTOMATION.md`
   - Reference: `docs/SCRIPTS.md`, `docs/SUPPORTED_JOB_BOARDS.md`, `docs/SUPPORTED_CLIS.md`, `docs/STATE-MACHINES.md`
   - Explanation: `docs/ARCHITECTURE.md`, `docs/FAQ.md`, README "What it is"
   Internal plan and ledger files (`*-PLAN.md`, `DEFECT-HUNT-*`, `AUDIT-FIX-PLAN.md`) are contributor material. Keep them out of the public docs navigation.
6. **Two surfaces, two modes, never mixed:** landing = Persuade (earn the first action). Docs = Read (comprehension and wayfinding first). Each gets its own brief when shaped.
7. **Incumbent visual evidence** (`web/src/app/globals.css`): warm stone ground (#f7f6f3), warm near-black, olive editorial headline (#59592a light, cream #e4e2d0 dark), orange brand accent, Inter plus Instrument Serif, light and dark themes already AA-tuned. The dashboard in `web/` already has a world. Open decision below: whether the public site inherits it or replaces it.

## 3. Page plan (content, not layout)

Landing, in reading order the evidence supports:
1. Promise plus one primary action (install path or see-how-it-works). Says what Jobber is for a non-technical reader.
2. The filter idea: hundreds of postings in, a few worth your time out, with the real 1-5 scoring and the 4.0 line.
3. The real product doing its job (existing demo, honest labelling of anything synthetic).
4. Trust facts: local, user-owned files, never submits, legitimacy check.
5. Honest setup: what you need, how long the first step takes, what the first evaluations will be like.
6. Where to go next: docs, GitHub, Discord.

Docs: landing page for docs by reader need (Diátaxis four doors), search, per-page "where am I" wayfinding, copyable commands, a short FAQ.

## 4. Open decisions for you

1. Stack: **decided.** Plain HTML, CSS and vanilla JavaScript, separate from `web/`. Consequences: docs pages are hand-written or generated from `docs/*.md` by a small script (decide which); no client router, so every page is a real file and links work without JavaScript; JavaScript only for progressive enhancements (theme toggle, docs search, copy-command buttons).
2. Domain and hosting. `AGENTS.md` references `jobber.org/manifesto`; no confirmation that this is the site's home.
3. Inherit the dashboard's visual world, or choose a new one for the public surface. Resolved in the next step through the concept round, not by me.
4. Whether to mention the Jobber Manifesto and the santifer origin on the landing page.
5. Which non-terminal path to show first: Cowork, or terminal only.

## 4b. Landing brief (shaped, confirmed by user)

**Job and audience.** Any job seeker, usually evening, many job tabs open, CV in a folder, unsure whether to apply, wary of AI tools that harvest data. Mode: Persuade.

**Outcome and proof.** The visitor uploads a CV and gets a first real result inside the page. Success is a completed upload, not a click on a link. Proof available: the real demo (`docs/demo.gif`), the real 1-5 scoring model with Block G legitimacy, the real capability list, the honest privacy facts. No testimonials, counts or pricing exist; none may appear.

**Direction.** Category standard played straight (user choice), at the craft level of Teal / Huntr and Jobscan. Planned reading order: headline and one working upload above the fold; how it works (score a job, skill-gap check, tailored PDF, portal scan); what happens to your CV (processed, not stored); honest limits (first evaluations are mediocre until it knows you); links to docs, GitHub, local install. Brand tokens (warm stone, olive, orange accent, Inter, Instrument Serif) and the existing wordmark are the default palette source; confirm below.

**Scope.** `index.html` only: production-ready, interactive upload. The results/tool screens (Operate) and the docs (Read) get their own briefs.

**States and ranges.** Empty, drag-over, file chosen, uploading, rejected (type or size), daily limit reached, server error, success hand-off. File types and maximum size undecided.

**Interaction and layout.** One primary action. Upload is a real file input behind a keyboard-operable drop zone. The privacy statement sits next to the drop zone and is visible before upload, not in a footer. Works as a plain page without JavaScript (links to docs and local install). Mobile first for width; touch targets at least 24x24 CSS px.

**Anti-goals.** Never say "runs locally" or "no cloud" about the hosted tool. No invented testimonials, user counts, pricing or accuracy claims. Nothing implies Jobber submits applications. Tone stays plain and honest, like the README.

**Open decisions.** (1) Inputs for the first result: CV alone, or CV plus a pasted job description (the skill-gap check needs both). Suggested: CV first, then a job description or a sample one. (2) Free daily limit number. (3) Allowed file types and size. (4) Privacy notice text and LLM provider disclosure; legal review is yours. (5) Whether to inherit the `web/` brand tokens or set new ones. (6) Domain. (7) Whether to mention the manifesto and santifer origin.

## 5. Next steps

1. Answer the open decisions above, stack and domain first.
2. Run `/impeccable shape landing` (Persuade) then `/impeccable shape docs` (Read) to confirm each surface brief.
3. New-work concept round picks the visual world through the decision page. No code before that.
4. After build: WCAG 2.2 AA manual pass and Core Web Vitals check on the real page.

## Sources used

- [Homepage clarity, search results](https://onenine.com/website-homepage-design-best-practices/) (secondary, NN/g figures unverified)
- [Diátaxis at Canonical](https://canonical.com/blog/diataxis-a-new-foundation-for-canonical-documentation); primary: diataxis.fr
- [Core Web Vitals thresholds](https://corewebvitals.io/core-web-vitals); primary: web.dev
- [Incogni job-search privacy study](https://blog.incogni.com/privacy-cost-of-job-seeking/)
- [ServiceNow/SurveyMonkey AI-in-hiring survey](https://www.servicenow.com/products/hr-service-delivery/ai-in-the-hiring-process.html) (vendor-commissioned)
- [WCAG 2.2 updates (Deque)](https://dequeuniversity.com/resources/wcag-2.2)
