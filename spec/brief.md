# Brief — Workler

**Stage:** `/intake`, 2026-09-07. Sources: `spec/source/intake-material.md` (founder material),
`spec/plan.md` (website plan of record), and founder answers given 2026-09-07.
**Method:** transcribed, not embellished. Inferences are quarantined under §8. Unanswered items
stay in §7 as questions; they are not filled with plausible defaults.

---

## 1. BUSINESS FACTS

**What is sold.** A hosted SaaS job-search assistant with a chat interface. It improves and
rewrites resumes, performs ATS optimisation, finds open positions, matches a resume against a
specific posting, re-optimises the resume per job description, and prepares the application for
sending.

**What it explicitly does not do.** It does not submit, send, or click anything on the user's
behalf. Every outbound artefact passes an approval gate: the system drafts, the user reviews, the
user sends. Founder decision, stated as a positioning commitment rather than a technical limit.

**Product name.** **Workler** (founder decision, 2026-09-07). Chosen from the five names that
passed preliminary EUIPO/TMview screening (Kritir, Anakrin, Krinix, Ekloga, Workler). **Full
clearance in classes 9, 42 and 35 is outstanding.** Name-bound investment — wordmark, favicon, OG
images, domain purchase, codebase rename — waits on that clearance.

**Model.** Open core. A free CLI plus a hosted paid tier above it.

**Relationship to the open-source core.** Founder decision, 2026-09-07: **Workler is a distinctly
named fork** of the MIT-licensed Jobber core (santifer), maintained by the founder. The free CLI is
Workler CLI. The site sells both tiers, and the OSS is a real acquisition channel rather than a
link to a third party's project. Attribution of origin is permanent and required by upstream's
trademark policy, which permits "based on Jobber" but reserves the name and marks.

**Consequences already accepted with that decision** (from `spec/plan.md` §0 Gate 3): rename the
codebase; repoint the updater's remote at the fork, or upstream releases overwrite the fork's
branding; ship no upstream brand assets; state lineage on `/attribution`.

**Existing core, verified in the v1.24.0 checkout of the fork.** 10 supported AI coding CLIs; 33
top-level skill modes plus an `interview/` set; 18 market vocabulary sets; 80 provider modules;
115 tracked companies, 52 queries and 26 job boards in configuration; ~1,337 tests at the
2026-08-04 audit baseline (re-run before quoting anywhere public).

**Markets and languages.** [CLIENT INPUT REQUIRED: which countries and languages at launch in
month 1, and which by month 12?] The plan of record assumes EN + DE at launch as a working
default; it is not a founder answer.

**Legal entity, jurisdiction, hosting location.** [CLIENT INPUT REQUIRED: what entity operates
Workler, in which jurisdiction, and where is it hosted?] The plan assumes an EU entity on an EU
static host. Not confirmed.

**How customers are acquired today.** No paid acquisition, no adoption to report. The fork's
public repository is at 0 stars, 0 forks, 0 watchers (verified via the GitHub API, 2026-09-07).
Acquisition at launch is: search, the open-source repository, and whatever the founder does
directly.

**Pricing. Founder decision, 2026-09-08: a 90-day pass at €79, paid once, VAT included, with no
automatic renewal and no card kept on file.** Adopted from the pricing research below; the number
is a decision, not a market fact, and it is changeable in one file until checkout opens.

Why a time-boxed pass rather than the category-standard monthly subscription:

- **The category prices $14–50/month** — Teal $29, Huntr $30–40, Jobscan $49.95 (or $24.95/month
  billed annually), AIApply $16, FastApply $14 — and almost all of it auto-renews.
- **Job search is the textbook "happy churn" case.** The median search runs about 11 weeks; the
  average is 5–6.6 months, ~9.7 in tech, 6–9+ at executive level. The customer leaves *because the
  product worked*. Realised subscription lifetime here is roughly three months whatever the page
  says, so €79 collects the whole realistic lifetime at day zero instead of chasing it monthly.
