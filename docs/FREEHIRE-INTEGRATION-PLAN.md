# freehire Integration Plan

Status: in progress on branch `feat/freehire-integration` (started 2026-10-21).
Extends Phase 7 of [`AI-JOB-SEARCH-PORT-PLAN.md`](AI-JOB-SEARCH-PORT-PLAN.md), which
added the original `providers/freehire.mjs`.

Source repo studied: [strelov1/freehire](https://github.com/strelov1/freehire) (MIT, Go)
at commit `e1a3de9`. Public API: `https://freehire.me/api/v1` (keyless, rate-limited per
address, licensed for personal / non-commercial use — Jobber's single-user, local-first
shape fits that; showing freehire data inside a product offered to others needs an API plan).

This plan does **not** port freehire's backend (Postgres/Meilisearch/LLM gateway/CV
builder/assistant/inbox). It fixes the existing provider, carries the deterministic
evidence freehire already sends for free, and ports two small pure algorithms.

## Constraints every phase respects

Taken from `AGENTS.md`, `ARCHITECTURE.md`, `DATA_CONTRACT.md` and the module headers read
during research:

- **Files are the source of truth.** No database, no new persistent store beyond
  append-only trailing TSV columns (the established `scan-history.tsv` pattern).
- **System/user split.** Updates never touch user-layer files. New system files are
  registered in `update-system.mjs` `SYSTEM_PATHS`; new user-layer columns are
  documented in `DATA_CONTRACT.md`.
- **Core providers:** no LLM, no auth, `redirect:'error'`, `description` only when the list
  payload carries it, contract test must pass.
- **Omit rather than guess.** A field the source cannot state precisely is left out
  (`salary` KEY PRESENCE contract in `providers/_types.js`).
- **Facts, not verdicts.** `company-history.mjs` / `company-intel.mjs` never emit verdict
  words (`ghost`, `risk`, …) and never print a classifier label as a judgement.
- **Zero-network scripts stay zero-network.** `salary-import.mjs`, `company-intel.mjs`,
  `company-history.mjs` never fetch. Fetching is a separate, explicit CLI step.
- **Never submits anything.** Apply-form data is read-only context.

## Research findings that drive the plan

| # | Finding | Evidence |
|---|---------|----------|
| F1 | `/jobs/search` returns a **truncated** description (index preview, ~1,000 chars); `/agent/jobs/search` returns it in full, same filters | Live probe 2026-10-21: same 3 postings → 967–992 chars vs 1,655–3,479 chars. freehire `docs/API.md` §`GET /agent/jobs/search` |
| F2 | The truncated text is what `scan.mjs` feeds to `content_filter`, `country_eligibility_filter`, `visaFilter` and the SimHash fingerprint | `scan.mjs:2271-2279`, `scan.mjs:2353` |
| F3 | `posted_within_days` trusts the source's stated date, which some boards restate every crawl; `open_within_days` counts from freehire's own first-seen and cannot be rewritten | freehire `docs/API.md` §Numeric & boolean filters |
| F4 | Every job carries a free `reality` object: `class`, `age_days`, `repost_count`, `mass_posting_count`, `fake_freshness` — currently discarded | Live probe; `internal/job/jobreality/classify.go` |
| F5 | The API now returns `salary_currency` + `salary_period`; the provider's "salary omitted by design" rationale predates that | Live probe (`EUR`), API docs facet table |
| F6 | `salary-gap.mjs` stores `benchmark` rows as type `advertised`, so when a benchmark is the effective advertised value it flows into `advToActPct` and the per-currency mean/median **unlabeled** — market figures silently blend with JD figures. Pre-existing defect, independent of freehire | `salary-gap.mjs:225-239`, `:267-269`, `:286-287` |
| F7 | `salary-gap.mjs` has no period concept (`parseAmount` assumes annual) and only recognises an UPPERCASE 3-letter currency in `advertised_comp` | `salary-gap.mjs:66-98`, `:140` |
| F8 | `company-history.mjs` posting churn sees only Jobber's own scans (`detectReposts(scan-history.tsv)`); freehire's counts span every source and full history | `company-history.mjs:223-228`, `:395-404` |
| F9 | freehire's ghost signal has a structural tier (portable, deterministic) and an outcome tier that needs ≥2 distinct contributors (not portable to a single-user tool) | freehire `internal/job/ghost/AGENTS.md` |
| F10 | `pipeline.md` labeled segments are forward-compatible (`web/src/lib/jobber.ts` `LABELED_SEGMENT`) — a new `history:` label is safe | `web/src/lib/jobber.ts:50-56`, `modes/pipeline.md:78-103` |
| F11 | `providers/_http.mjs` already attaches `err.status` / `err.retryAfter` on non-2xx | `providers/_http.mjs` `fetchWithTimeout` |

