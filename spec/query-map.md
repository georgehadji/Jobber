# Query and entity map — Workler

**Stage:** `/architecture`, 2026-09-08. Sources: `spec/brief.md`, `spec/message-map.md`,
`spec/ia.md`.

**Standing note on AI search, per Google's documented position:** no AI-specific markup, file or
schema is required for AI Overviews or AI Mode eligibility. The requirements are ordinary
indexability and snippet eligibility. Nothing in this document sells or builds a tactic that
contradicts that. The answer blocks below are not an AI trick — they are the extractable statement
a page owes any reader, machine or human, who arrives mid-scroll. `llms.txt` and similar files are
not proposed, because they are not required and their absence costs nothing.

**Search reality for this project.** Zero backlinks, zero brand searches, an unlaunched product
and a name nobody has typed. Nothing here ranks on authority. The only viable strategy is
*specificity*: pages that answer a narrow question better than a generic listicle can, in a
cluster where the incumbents are content farms rather than competitors. `/ghost-jobs` is that
cluster (brief §8), and it is the reason it got a top-level URL.

---

## 1. PAGE = INTENT CLUSTER

One page, one cluster. A page appearing under two clusters is a page that will rank for neither.

### `/ghost-jobs` — *"is this posting even real?"*

**Primary question, in the user's words:** "How do I know if a job posting is fake or if the
company is actually hiring?"

**Long-tail phrasings:**
- is this job posting real
- how to tell if a job listing is fake
- what is a ghost job
- why do companies post jobs they don't intend to fill
- job posted 3 months ago still up — is it real
- same job reposted every month
- company keeps reposting the same position
- applied to 100 jobs no response why
- is this recruiter posting a real job or collecting resumes
- how to spot a fake job listing before applying
- do companies post jobs that are already filled
- signs a job posting is not legitimate
- why is this job still listed if it's filled
- tool to check if a job posting is real

**Currently answered by:** career-advice content farms, Reddit threads (r/jobs, r/recruitinghell),
occasional journalism on ghost jobs. Almost no product answers this — which is the opening.

---

### `/how-it-works` — *"what does it actually do, and can I see the logic?"*

**Primary question:** "How does this thing decide whether a job is worth applying to?"

**Long-tail phrasings:**
- how does AI score a job match
- job application AI that doesn't apply for you
- tool that tells you not to apply for a job
- AI resume matching how does it work
- what does an ATS keyword scanner actually check
- job fit score out of 5
- AI job tool that shows its reasoning
- does AI job matching actually work
- resume optimiser that doesn't rewrite my experience
- how to tell if an AI job tool is just a chatgpt wrapper
- job search tool with human approval step
- AI that reviews a job description against my CV

**Currently answered by:** Jobscan and Teal marketing pages (ATS half only), auto-apply vendors'
feature pages, generic "AI for job search" listicles.

---

### `/open-source` — *"can I run it myself and read the code?"*

**Primary question:** "Is there an open-source job-search tool I can run locally?"

**Long-tail phrasings:**
- open source job search tool
- self hosted resume optimiser
- claude code job application
- job search CLI
- open source ATS keyword scanner
- run job matching locally without uploading my CV
- github job application automation
- AI job tool that doesn't send my resume to a server
- job search agent for the terminal
- MIT licensed job search software
- job scanner greenhouse lever ashby API

**Currently answered by:** `santifer/career-ops` (472 stars — the closest known competitor to the
core, brief §3), assorted single-purpose scripts, Awesome-list entries.

---

### `/pricing` — *"what does it cost and why isn't it free?"*

**Primary question:** "What does Workler cost, and what do I get that the free version doesn't?"

**Long-tail phrasings:**
- workler pricing
- workler cost
- is workler free
- workler free vs paid
- job search tool subscription price
- jobscan alternative pricing
- how much do AI job application tools cost
- job search AI free trial

**Currently answered by:** nothing — these are brand queries against a brand nobody has heard of.
This page will not be found; it will be *arrived at*, from `/` and from nav. Optimise it for
conversion, not for search.

---

### `/rights` and `/privacy` — *"what happens to my CV, and who is this really for?"*

**Primary question:** "If I upload my CV to an AI job tool, who ends up with it — and who is
paying for this thing?"