- **Auto-renewal contradicts the product.** A tool whose one distinguishing behaviour is telling
  you *not* to apply cannot bill someone in month four because they got hired in month three and
  forgot to cancel. That charge is revenue taken from a seeker for someone else's benefit, which is
  precisely what `/rights` says does not happen here.
- **It makes the rights claim checkable.** "We cannot charge you twice by accident" is not a
  promise if there is no stored renewal to charge against — it is an architectural fact, and this
  site's proof mechanism is claims with receipts.
- **It removes a whole product surface from launch.** No dunning, no failed-payment recovery, no
  cancellation flow. On a zero-JS static site with no logged-in account area, a cancellation flow
  would have to be built before launch. The pass means it does not exist.
- **90 days is the median search, not a guess**, and it clears the sub-$10 floor that makes small
  amounts awkward at a merchant of record.

Long searches renew by choosing to, which is an upsell rather than a trap. The €79 sits just under
three months of the nearest comparable (3 × $29 ≈ $87), so the pass is cheaper than the tool it is
most often compared against, and it is one number rather than a tier grid.

**Free/paid boundary. Founder decision, 2026-09-08: the boundary is who runs it, not what it
decides.** The free CLI keeps the entire judgment — every mode, the full scoring, the legitimacy
check — under MIT, running on the user's machine. What the hosted tier sells is not a better
verdict but the absence of setup: no AI coding CLI to install, no model keys to hold, no local
runtime, plus the chat interface and the hosted scanning. A boundary drawn through the judgment
itself would make the free tier the crippled demo that §1 already refuses to ship.

**Launch state.** **In build** (founder, 2026-09-07). Not shippable today. The open-source CLI is
the part that exists and runs now.

**The one commercial action.** **Purchase** (founder, 2026-09-07). The site exists to sell the
hosted tier, not to collect intent.

**Free versus paid.** **A paid tier exists** (founder, 2026-09-07). This resolves question 13
against the CLI's "the seeker never pays" language: that sentence does not transfer to the hosted
product and must not appear on this site. What survives is narrower and **confirmed by the founder,
2026-09-08: the seeker pays, and nobody else.** No employer, recruiter or advertiser revenue. The
free CLI remains free. Visitors arrive at the site and pay for the service it provides — that is
the whole commercial relationship.

This is the rights claim that replaces "you never pay", and it is stronger than it looks: in this
category the seeker is usually the product. A tool whose only customer is the seeker cannot be
optimising for anyone else, and that is checkable against the absence of employer-side features.

**Launch sequencing. Resolved 2026-09-08: the site goes live only when purchase works.** No
interim waitlist, no "coming soon", no email capture standing in for the CTA. Site and
purchasable product ship together.

Three consequences the later stages inherit. `/pricing` is built once, with a real price and a
working checkout — `availability` in its `Offer` markup is `InStock`, never `PreOrder`. Objection 9
("it's not even finished") disappears from the launch build, because at launch it is finished.
And the site's launch date is now the product's launch date: the seven-week schedule in the plan
of record measures the site, not the release, and whichever finishes last sets the date.

---

## 2. THE ONE JOB

Ranked. One PRIMARY, one SECONDARY, everything else is not a job for this site.

1. **PRIMARY — purchase the hosted tier** (founder, 2026-09-07). Not a waitlist, not a demo
   request. Every page is measured against whether it moves a stranger toward paying.
   Unblocked: the site does not launch until purchase works (§1), so there is no interim action
   to design and no second version of the home page.
2. **SECONDARY — run the open-source CLI.** Under the fork decision this points at Workler's own
   repository, which is the fork's acquisition channel. It converts the technical segment and it
   substitutes for social proof by making the evaluation logic auditable.

Not jobs for this site: documentation (lives with the code, linked out), community building,
recruiting, employer-side sales.

---

## 3. AUDIENCE

Three segments. Each is a hypothesis until the founder confirms who is actually in the funnel.

### A. The burnt applicant
- **Trigger event.** Weeks of applications with no reply, or a scam/ghost posting that wasted an
  interview loop.