## Phases

Ordered so each phase is independently shippable and tested before the next starts.
Phases 1–5 are the core; 6 is additive tooling; 7 is deferred.

### Phase 1 — Provider: fix and extend `providers/freehire.mjs`

**Paradigm:** functional core / imperative shell. All request-building and normalization
stays in pure exported functions (`parseFreehireConfig`, `buildSearchParams`,
`normalizeJob`, `annualizeSalary`, `postingHistoryFrom`); `fetch()` remains the only
I/O shell.

**Pattern:** declarative *facet specification table* (data-driven Specification). Each
supported config key is one row `{ key, param, kind, allowed? }`; one generic sanitizer
and one generic param writer replace per-facet ad-hoc code. Adding a facet becomes a
one-row change. The wire → `Job` mapping in `normalizeJob` is the *anti-corruption
layer*: freehire's vocabulary never leaks past it.

1. **F1 fix:** call `/api/v1/agent/jobs/search` with `description_format=text`
   (plain text: what the regex filters and SimHash want). Same query vocabulary.
2. **F3:** add `open_within_days`; keep `posted_within_days` for compatibility and
   document that `open_within_days` is the one a source cannot fake.
3. **New facets** (validated against freehire's documented vocabularies):
   `seniority`, `category`, `employment_type`, `work_mode` (generalises `remote`, which
   stays as an alias), `visa_sponsorship`, `requires_clearance`, `exclude_company_types`
   (→ `company_type_exclude`), `exclude_reality` (→ `reality_exclude`, e.g.
   `likely-evergreen`), `salary_min` + `salary_currency`.
   Unknown enum values are dropped, never passed through (same discipline as `is_tech`).
4. **F5 salary:** emit `salary` only when `salary_currency` is a 3-letter code **and**
   `salary_period ∈ {year, month}` (multipliers 1 / 12); day/hour stay omitted because
   annualising them needs a full-time-hours assumption the provider cannot verify per
   posting. KEY PRESENCE contract: all three keys, unknown bound `null`, never 0.
5. **F4 posting history:** map `reality` → generic `job.postingHistory`
   `{ source: 'freehire', ageDays, repostCount, concurrentCount, fakeFreshness }` —
   facts only; freehire's `class` label is **not** carried (facts-not-verdicts).
6. **External reference:** `job.externalRef = { source: 'freehire', id: public_slug }`
   so later tooling (Phase 6 apply-form) can address the posting without a URL lookup.
7. **Rate limit (F11):** on a `429` with `Retry-After ≤ 30s`, wait once and retry that
   page; otherwise record the error and move to the next keyword (existing partial-
   failure semantics unchanged).
8. Update module header (provenance, salary rationale), `docs/SUPPORTED_JOB_BOARDS.md`,
   `templates/portals.example.yml`.

**Tests:** extend `tests/providers/freehire.test.mjs` — endpoint + `description_format`,
facet rows (valid, invalid-dropped, list OR), `open_within_days`, salary
year/month/day/hour/no-currency, `postingHistory` mapping and absence, `externalRef`,
429 retry-once. Contract test (`tests/providers/_contract.test.mjs`) must still pass.

### Phase 2 — Job contract + scanner persistence (`providers/_types.js`, `scan.mjs`)

**Paradigm:** keep `scan.mjs` source-agnostic. The two new Job fields are generic value
objects any provider may populate; nothing in `scan.mjs` mentions freehire.

1. Document optional `Job.postingHistory` and `Job.externalRef` in `_types.js`.
2. `formatScanHistoryRow`: append trailing columns (append-only pattern, existing readers
   unaffected): 12 `external_ref` (`source:id`), 13 `ext_age_days`, 14 `ext_repost_count`,
   15 `ext_concurrent_count`, 16 `ext_fake_freshness` (`1`/empty). Fresh-file header
   widened to match.
3. `formatPipelineOffer`: new labeled segment, emitted only when `postingHistory` is
   present — `| history: open 74d, 3 postings, 2 concurrent[, date restated]`.
   Order becomes `posted:` → `trust:` → `history:` → `note:`.
4. Docs: `DATA_CONTRACT.md` (scan-history columns), `modes/pipeline.md` (the new label,
   and how Block G should weigh it as evidence, not a verdict).

**Tests:** row formatter golden (with/without history; positions of existing cols
unchanged), pipeline line golden, header string.

### Phase 3 — Port the structural reality classifier (`lib/posting-reality.mjs`)

**Paradigm:** pure function module, no I/O, no clock (caller injects `now`) — a direct
port of freehire `internal/job/jobreality` (MIT, attributed in the header).

- `hasEvergreenMarker(text)` — curated multi-word phrase dictionary (EN + the RU forms
  freehire ships; never single words like "pipeline").
- `classifyPostingReality({ now, firstSeen, postedAt, repostCount, concurrentCount,
  evergreenText })` → `{ signals: { old, reposted, massPosted, evergreenText },
  signalCount, signalsTotal, converged, fakeFreshness, evidence }`.
  Thresholds identical to freehire (old ≥ 90d, historical reposts ≥ 3 beyond the
  concurrent ones, concurrent ≥ 5, convergence 2, fresh window 14d). Independence rule
  kept: concurrent postings are subtracted from repost count so one spray can't fire
  two signals.
- Returns signals + counts; deliberately **no** class string, so consumers can only
  report facts.

**Tests:** `lib/posting-reality.test.mjs` — each signal in isolation, convergence gate,
independence rule, fake-freshness, evergreen dictionary negatives ("data pipeline").

### Phase 4 — Feed external evidence into `company-history.mjs`

**Pattern:** optional source adapter, following the existing `loadStatusLogSource`
pattern — absent data degrades to `loaded:false`, never crashes, never changes other
axes.

1. `loadExternalHistory(rootDir)` reads cols 12–16 of `scan-history.tsv`, grouped by
   normalized company (col 11, falling back to `normalizeCompany(col 4)`); keeps the
   latest observation per `external_ref`.
2. `computePostingChurn` gains `external: { source, postings, maxRepostCount,
   maxConcurrentCount, dateRestatedCount, oldestAgeDays }` — counts only.
3. Summary renderer prints the facts; the existing vocabulary test (no `ghost`/`risk`)
   covers the new lines.

**Tests:** self-test fixtures in `company-history.mjs` (repo convention): external facts
present/absent, legacy rows without cols 12–16, vocabulary guard.

### Phase 5 — Fix benchmark blending in `salary-gap.mjs` (F6)

**Pattern:** keep the trust-tier fold untouched (it correctly picks the best available
figure); split the *comparison* by evidence kind. When the effective advertised value's
source is `benchmark`, the per-application delta is reported as `benchToActPct` and
`advToActPct` stays `null`; per-currency aggregates get a separate series
(`meanBenchToActPct`, `medianBenchToActPct`). Market data never contaminates the JD
series, and is still visible.

**Tests:** extend the inline `--self-test` golden: benchmark-only application lands in the
bench series, JD application unchanged, mixed currencies still guarded.

### Phase 6 — Explicit fetch CLI: `freehire-cli.mjs`

**Paradigm:** command-dispatch table over pure formatters; the only network I/O is
`providers/_http.mjs` `fetchJson` (reused, `redirect:'error'`, base-URL validation reused
from `providers/freehire.mjs` `resolveBaseUrl`). Prints to stdout; writes nothing.

- `salary --category backend --seniority senior --country DE [--num 042]` → JSON in the
  exact `salary-import.mjs` input shape (`amount: "p25-p75"`, `currency`, `note` with
  sample size). The user saves it and runs `node salary-import.mjs <file>` —
  `salary-import.mjs` stays zero-network.
- `apply-form <slug>` → captured ATS questions as Markdown, for `prepare-application` /
  `application-answers` (read-only; 404 → "no captured form").
- `company <slug>` → company facts (size, HQ, founded, type) as Markdown the user may
  paste into `data/company-intel/{slug}.md` — `company-intel.mjs` stays zero-network and
  the pasted-intel boundary is preserved.

**Tests:** `tests/freehire-cli.test.mjs` with an injected `fetchJson`: each formatter,
404 handling, argument validation.

### Phase 7 — Deferred (documented, not built)

- **ATS cross-check** (freehire `internal/job/ghost/crosscheck.go`): stamp an aggregator
  posting absent from the employer's own ATS board. Needs per-company board coverage
  first; an empty board list must mean "no coverage", never "absent".
- **URL → ATS detection** (`internal/ingest/atsdetect/fromurl.go`) for
  `discover-ats.mjs`, limited to ATSes Jobber has providers for.
- **freehire MCP server** (`strelov1/freehire-mcp`): one line in docs for Claude Code
  users; no code.

## Cross-cutting

- Register new system files in `update-system.mjs` `SYSTEM_PATHS`
  (`lib/posting-reality.mjs`, `lib/posting-reality.test.mjs`, `freehire-cli.mjs`).
- Run the affected suites after every phase, and `node test-runner.mjs` at the end; the
  SYSTEM_PATHS coverage guard and the provider contract test are part of it.
- No version bump / CHANGELOG edit (release-please owns those).

## Progress

| Phase | State |
|-------|-------|
| 1 Provider | done — `providers/freehire.mjs`, `tests/providers/freehire.test.mjs` (live smoke 2026-10-21: 20/20 jobs with history + ref, avg description 2,158 chars) |
| 2 Contract + scanner | done — `providers/_types.js`, `scan.mjs`, `tests/scan-posting-history.test.mjs` |
| 3 Reality classifier | done — `lib/posting-reality.mjs`, `tests/posting-reality.test.mjs` (test lives in `tests/` for auto-discovery) |
| 4 company-history | done — `company-history.mjs` (+ self-test), `company-intel.mjs` |
| 5 salary-gap benchmark split | done — `salary-gap.mjs` (+ self-test) |
| 6 freehire-cli | done — `freehire-cli.mjs`, `tests/freehire-cli.test.mjs`, `docs/SCRIPTS.md` |
| 7 Deferred | partly done — URL→ATS detection (`lib/ats-detect.mjs`, `discover-ats.mjs` `website` scan, `tests/ats-detect.test.mjs`; live: Valero→Taleo, Notion→Ashby) and the freehire MCP note (`docs/SCRIPTS.md`); ATS cross-check done as a same-run comparison (`lib/employer-board.mjs`, `employer-board:` pipeline segment, `tests/employer-board.test.mjs`) — no stored stamps, so nothing goes stale |
| 8 Native provider ports | done — 42 keyless providers ported from freehire adapters (see below) |
| 9 Search every platform | done — freehire `sources` / `exclude_sources` facets (`source` / `source_exclude`, verified live) |

### Phase 8 — native providers ported from freehire

Each is one `providers/<id>.mjs` + `tests/providers/<id>.test.mjs`, live-probed keyless on
2026-10-21, host-allowlisted, `redirect:'error'` on every request, rows in
`docs/SUPPORTED_JOB_BOARDS.md` and example stanzas in `templates/portals.example.yml`:

adp, adpmyjobs, careerplug, catsone, dayforce, deel, eightfold, factorial, freshteam, gupy,
herp, hireology, hiringroom, hiringthing, hrmanager, hrmdirect, hrmos, huntflow, inhire,
isolvedhire, jazzhr, join, jobscore, keka, manatal, neogov, odoo, pageup, paycom, paycor,
paylocity, peopleforce, recruiterflow, solides, taleo, taleobe, talentlyft, traffit,
trakstar, trudvsem, ukg, ukgready.

Not ported, and why:

- **betterteam** — serves a bot-challenge page to a non-browser user agent; only a spoofed
  browser UA gets the board. Not done (bot-detection evasion).
- **feishujobs, gusto, hibob, applitrack, dover** — freehire uses a browser tier for them.
- **bullhorn, gr8people, loxo** — credential/key-bearing per freehire's adapter; plugin-layer
  candidates at most.
- **Everything freehire covers but Jobber has no native provider for** stays reachable through
  the freehire provider (`sources: [...]`), including keyed boards (Adzuna, Reed, USAJobs) and
  Telegram channels.

Notable implementation choices:

- `dayforce` mints an anonymous next-auth CSRF cookie with one global `fetch` to the fixed
  `jobs.dayforcehcm.com` host (the shared `ctx` cannot read `Set-Cookie`).
- `paycom` reads an anonymous session token from the public portal page.
- `talentlyft` lists postings via `sitemap.xml` and fetches each posting's ld+json (the root
  page lists none) — capped at 20 postings per page budget.
- Salary is emitted only where the period is stated; `isolvedhire`/`ukgready` annualize hourly
  at ×2080, matching `ashby.mjs`'s `INTERVAL_MULTIPLIERS`.

Implementation notes:

- Column numbering: code comments count scan-history columns from 0 (`external_ref` = col 12);
  `DATA_CONTRACT.md` and `modes/pipeline.md` count from 1 (col 13), matching their existing style.
- The live `/insights/salary` shape is `{seniority, currency, period, sample_size, p25, p50, p75}`
  (differs from freehire's published example); `freehire-cli.mjs` follows the live shape.
- `company-history.mjs` attaches external facts only to companies that already have a card
  (tracker row or repost cluster) — marked as a `shortcut:` in code.
