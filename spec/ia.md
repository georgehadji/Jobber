# Information architecture — Workler

**Stage:** `/architecture`, 2026-09-08. Sources: `spec/brief.md`, `spec/message-map.md`.
**Out of order, deliberately.** `spec/art-direction.md` does not exist yet — the art-direction
stage is blocked pending 3–5 visual references from the founder. Nothing below depends on the
visual system: a sitemap, a template inventory and an entity map are decided by the brief's jobs
and segments, not by its palette. Component *names* here are structural slots; art direction
fills them and may rename them.

**The organising constraint.** PRIMARY action is purchase (brief §2). Every URL below either
moves a stranger toward paying or answers an objection in message-map §4 that stops them. A page
that does neither is not in this sitemap.

---

## 1. SITEMAP

**URL scheme, stated as a rule.** Lowercase, hyphenated, no trailing slash, no dates, no `/blog/`
prefix reserved before a blog exists. One noun phrase describing the page's intent, not its
template. Legal pages sit at root, not under `/legal/`, so they can be linked from a payment flow
without a redirect.

| URL | Its single job | Funnel | Links in | Links out |
|-----|----------------|--------|----------|-----------|
| `/` | Move a stranger from "this is an auto-apply bot" to "this thing refuses to apply, and it judges" — then to `/pricing`. | Entry, all segments | Search, repository README, direct | `/pricing` (primary), `/how-it-works`, `/ghost-jobs`, `/open-source` |
| `/how-it-works` | Prove beliefs 2–4: the A–G report, the 1–5 score, the 4.0 threshold, the approval gate, and that the logic is readable. | Consideration, segments A + B | `/`, `/ghost-jobs`, `/open-source` | `/pricing`, `/open-source`, repository (deep links per claim) |
| `/ghost-jobs` | Own the strongest search cluster (brief §8). Answer "is this posting real" for someone who has not heard of Workler. | Entry, segment A | Search (primary entry, not `/`) | `/how-it-works`, `/pricing` |
| `/open-source` | The SECONDARY action: run the free CLI. Doubles as the trial the hosted product does not have. | Consideration, segment B | `/`, `/how-it-works`, `/rights` | Repository, `/pricing` |
| `/pricing` | **The PRIMARY action.** Purchase. Draw the free/paid boundary so the free CLI stops competing with the paid tier. | Conversion | Every page | Checkout, `/terms`, `/privacy` |
| `/rights` | Belief 6a: the seeker pays and nobody else. Plus the open AI Act question, stated as open. | Trust, segments A + C | `/`, `/pricing`, footer | `/privacy`, `/open-source` |
| `/privacy` | Objection 4: what is stored, where, by whom, for how long, and how to delete it. | Trust, segment C | Footer, `/pricing`, `/rights` | `/terms`, `/rights` |
| `/terms` | Required before money changes hands. | Conversion support | `/pricing`, footer, checkout | `/privacy` |
| `/about` | Objection 10: who is behind this. Establishes the Person entity. | Trust, all segments | Footer, `/` | `/attribution`, external profiles |
| `/attribution` | Upstream lineage. Required by the fork decision and upstream's trademark policy (brief §1). | Compliance | Footer, `/open-source` | Upstream repository |
| `/accessibility` | The published accessibility statement the EAA expects (brief §6). | Compliance | Footer | — |

Eleven URLs. No blog, no docs, no changelog at launch — documentation lives with the code and is
linked out (brief §2).

**Two sitemap decisions that are actually positioning decisions:**

1. **`/ghost-jobs` is a top-level entry page, not a section of `/how-it-works`.** Segment A does
   not search for Workler; they search for "is this job posting real". The page has to be
   reachable and complete without `/` ever being seen.
2. **There is no `/demo` page.** The demo — three real postings evaluated, one below 4.0 and
   recommended against, one legitimacy-flagged — is a *component*, placed on `/`, `/how-it-works`
   and `/ghost-jobs`. It is the site's substitute for a logo wall (message-map §4 objection 2), so
   it belongs where the objection is raised, not on a page someone has to choose to visit.

**Resolved 2026-09-08: launch-with-purchase.** The site does not go live until purchase works
(brief §1). `/pricing` carries a real price and a checkout, the sitemap above is final, and there
is no second version of the home page to design. No email-capture component is built.

---

## 2. TEMPLATE INVENTORY

Four templates. Anything that wants a fifth should be a component on an existing one.