- **What they type.** "is this job posting real", "why do I get no responses", "how to tell if a
  job listing is fake", "ghost jobs".
- **What they fear.** That the effort is being spent on postings that were never open.
- **What makes them abandon a vendor.** Anything that smells like a spam cannon; a paywall before
  any value is visible; a testimonial wall they do not believe.
- **Also evaluating.** Auto-apply tools (LazyApply, AIApply, Sonara, Simplify), Reddit threads,
  doing nothing.

### B. The technical seeker
- **Trigger event.** Wants a job-search system they can inspect and run themselves.
- **What they type.** "open source job search tool", "claude code job application", "ATS keyword
  scanner CLI", "resume optimiser self-hosted".
- **What they fear.** A black-box score; their CV in a vendor's training data.
- **What makes them abandon a vendor.** Closed scoring logic; no repository; marketing language
  around an unremarkable wrapper.
- **Also evaluating.** santifer/career-ops (472 stars, closest known competitor to the core),
  writing their own scripts, Jobscan/Teal for the ATS piece.

### C. The careful European
- **Trigger event.** About to upload a CV — which carries third-party data and, by accident,
  special-category data — to a US SaaS, and stops.
- **What they type.** "GDPR resume tool", "EU hosted job search AI", "AI job application
  privacy", plus market-specific terms (Lebenslauf, 履歴書).
- **What they fear.** Their CV, their referees' names and their employment history sitting in an
  unknown processor chain.
- **What makes them abandon a vendor.** A privacy page that describes a different product; a
  cookie banner; unverified "GDPR compliant" or "AI Act compliant" badges.
- **Also evaluating.** US resume/ATS tools, national job portals, agencies.

[CLIENT INPUT REQUIRED: are these the segments you are actually selling to, and which one is
first? Segment order decides the home page.]

---

## 4. PROOF INVENTORY

The critical section. Categorised HAVE / CAN GET / DOES NOT EXIST. Nothing from the third
category ships, in any form, on any page.

### HAVE — verifiable in the fork's own repository today
- 91 commits on the fork; 45 by the founder's two accounts; 11 merged PRs.
- A public defect-hunt ledger of 19 batches (`docs/DEFECT-HUNT-LEDGER.md`, 2026-09-02 →
  2026-09-05) with a written assertion discipline in `AGENTS.md`. This is engineering-rigour
  proof, not adoption proof — and it is the honest kind.
- Capability inventory as shipped code: 10 CLIs, 33 modes, 18 market vocabulary sets, 80 provider
  modules, ~1,337 tests at the 2026-08-04 baseline.
- The approval gate enforced in code, not only in prompts: `web/test-submit-guard.mjs` exists; the
  agent instructions make "never submit" a hard rule; the legal disclaimer states it.
- Every claim above links to the file that implements it. That linkage is itself the proof
  mechanism this site runs on.

### CAN GET
- **A live, reproducible demo.** Three real public postings, evaluated with the actual tool, the
  A–G reports rendered on the page — including one that scores below 4.0 and is recommended
  against, and one flagged by the legitimacy check. Ask: the founder, week 2. Precomputed and
  committed, not run at request time.
- **A named founder as a Person entity.** Ask: the founder. [CLIENT INPUT REQUIRED: public by
  name? A photo is not required.]
- **Counsel-verified statements** for privacy, AI Act classification, accessibility and hosting.
  Ask: counsel, engaged week 1.
- **Beta testers and their outcomes.** [CLIENT INPUT REQUIRED: are there any users, beta testers,
  or a documented case of someone landing a role?]

### DOES NOT EXIST — never ships
- Testimonials, user counts, success rates, "trusted by", logo walls, star counts, placement
  statistics.
- Upstream's assets: the manifesto and its "signed at 60,000 stars" framing, 193 contributors,
  ~100 signature lines, the wordmark, logo, hero banner and OG image. These belong to santifer's
  project. Under the fork decision this is a licence boundary, not only an honesty one: MIT covers
  the code, not the marks.
