# Growth plan — Workler

**Stage:** `/growth`, 2026-09-08. Sources: all upstream artifacts, `spec/qa-report.md`.

**A note on section 6.** This template assumes an agency and a client. Here the founder is both,
so "retainer" is reframed as the ongoing operating scope and costed in hours rather than fees,
with the outsourceable parts marked. Pretending otherwise would produce an invoice nobody sends.

**The precondition.** None of this runs until the site can launch, and the site cannot launch
until the price exists, the demo records exist, the receipts resolve and counsel has delivered
`/privacy` and `/terms` (`spec/qa-report.md` §G, items 1–4). Everything below assumes day 0 is the
day purchase works.

---

## 1. MEASUREMENT

### The event that matters

**`purchase_completed`.** One event, the PRIMARY action. Everything else is diagnostic and exists
only to explain movement in that number.

| Event | Fires when | Why it earns its place |
|---|---|---|
| `purchase_completed` | Checkout succeeds | The only success metric. |
| `pricing_view` | `/pricing` loads | Denominator for the conversion rate that matters. |
| `cta_pricing_click` | Any CTA to `/pricing` | Splits "nobody wanted it" from "the pricing page lost them" — the two failures need opposite fixes. |
| `repo_click` | Any outbound to the repository | The SECONDARY action, and the test of whether the free CLI feeds or cannibalises the paid tier. |
| `receipt_click` | Any `.claim__receipt` link | Measures whether the proof mechanism is used at all. If nobody clicks a receipt, the site's central bet is wrong and should be simplified. |
| `entry_page` + `referrer` | First page of a session | Decides the home-page A/B question in `copy/home.md`: Direction B wins on search entry, A on direct and repository entry. |

Nothing else. A tool that fires forty events produces a dashboard nobody reads.

### Analytics setup

**Self-hosted, cookieless, no consent banner** — and the claim has to be true before it is made
(brief §6). That means: no cookies, no `localStorage`, no cross-site identifier, no IP stored
beyond the request, aggregate counts only. Under those conditions no consent is required for
strictly necessary aggregate measurement, and there is no banner to shift the layout or cost a CLS
budget.

**Consent-mode handling:** not applicable, and that is the design. The moment any tool is added
that needs consent, a banner is needed, the zero-third-party-script budget breaks, and the CLS
budget is at risk. That trade is a decision for the growth plan, not a default — this plan does not
take it.

`[CLIENT INPUT REQUIRED: which self-hosted analytics, on which host? It processes visitor data, so
it is in scope for /privacy and must be named there before it runs.]`

### Launch baseline snapshot — take it on day 0, before any promotion

Without a baseline there is no way to tell later whether anything worked.

| Metric | How | Status |
|---|---|---|
| CWV field data | Search Console / CrUX, p75 LCP, INP, CLS | Not available until traffic exists; record the first available reading and date it. |
| CWV lab | Lighthouse CI on `dist/` | **Blocked — never run.** `spec/qa-report.md` §A lists LCP and CLS as UNMEASURED for exactly this reason. Run it on day 0 and record the numbers. |
| Conversion rate | `purchase_completed / pricing_view` | 0 by definition on day 0. |
| Query coverage | Search Console, impressions by query | 0. New domain, no backlinks, no brand searches. |
| Repository stars / forks | GitHub API | **0 / 0 / 0**, verified 2026-09-07. Record it — it is the honest starting line and it makes any later number meaningful. |

**Expect month one to be near zero.** A new domain with no authority does not rank, and the plan
should not be judged on it. What month one produces is a baseline and a working funnel.

---

## 2. 90-DAY ROADMAP

One item per fortnight. Each has a hypothesis, a metric and a rule for keeping or reverting — the
rule matters more than the item, because without it every result reads as a success.