| Template | Used by | Components it needs |
|----------|---------|---------------------|
| **Home** | `/` | Nav · Refusal statement (hero) · Mechanism sequence · **Report demo** · Claim-with-receipt list · Segment triage links · Price teaser + CTA · Footer |
| **Argument** | `/how-it-works`, `/ghost-jobs`, `/open-source` | Nav · Answer block · Prose with **Claim-with-receipt** · **Report demo** (how-it-works, ghost-jobs) · Terminal block (open-source) · Inline CTA · Footer |
| **Pricing** | `/pricing` | Nav · Answer block · Tier comparison (free CLI vs hosted) · **Objection list** (the seven-objection answer, inline) · Purchase CTA · Legal links · Footer |
| **Document** | `/rights`, `/privacy`, `/terms`, `/about`, `/attribution`, `/accessibility` | Nav · Answer block · Long-form prose with headings and anchors · Last-reviewed date · Footer |

**Components used on 3+ templates — built once, no variants:**

- **Nav** and **Footer** (all four).
- **Answer block** — the extractable 40–60 word direct answer near the top (Argument, Pricing,
  Document). Same component, same position, every page.
- **Claim-with-receipt** — a statement followed by the link to the file or the repository that
  proves it. This is the site's proof mechanism (brief §4) and it is a component, not a writing
  habit, so that a claim without a receipt is structurally impossible to publish.
- **Report demo** — Home, `/how-it-works`, `/ghost-jobs`. Precomputed and committed, never run at
  request time (brief §4).
- **CTA** — one component, one destination (`/pricing`), varied only by label.

**Deliberately not built:** carousel, testimonial slot, logo strip, cookie banner, chat widget,
newsletter modal. The first three have nothing to put in them and never will (brief §4); the
fourth is unnecessary if the analytics claim in brief §6 holds; the last two are third-party
scripts and the CI budget is zero (brief §6).

---

## 3. NAVIGATION

**Primary nav.** Four items. Each named for a segment it serves; an item serving none is removed.

| Item | Serves | Justification |
|------|--------|---------------|
| How it works | A, B | Belief 2–4. The mechanism is the recommended value proposition; it gets the first slot. |
| Ghost jobs | A | Segment A's entry query, given a nav slot so it is reachable from every page. |
| Open source | B | The SECONDARY action and segment B's only reason to trust anything here. |
| Pricing | All | The PRIMARY action, always visible, always the last item. |

Removed after testing them against brief §3: *Features* (a list is not a belief), *Blog* (does not
exist), *Docs* (lives with the code), *Login* (there is nothing to log into until launch — and it
returns the moment there is), *Company/About* (footer is enough for objection 10).

The nav must not be logo-left / links-centre / sign-in-right (banlist). Its arrangement is art
direction's problem; its *contents* are fixed here.

**Footer.** Three groups: Product (How it works · Ghost jobs · Open source · Pricing) · Trust
(Rights · Privacy · Terms · Accessibility) · Project (About · Attribution · Repository).

**Crawl path.** Every page is reachable within two clicks of `/`. `/ghost-jobs` and
`/how-it-works` are reachable from each other directly, because search lands on either. Legal
pages are footer-only but not `nofollow` — segment C reads them before converting, and they are
part of the argument, not an afterthought.

---

## 4. INTERNATIONAL

**Blocked on brief §7 Q6** (which countries and languages at launch, which by month 12). The plan
of record assumes EN + DE as a working default and that is not a founder answer. What follows is
the structure to build *toward*, so the launch build does not have to be undone.

**Strategy: subfolder.** `workler.example/` (EN, x-default) and `workler.example/de/`.

- *Trade-off stated:* subfolders inherit the domain's authority, which matters enormously for a
  site with zero backlinks and zero social proof; a static host serves them with no infrastructure.
  The cost is that a subfolder signals market targeting weakly compared with a ccTLD, and if
  Workler later needs a genuinely separate German legal entity or a `.de` presence for trust
  reasons, migration is real work. For one small entity launching with no authority, subfolder
  wins on every axis that matters in year one.
- *Rejected:* subdomains (split authority, no upside here); ccTLDs (a domain purchase per market,
  before a single market is confirmed, while the *primary* domain is still blocked on trademark
  clearance).

**hreflang matrix** (build it the moment a second locale exists; a single-locale site ships
`x-default` only and no `hreflang` at all — an incomplete matrix is worse than none):

| Page | `en` | `de` | `x-default` |
|------|------|------|-------------|
| `/` | `/` | `/de/` | `/` |
| `/how-it-works` | `/how-it-works` | `/de/so-funktionierts` | `/how-it-works` |
| `/ghost-jobs` | `/ghost-jobs` | `/de/geisterjobs` | `/ghost-jobs` |
| `/pricing` | `/pricing` | `/de/preise` | `/pricing` |
| Document pages | `/…` | `/de/…` | `/…` |