- Any compliance badge — "GDPR compliant", "AI Act compliant", "SOC 2" — not issued by someone
  who can be named.

**Consequence for the whole site:** it must convert with zero social proof. It converts on
demonstration (the product doing the thing on the page), openness (every claim links to its
implementation), and stance (what the product refuses to do).

---

## 5. SUBJECT MATERIAL

Concrete nouns from the product itself. Raw material for art direction; no metaphors, no stock
imagery.

- **The evaluation report.** A–G blocks: role summary, CV match, level strategy, compensation
  research, personalisation, STAR+R interview prep, work-authorisation signals. Plus Block G,
  posting legitimacy, scored independently of fit. Rendered as a real document.
- **The 1–5 score**, and the 4.0 threshold below which the product recommends not applying.
- **The tracker.** Rows with canonical states: Evaluated, Applied, Responded, Interview, Offer,
  Hired, Rejected, Discarded, SKIP.
- **The terminal.** The CLI's actual output — scan counts, report numbers, the approval prompt.
- **The ATS-oriented PDF.** Keyword-aligned, two pages, generated from the user's own files.
- **Ghost-job and repost signals.** A posting relisted three times in ninety days; a listing still
  up after the role was filled.
- **Market vocabulary.** Lebenslauf, 履歴書, CTC vs in-hand, 13. Monatsgehalt, TFR, kıdem
  tazminatı, ФОП — real terms from the 18 shipped vocabulary sets.
- **The approval gate.** The moment the machine stops and hands the decision back.
- **The provider list.** Greenhouse, Ashby, Lever, Workday, iCIMS — public APIs and feeds.

Owned photography: none. There is no office, no team, no product photography.
[CLIENT INPUT REQUIRED: is there any owned imagery at all, or is the site entirely typographic and
interface-based?]

---

## 6. CONSTRAINTS

**Brand assets.** None usable. Upstream's are out (see §4). Workler's own do not exist yet and
cannot be commissioned before trademark clearance.

**CMS.** None. The operator is the founder; the site is static and edited in the repository.
[CLIENT INPUT REQUIRED: confirm — if a non-technical person will edit copy after launch, this
changes the build.]

**Hosting.** EU static host assumed, not confirmed (see §1). Cookieless, self-hosted analytics
assumed so that no consent banner is needed; that claim must be true before it is made.

**Integrations.** A waitlist/form endpoint. [CLIENT INPUT REQUIRED: self-hosted endpoint, or a
third-party processor? A processor is a GDPR processor and needs an agreement.]

**Budgets, enforced in CI by this repository.** LCP ≤ 2.0s and CLS ≤ 0.05 in lab; first-load JS
≤ 60KB gzipped; at most 2 font families and 4 weights, self-hosted woff2; zero third-party
scripts unless justified in the growth plan.

**Accessibility.** WCAG 2.2 AA, and a published accessibility statement. The European
Accessibility Act has been enforceable since 2025-06-28, with EN 301 549 (WCAG 2.1 AA) as the
technical benchmark. Build above the benchmark.

**Regulatory exposure.**
- *EU AI Act (Regulation (EU) 2024/1689), Annex III category 4* names employment AI as high-risk,
  with Article 6(2) making the classification automatic. Whether a candidate-side tool falls
  inside 4(a) is an open legal question. The site states the question as open and makes no
  compliance claim until counsel answers it.
- *GDPR.* The SaaS is a data controller for CVs, which routinely contain special-category data by
  accident and third-party data by design (referees, named colleagues). Needs lawful basis, DPIA,
  processor agreements with every LLM provider, retention policy, deletion flow. The CLI's
  existing legal disclaimer describes local execution and no telemetry — every one of those
  sentences inverts for the hosted tier, and none of it may be reused.
- *Third-party portal terms.* The scanner uses public APIs and feeds. The word "scraping" must not
  appear anywhere on the site, in any tense.
- *Trademark.* "Jobber" is reserved to santifer and is separately the mark of Jobber Software
  (getjobber.com, field-service SaaS). Workler is the answer to both; clearance is pending.