| Fortnight | Item | Hypothesis | Metric | Decision rule |
|---|---|---|---|---|
| **1** | **Ship the three demo records** and remove the last placeholder from `/`. | The demo is the site's substitute for social proof; without it the home page argues and never demonstrates. | `pricing_view / entry_page` on `/` | This is a launch requirement, not an experiment. No revert path. |
| **2** | **Home-page A/B: Direction B (ghost-job lead) vs Direction A (refusal lead)**, per `copy/home.md`. | Search arrivals match B's headline; direct arrivals match A's. | `cta_pricing_click` per session, **split by entry source** | Run to ≥200 sessions per arm. Below that, do not read it — a home-page test on a new site is noise wearing a p-value. If B wins only on search, keep B and serve A to direct traffic rather than declaring a global winner. |
| **3** | **Resolve every receipt link to a real file** and instrument `receipt_click`. | The proof mechanism converts segment B; today it is decorative (`qa-report.md` D2). | `receipt_click` rate; `repo_click` after a receipt click | If under 2% of sessions click any receipt after four weeks, the mechanism is not being used: cut the number of claims by half and make the surviving ones more prominent rather than adding more. |
| **4** | **Publish content pieces 1–3** (§3). | `/ghost-jobs` is the only cluster where incumbents are content farms rather than products. | Impressions on ghost-job queries | If impressions are still ~0 after six weeks, the problem is indexation or authority, not copy — check coverage in Search Console before writing piece 4. |
| **5** | **Draw the free/paid boundary explicitly on `/open-source`**, with a one-sentence answer to "why pay?". | The SECONDARY action currently competes with the PRIMARY one. | `pricing_view` originating from `/open-source` | If `repo_click` rises while `pricing_view` does not, the boundary is drawn in the wrong place — that is a product signal, not a copy one, and it goes back to the founder. |
| **6** | **Add the second locale** (`/de/`) for `/`, `/ghost-jobs`, `/how-it-works`, `/pricing`, transcreated not translated. | Belief 5 claims market fluency; a machine-translated German page would disprove it on sight. | Impressions and conversions from DE | Only if a native writer is available. Ship nothing machine-translated: on this site it is self-refuting. |

**Not on this roadmap, deliberately:** paid acquisition (nothing to optimise until organic
conversion is measurable), social posting cadence, a newsletter, and any third-party script.

---

## 3. CONTENT ENGINE

**Cadence: one piece a fortnight.** Not weekly. Every piece must be built on information only this
project has — its own evaluation data, its own process, its own numbers. A weekly cadence forces
generic filler, and generic filler on a zero-authority domain ranks for nothing while diluting the
pages that could.

Each piece maps to a query cluster and is publishable as an Argument-template page.

| # | Piece | Query cluster | The information only Workler has |
|---|---|---|---|
| 1 | **What a relisted posting actually looks like** — anonymised timelines of roles relisted 3+ times in 90 days | ghost jobs | `detect-reposts.mjs` output across the tracked feeds. Nobody else publishes this data. |
| 2 | **We scored 50 postings and told you not to apply to N of them** — the distribution of scores, with the threshold marked | AI job scoring | The actual score distribution from real evaluations. Competitors cannot publish theirs, because theirs has no left tail (`spec/references/01-jobassist.md`). |
| 3 | **Seven things a job advert stops telling you when it is a ghost** — signals derived from Block G | ghost jobs | The legitimacy heuristics as shipped, with worked examples. |
| 4 | **13. Monatsgehalt is not a bonus** — how the same pay package reads differently in five markets | market vocabulary | The eighteen vocabulary sets, which is genuinely unusual subject matter. |
| 5 | **What an ATS actually parses** — a CV rendered as the parser sees it | ATS optimisation | The PDF pipeline's own output. |
| 6 | **The tool refused: three postings it recommended against, and what happened next** | AI job scoring | Only possible with a real user; **blocked on brief §7 Q9.** |
| 7 | **Why we do not click submit** — the approval gate, and the test that enforces it | AI job tools / trust | The submit-guard test. The argument is the product's spine. |
| 8 | **Reading a fit score you disagree with** — how to argue with Block B | AI job scoring | The report structure. |
| 9 | **What we store, and why it is less than you expect** | privacy / GDPR | The actual architecture. **Blocked until `/privacy` exists.** |
| 10 | **Is a candidate-side tool high-risk under the AI Act?** — the open question, written up properly | EU AI Act | Counsel's reasoning, published. Almost nobody in this category will publish an unresolved legal question, which is exactly why it is worth reading. **Blocked on counsel.** |

Three of the ten are blocked on the same open questions as the site. Start with 1, 2, 3 and 7 —
all four are writable today from data that already exists.

---

## 4. EXTERNAL CORROBORATION

An entity becomes legible by being described the same way in enough independent places. One
inconsistent rendering does more harm than three extra profiles do good.

**The naming rule, binding everywhere:** `Workler`, one capital W. Never "workler", never "Workler
AI", never "Workler.io" in prose. Lineage is always and only "based on Jobber".