**Long-tail phrasings:**
- is it safe to upload my resume to an AI tool
- GDPR resume tool
- EU hosted job search AI
- does AI job software sell my data to recruiters
- AI job tool privacy policy
- is my CV used to train AI
- job search tool that doesn't share my data with employers
- EU AI Act job application software
- is AI hiring software legal in the EU
- delete my resume from job search tool

**Currently answered by:** US vendors' boilerplate privacy pages, EU regulatory explainers, law
firm briefings. Segment C's whole trigger event lives here.

---

### `/` — the brand and category page

**Primary question:** "What is Workler?" — plus the category query it must intercept: "AI job
application tool that doesn't spam applications."

**Long-tail phrasings:** workler · what is workler · AI job application assistant · job search AI
that doesn't auto apply · alternative to auto apply tools · LazyApply alternative · AIApply
alternative · AI job tool with manual approval · job application tool that reviews before sending

---

## 2. ENTITY MAP

Consistency is the entire mechanism: an entity is established by the same name, the same
description and the same links appearing in enough corroborating places. One inconsistent
rendering of the name is worth more damage than three extra profiles are worth gain.

| Entity | Type | Established by | External corroboration |
|--------|------|----------------|------------------------|
| **Workler** | `Organization` / `SoftwareApplication` | `/` (Organization + SoftwareApplication JSON-LD), `/about`, `/pricing` | The public repository (name, description and homepage field must match the site exactly); package registry metadata if published; the trademark register once cleared. **Blocked: legal entity unknown (brief §7 Q7); until it is, `Organization` cannot carry a legal name, address or founding date, and shipping a guessed one would be worse than shipping none.** |
| **The founder** | `Person` | `/about` | GitHub profile, LinkedIn, any published writing. **Blocked: brief §7 Q10 — public by name or not. If not, the `Person` entity does not exist and objection 10 goes unanswered; that is a real cost of anonymity and should be decided knowingly.** |
| **Workler CLI** | `SoftwareApplication` (free tier) | `/open-source` | The repository; its README; the licence file. |
| **Jobber (upstream)** | External `SoftwareApplication`, referenced not claimed | `/attribution` | santifer's repository. Referenced with `sameAs`, never described as Workler's own. This is the licence boundary from brief §4 expressed in markup. |
| **The evaluation report (A–G)** | Not a schema entity — a named concept | `/how-it-works` | None. Named consistently across every page, so it becomes searchable as a Workler-specific term. |
| **Legal entity, jurisdiction, hosting region** | `Organization` properties | `/privacy`, `/terms`, footer | Company register once known. **Blocked.** |