Localised slugs, not `/de/ghost-jobs`. A German seeker searching for the concept will not type the
English noun.

**Currency, units, dates.** Prices displayed in the locale's currency with the currency named in
full on first mention; VAT treatment stated explicitly next to the price, because it differs by
market and a surprise at checkout is the most expensive kind. Dates ISO (`2026-09-08`) in document
metadata, long-form in prose. **[CLIENT INPUT REQUIRED: is the price the same number in each
market, or converted?]**

**Translated vs transcreated vs market-specific:**

- **Transcreated** (rewritten by a human in-market, not translated): `/`, `/how-it-works`,
  `/ghost-jobs`, `/pricing`. These are sales copy and they carry the positioning. Machine-
  translated sales copy does not ship — and on this site it would be self-refuting, since belief 5
  is *"it knows your market's actual vocabulary."* A machine-translated German page proves the
  opposite of the thing it is claiming.
- **Translated** (professionally, faithfully): `/privacy`, `/terms`, `/accessibility` — with the
  governing-language clause stated.
- **Market-specific** (exists in one locale only): any page about a single market's vocabulary or
  hiring conventions. None at launch.

---

## 5. CONTENT MODEL

**There is no CMS** (brief §6) and the operator is the founder. The skill's brief asks for a model
in which a non-technical editor cannot break the layout; here that constraint is met by *structure
in the content files*, not by an admin UI — the same protection, none of the infrastructure. If
brief §7 Q8 comes back "a non-technical person will edit this", the same schema drops into a
git-backed CMS without a content migration, which is the reason to define it now rather than
writing free-form Markdown.

Content lives as Markdown with typed front matter. Prose bodies may only use a fixed set of
elements; anything visual is a named component with named fields, so there is no styling to get
wrong.

**Type: `page`** (all four templates)
`title` · `url` · `description` · `answer_block` (40–60 words, required, validated on build) ·
`template` · `locale` · `last_reviewed` (date, required on Document pages) · `noindex` (bool,
default false)

**Type: `claim`** (the Claim-with-receipt component)
`statement` · `receipt_url` (required — a repository file, a commit, or a named external source) ·
`receipt_label` · `verified_on` (date)
*Constraint: `receipt_url` is required. A claim with no receipt fails the build. This is brief §4's
proof mechanism enforced as a schema rather than as discipline.*

**Type: `report_demo`** (the three-posting demo)
`posting_title` · `posting_source` · `score` (0–5) · `recommendation` (enum: apply / do-not-apply)
· `legitimacy_flag` (bool) · `blocks` (the A–G sections) · `evaluated_on` (date)
*Constraint: at least one committed instance must have `score < 4.0` and
`recommendation: do-not-apply`, and at least one must have `legitimacy_flag: true`. Enforced in
CI. The demo's entire persuasive value is that it shows the product saying no; a demo where
everything scores 4.5 is an advertisement.*

**Type: `tier`** (pricing)
`name` · `price` · `currency` · `billing_period` · `vat_note` · `includes[]` · `excludes[]` ·
`cta_label` · `cta_url`
*`excludes[]` is required and non-empty. The free/paid boundary is the answer to objection 7 and
it cannot be drawn by listing only what a tier includes.*

**Build-time validation** (three rules, all cheap, all catching a failure this project is actually
prone to): every `page` has an `answer_block` within 40–60 words; every `claim` has a resolving
`receipt_url`; the `report_demo` set satisfies the two constraints above.

---

## 6. WHAT THIS DOCUMENT IS WAITING ON

| Blocked artefact | Question | From |
|------------------|----------|------|
| `/pricing` — the Buy link and the `Offer` markup | Checkout provider and the live buy URL (hosted merchant-of-record recommended). Price and boundary were answered 2026-09-08 (brief §7 Q3, Q4); this is the last thing keeping the page `noindex`. | brief §7 Q15, Q7 |
| `/privacy`, `/terms` | Entity, jurisdiction, host, processors, retention | brief §7 Q7, Q11 |
| `/about` | Is the founder public by name? | brief §7 Q10 |
| The `de` locale, the hreflang matrix, the price-per-market rule | Markets and languages at launch | brief §7 Q6 |
| `/accessibility`, the AI Act paragraph in `/rights` | Counsel | brief §7 Q14 |

`/how-it-works`, `/ghost-jobs`, `/open-source` and `/attribution` are unblocked and can be written
in full today. That is four of eleven pages, and they happen to be the four carrying beliefs 1–6 —
the shippable half of the message hierarchy.