| Surface | Action | Status |
|---|---|---|
| The repository | `name`, `description` and `homepage` must match the site's `Organization` exactly | Highest value and lowest cost. The repository is the only public surface that exists today. |
| Package registry metadata | Same description, same homepage | If published. |
| Founder profiles (GitHub, LinkedIn) | Name Workler consistently; link to the site | **Blocked on brief §7 Q10.** |
| Open-source directories, Awesome-lists | Submit once the CLI's README is presentable | Genuine listings only. |
| Trademark register | The clearance filing is itself corroboration | **In progress, gates everything name-bound.** |
| Company register | Legal name and address consistent with `/privacy` and the JSON-LD | **Blocked on entity.** |

**Explicitly not doing:** directory spam, paid listings, reciprocal link exchanges, or any
"citation building". On a site whose entire argument is verifiability, a manufactured citation
trail is the one growth tactic that would cost more than it returns.

---

## 5. HANDOVER

The operator is the founder, so this is a note to your future self.

**How to change copy.** Every page is one file in `src/pages/`. The `<!--meta {...}-->` block at
the top holds the title, description, answer block and JSON-LD; everything after it is the page.
Run `node build.mjs`. There is no CMS and no framework.

**The token map.** Every colour, size, space, radius, duration and width lives in
`src/styles/tokens.css`. Component CSS may not contain a literal value, and
`scripts/check-tokens.sh` fails the build if it does — it scans `.css` and `.html`.

**What breaks if you change this:**

- **`--color-signal`.** It is licensed for exactly one meaning: a score below 4.0, a legitimacy
  flag, or the threshold rule. Use it on a button and the site loses its central visual argument —
  that the only colour on the page is the product delivering a negative judgment.
- **The threshold rule.** It is the signature. Removing it from the lockup makes the wordmark a
  word.
- **`h1` sizing.** The H1 is deliberately one step below its scale position. Enlarging it makes the
  page shout, on a site whose thesis is that it does not.
- **Adding any client-side JavaScript.** The first-load JS budget is currently 0 bytes of a 60KB
  allowance. That headroom is the reason every performance budget passes with room to spare.
- **`node build.mjs --strict`.** This is the deploy command. It fails on any surviving
  `[CLIENT INPUT REQUIRED]`, on a missing demo record, and on an unset `SITE_ORIGIN`. Do not
  deploy with the non-strict build to "get it out".

**Maintenance scope.** Re-verify the counts on `/open-source` whenever the CLI changes. Re-date
`/rights` and `/accessibility` when their facts change. Re-run the demo evaluations if the scoring
logic changes — a demo that no longer matches the product is worse than no demo.

---

## 6. ONGOING OPERATING SCOPE

Costed in hours, since the operator is the founder. Fee ranges are given only for the parts worth
outsourcing.

| Cadence | Work | Time | Outsource? |
|---|---|---|---|
| Fortnightly | One content piece (§3) | 3–5 h | No — every piece depends on data only the founder has. |
| Monthly | Check the funnel: `pricing_view`, `cta_pricing_click`, `receipt_click`, `repo_click`, entry sources. Act on one thing, not five. | 1 h | No. |
| Monthly | Re-run `node build.mjs --strict`, `check-tokens.sh`, the axe suite and Lighthouse CI; record CWV field data | 1 h | No — it is one CI run. |
| Quarterly | Re-verify every public number and every receipt link; re-date the trust pages | 2 h | No. |
| Quarterly | Re-read `spec/message-map.md` against what buyers actually said. Positioning decays quietly. | 2 h | No. |
| As needed | Accessibility audit after any structural change | 2 h | **Yes**, once, for an independent statement — an accessibility statement is stronger when someone else's name is on the audit. |
| Once | Trademark clearance and filing | — | **Yes.** Counsel. Critical path. |
| Once | `/privacy`, `/terms`, the DPIA and the AI Act position | — | **Yes.** Counsel. Gates launch. |
| Once | German transcreation, if the DE locale ships | — | **Yes**, a native writer. Machine translation is not an option here for the reason in §2, fortnight 6. |

**Roughly 8–10 hours a month** to operate this properly, plus two one-off legal engagements. That
is the real number, and it is worth writing down because the failure mode for a founder-operated
site is not doing it badly — it is quietly not doing it at all, and then wondering in month six why
nothing moved.