**Naming rule, binding on every surface.** "Workler" — one capital W, never "workler", never
"Workler AI", never "Workler.io" in prose. The repository, the site title, the package name, the
social profiles and any directory listing use that exact string. Where lineage must be stated, the
only permitted form is "based on Jobber" (upstream's trademark policy, brief §6) — never "Workler
(formerly Jobber)", which claims a succession that did not happen.

---

## 3. ANSWER BLOCKS

40–60 words, near the top, before the persuasion. Written to survive being quoted with no page
around it — so each names Workler, states the thing, and contains no pronoun whose referent is
off-screen. None makes a claim that is not in brief §4 HAVE.

**`/`** (52 words)
> Workler evaluates job postings against your CV, scores the fit from 1 to 5, flags postings that
> look like they were never open, and prepares your application. It does not submit anything. The
> last click is always yours. A free command-line version is open source; the hosted version is
> paid, and paid only by the person using it.

**`/ghost-jobs`** (54 words)
> A ghost job is a posting that is advertised while no hire is intended — already filled, held open
> to collect résumés, or left up after the role closed. The signals are checkable: a listing
> relisted three times in ninety days, a role still advertised after it was filled. Workler scores
> posting legitimacy separately from how well you fit it.

**`/how-it-works`** (57 words)
> Workler reads a job posting and your CV and produces a report in seven blocks: role summary, CV
> match, level strategy, compensation research, personalisation, interview preparation, and work
> authorisation. Posting legitimacy is scored separately. The result is a score from 1 to 5, and
> below 4.0 Workler recommends not applying. It then stops and hands the decision to you.

**`/open-source`** (48 words)
> Workler CLI is the free, MIT-licensed command-line version. It runs inside ten AI coding CLIs on
> your own machine, and the scoring logic — thirty-three modes, eighteen market vocabulary sets —
> is readable in the repository. It is a fork of Jobber by santifer, maintained separately under
> the name Workler.

**`/pricing`** (structure fixed, numbers blocked)
> Workler CLI is free and open source. The hosted version costs **[PRICE]** per **[PERIOD]** and
> adds **[PAID CAPABILITIES]**. It is paid for by the person using it — there is no employer,
> recruiter or advertiser revenue, so there is nobody else for it to be optimised for.
> *[CLIENT INPUT REQUIRED: brief §7 Q3 and Q4. Do not ship a rounded guess.]*

**`/rights`** (56 words)
> Workler is paid for by the person using it. There is no employer, recruiter or advertiser
> revenue, so no part of the product is optimised for anyone but the job seeker. Workler never
> submits an application, never sends a message, and never invents a line for your CV. Whether EU
> AI Act rules classify candidate-side tools remains unsettled.

**`/privacy`, `/terms`, `/about`, `/attribution`, `/accessibility`** — answer blocks written when
their blocking questions are answered (`spec/ia.md` §6). `/attribution` is unblocked and can be
written today.

---

## 4. SCHEMA PLAN

JSON-LD only. Every statement must match content visible on the page — this is not a style
preference, it is the condition under which structured data is not a liability. Presence is
checked against `dist/` in CI (brief §6).

| Template | Types | Required properties | Recommended | Conditions |
|----------|-------|--------------------|-------------|------------|
| **Home** | `Organization`, `SoftwareApplication`, `WebSite` | `name`, `url`, `description`, `applicationCategory`, `operatingSystem` | `sameAs` (repository, profiles), `logo`, `foundingDate` | `logo` **blocked on trademark clearance** — no wordmark exists. `legalName`, `address`, `foundingDate` blocked on brief §7 Q7. Ship the minimum true set; an `Organization` with three properties is fine, one with a fabricated address is not. |
| **Argument** | `WebPage`, `BreadcrumbList` | `name`, `description`, `url`, `isPartOf` | `about`, `mainEntity` | `/how-it-works` and `/ghost-jobs` may use `HowTo` **only if** the visible page is genuinely stepwise. If the page argues rather than instructs, `HowTo` is a misrepresentation — do not add steps to the page to earn the schema. |
| **Pricing** | `WebPage`, plus `Offer` on the `SoftwareApplication` | `price`, `priceCurrency`, `availability` | `priceValidUntil`, `eligibleRegion` | **Blocked on price.** `availability` must reflect the sequencing answer — `PreOrder` and `InStock` are different claims and a wrong one is visible to a shopping crawler. |
| **Document** | `WebPage` | `name`, `description`, `dateModified` | `about` | `dateModified` comes from `last_reviewed` in the content model, never from the git timestamp — a formatting commit is not a review. |
| **About** | `Person` | `name`, `url` | `sameAs`, `jobTitle` | **Blocked on brief §7 Q10.** |

**Not used, deliberately:**

- **`FAQPage`** — there is no real FAQ, and inventing questions to earn markup is the exact
  pattern that gets a site's rich results demoted. If a page later develops genuine repeated
  questions, add it then.
- **`Review` / `AggregateRating`** — there is nothing to rate and never will be under brief §4.
  This is the single most tempting piece of markup on a zero-social-proof site and the single
  most damaging one to fake.
- **`Course`, `JobPosting`** — Workler is not the employer and does not host postings. `JobPosting`
  markup on a tool that *evaluates* postings would misrepresent the site to every job aggregator
  that reads it.

---

## 5. MEASUREMENT

One number decides whether this map was right: **purchases** (brief §2). Everything else is a
diagnostic.

Diagnostics worth keeping, all obtainable from cookieless self-hosted analytics and Search Console
without a consent banner (brief §6): entries to `/ghost-jobs` from search — the test of the §8
inference that this is the strongest owned cluster; `/open-source` → repository clickthrough,
which is the SECONDARY action working; `/pricing` arrivals as a share of `/` sessions;
`/pricing` → checkout, which is where an unanswered price currently makes the number zero.

**The honest caveat:** with no authority and no brand, organic search will produce very little in
month one regardless of how good this map is. The map's value is that it makes the site *findable
later without a rewrite* — the pages, the entity consistency and the answer blocks are the durable
part. Nothing here is a substitute for the founder putting the CLI in front of people.