**Deadline.** Seven weeks from decisions to launch in the plan of record, with trademark
clearance (2–4 weeks with counsel) as the critical path. Launching under an uncleared name does
not trade risk for time; it trades a rename for time.

---

## 7. OPEN QUESTIONS

Each answerable in one line. Every one of these is a fabrication risk if left unanswered — the
copy stages will otherwise need a plausible sentence exactly where a fact belongs.

1. ~~Is the SaaS built, in build, or at concept?~~ **Answered 2026-09-07: in build.**
2. ~~What is the one commercial action?~~ **Answered 2026-09-07: purchase.**
3. ~~Pricing model and price?~~ **Answered 2026-09-08: a 90-day pass at €79, paid once, VAT
   included, no automatic renewal, no card on file.** Reasoning and the comparable set are in §1.
4. ~~Which capabilities sit behind the paywall, and which stay in the free Workler CLI?~~
   **Answered 2026-09-08: none of the judgment is behind it.** The paywall is on running the
   thing — hosting, model access, the chat interface, hosted scanning. See §1.
5. Does the hosted product keep the CLI's "recommend against applying below 4.0" behaviour?
6. Which countries and languages at launch, and which by month 12?
7. What legal entity, in which jurisdiction, and hosted where?
8. Who operates the site after launch, and how technical are they?
9. Are there any users, beta testers, or a documented case of someone landing a role?
10. Is the founder public by name as the site's Person entity?
11. Waitlist/form processing: self-hosted endpoint, or a third-party processor? *Partial,
    2026-09-08: the hosted tier's LLM path is decided (fork repo, `docs/HOSTED-APP-PLAN.md` §5):
    OpenRouter as gateway with `data_collection: deny`, and the model vendors behind it
    (DeepSeek, Z.ai, Alibaba/Qwen, Moonshot, Google). Those are processors and belong on
    `/privacy` by name; the remaining half of this question is the entity and the DPA.*
12. Is there any owned imagery, or is the site entirely typographic and interface-based?
13. ~~"You never pay" versus a paid tier.~~ **Answered 2026-09-07: paid tier.** "You never pay" is
    retired. Residual question moved to §1: is the narrower claim (no employer/advertiser revenue)
    true?
14. Has counsel been engaged for name clearance, the DPIA, the AI Act classification, the
    accessibility statement, and the consent-banner-free claim?
15. Checkout provider? Recommendation from the UI/UX audit (2026-09-08): a hosted,
    merchant-of-record checkout (Paddle or Lemon Squeezy) rather than any on-site form. The site
    stays at zero JS, no card data touches it, and the provider collects and remits EU/UK VAT —
    which settles the tax half of Q7 and the processor half of Q11. Opening the account needs the
    entity from Q7. Blocks the Buy link on `/pricing`.

---

## 8. INFERENCE — not client-stated, derived here

Marked so no later stage mistakes these for facts.

- **INFERENCE:** the three segments in §3 are derived from the capability set and the competitive
  field, not from observed users. Question 9 is the test.
- ~~**INFERENCE:** the waitlist as PRIMARY…~~ **Superseded 2026-09-07.** PRIMARY is purchase, by
  founder decision. The replacement inference: with the product in build and purchase as the one
  job, the site is being written ahead of the thing it sells. Everything on it must therefore be
  demonstrable from the CLI that already exists, or it is a promise — and a promise is the one
  currency this site has decided not to spend.
- **INFERENCE:** ghost-job detection is the strongest owned search cluster, because it is a real
  and widely searched pain that almost no competitor addresses. Rank 1 of the six candidate
  differentiators, to be tested in `/positioning`.
- **INFERENCE:** "Jobber" as a hosted SaaS name would have collided on two fronts — upstream's
  policy and a third-party mark in overlapping classes. This is the reasoning behind the rename,
  not a legal opinion.
- **INFERENCE:** the Annex III(4) provision reads as aimed at employer- and recruiter-side
  systems. Not settled. Counsel decides; the site says the question is open.
