# Job-Data Source Expansion — Implementation Plan

**Status:** implemented (Phases 1–5) · **Drafted:** 2026-08-30 · **Implemented:** 2026-08-30 · **Scope:** `providers/`, `docs/`, `templates/`, `tests/providers/`

**Implementation note:** all three providers (`providers/arbetsformedlingen.mjs`, `providers/apec.mjs`, `providers/eures.mjs`) are live, tested (`tests/providers/*.test.mjs`, full `providers/_contract` suite passing at 70/70), and smoke-tested against the real APIs — see the per-phase "Update from implementation" notes for what changed from the original research. Phases 4–5 landed as documentation additions to `docs/SCRIPTS.md`. Phase 6 remains deferred, unchanged.

Trigger: evaluation of the third-party catalog
`github.com/cporter202/job-data-apis-and-scrapers` (1,149 Apify actors +
12 CoreClaw workers) for use in Jobber.

---

## 0. Framing — what this plan is and is not

The catalog is an **unmoderated, affiliate-monetized link directory**, not a
library. It ships no reusable code (its only script is a 60-line
`https.get` → `writeFileSync` catalog sync), and its entry descriptions are
vendor marketing copy, not verified schemas. Jobber already recorded this
judgment: [`templates/job-data-sources.yml`](../templates/job-data-sources.yml)
names the catalog by URL, calls it unmoderated and affiliate-monetized, and
carries exactly three verified rows from it (LinkedIn / Indeed / Glassdoor,
`as_of: 2026-08-26`).

**The catalog's only durable value to Jobber is as a board-discovery index**
— a list of job boards worth having a provider for. It is *not* a list of
vendors to pay. Almost every actor in it is a paid duplicate of something
`providers/` already does for free and zero-auth.

This plan therefore implements **three new zero-key core providers** whose
endpoints were probed live during research, plus two documentation-only
integrations of existing scripts, and explicitly records what was rejected
and why.

### Non-goals (decided, do not revisit without new evidence)

| Rejected | Reason |
|---|---|
| Vendoring the catalog into the repo | 336KB of affiliate links; goes stale daily; `templates/job-data-sources.yml` already holds the verified subset |
| CoreClaw rows | All 12 workers cover LinkedIn/Indeed/Glassdoor — already covered by the 3 existing Apify rows. Jobber has no CoreClaw transport, and adding one to reach boards already reachable is pure cost |
| Multi-ATS actors (`santamaria-automations/career-site-jobs-scraper`, `jobo.world/ats-jobs-search`, …) | Paid duplicates of `greenhouse/lever/ashby/workday/icims/workable/personio/teamtailor/smartrecruiters/bamboohr/recruitee/rippling/breezy/comeet/pinpoint/gem/jobvite/avature/phenom/radancy/successfactors/csod`.mjs — and a `provider: apify` entry silently bypasses `salary_filter` and posting-age filtering (`normalizeItem()` maps only title/url/company/location), so the paid path is *worse filtered* than the free one |
| Arbeitsagentur actors (8 listed, $1–2/1k) | `providers/arbeitsagentur.mjs` already reads the official Bundesagentur REST API, free |
| SEEK AU/NZ actor | `providers/jobstreet.mjs` already covers SEEK's chalice-search API |
| Hiring-signal / ghost-job actors | `analyze-patterns.mjs`, `detect-reposts.mjs`, and report Block G already do this locally |
| **Adzuna as a core provider** | Verified against `developer.adzuna.com/overview`: `app_id` + `app_key` are **obligatory**. `providers/README.md` — "Core providers must be zero-auth against public endpoints." Adzuna is therefore out of scope for `providers/`. It is not proposed for the plugin layer either: it would need a new keyed transport to reach a board that `eures.mjs` (Phase 3) largely overlaps |

### Rot is real, not hypothetical

`templates/job-data-sources.yml` records that `nexgendata/salary-data-search`
404'd between being catalog-listed and being checked. **It is still listed in
the catalog copy examined for this plan.** Every phase below therefore carries
a live-probe gate before any code is written, and every claim about an
endpoint in this document was verified by an actual request on 2026-08-30
(marked ✅) or is explicitly flagged as unverified.

---

## 1. Architectural constraints every phase must respect

Sourced from [`providers/README.md`](../providers/README.md),
[`providers/_types.js`](../providers/_types.js), and
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

1. **Default export** `{ id, detect?, fetch }`. `id` unique and equal to the
   filename stem (enforced by `tests/providers/_contract.test.mjs`).
2. **Zero-auth, zero-token.** Public endpoint, no login, no LLM call, no
   per-job request just to enrich a field.
3. **Host allowlist + `redirect: 'error'`** on every request. The allowlist
   check happens *before* the fetch; `redirect:'error'` stops a server-side
   redirect being an SSRF vector. `assertGreenhouseUrl` in `greenhouse.mjs`
   is the reference shape; `himalayas.mjs` is the reference for a board-wide
   feed.
4. **`Job` shape discipline** (`_types.js`):
   - `title`, `url` required; `url` is the dedup key and must be absolute.
   - `description` populated **only** when the list payload carries it free.
   - `postedAt` epoch ms, omitted when the source has no usable date.
   - `salary` **annualized only**, and when present all three of
     `{min, max, currency}` are present with `null` for an unknown bound
     (never `0`) and `''` for an unknown currency. Omit the whole field when
     the source publishes no numeric comp — a wrong value silently drops
     well-paid roles as "below minimum" and the user never sees the posting.
5. **Explicit-only `detect()`** for board-wide feeds:
   `return entry?.provider === '<id>' ? { url: FEED_URL } : null`.
   No URL-pattern claiming — these are whole-board sources, not per-tenant.
6. **Export the pure parser** (`parseXResponse`) so tests can exercise it
   without a mock transport.
7. **Honor `ctx.maxPages`** (the portal health probe passes `1`) and use
   `ctx.sleep(ms)` when present, for any paginating provider.
8. **Filtering stays in `scan.mjs`.** Providers fetch and normalize;
   `title_filter` / `location_filter` / `salary_filter` / `content_filter`
   run downstream. Do not pre-filter in a provider beyond what the remote
   query itself does.

### Definition of done — applies to every provider phase

- [ ] `providers/<id>.mjs` created, `// @ts-check`, JSDoc `Provider` typedef
- [ ] `tests/providers/<id>.test.mjs` created (auto-discovered, no registration)
- [ ] Row added to [`docs/SUPPORTED_JOB_BOARDS.md`](SUPPORTED_JOB_BOARDS.md) **in the same PR** (mandatory per `providers/README.md`)
- [ ] Example entry added under `job_boards:` in `templates/portals.example.yml`
- [ ] `node test-all.mjs --only providers/_contract` green
- [ ] `node test-all.mjs --only providers/<id>` green
- [ ] `node verify-portals.mjs` routes the example entry without error
- [ ] CHANGELOG entry
- [ ] One live smoke run: `node scan.mjs` with only the new entry enabled

---

## Phase 1 — `providers/arbetsformedlingen.mjs` (Sweden) ✅ verified

**Why:** Sweden's national public employment service (Platsbanken). No Nordic
national board in `providers/` today (`thehub.mjs` is Nordic *startups*
only). The catalog's own entry advertises it as "via the free JobTech API. No
authentication required" — which is the tell that it belongs in `providers/`,
not behind a paid actor.

**Endpoint — probed live 2026-08-30, HTTP 200, no key, no header:**

```
GET https://jobsearch.api.jobtechdev.se/search?q=<query>&limit=100&offset=0
Accept: application/json
```

Confirmed: `security: []`, no `api-key` header needed (the community reports
of a required key refer to the older Platsbanken endpoints, not this one).
Live probe returned `{"total":{"value":146}, "hits":[…]}`.

**Response fields confirmed present on a hit:**

| Job field | Source | Note |
|---|---|---|
| `title` | `headline` | trim |
| `url` | `webpage_url` | already absolute `https://arbetsformedlingen.se/platsbanken/annonser/<id>` — validate host, do not construct |
| `company` | `employer.name` (fallback `employer.workplace`) | |
| `location` | `workplace_address.municipality` + `.region`, append `.country` when not `Sverige` | mirror `buildLocation()` in `arbeitsagentur.mjs` — same omit-home-country rule |
| `description` | `description.text` | **carried free in the list payload** — populate it, `content_filter` then works |
| `postedAt` | `publication_date` | ISO-ish `"2026-08-21T00:00:00"` (no zone). `Date.parse` it; omit on `NaN` |
| `salary` | — | **omit.** The API exposes only `salary_type` (a taxonomy concept, e.g. "Fast månads- vecko- eller timlön") and a free-text nullable `salary_description`. No numeric bounds, and the type field cannot even tell you the *interval* reliably. Emitting a guess here violates the annualization rule |

**Config block** (`parseArbetsformedlingenConfig`, mirroring
`parseArbeitsagenturConfig`): `keywords[]`, `municipality`/`region` concept
ids (optional), `limit` (clamp 1–100 — the API's per-page max), `max_pages`
(default 3). Each keyword is a separate server-side query, results deduped by
`url` — same pattern as `alibaba.mjs` / `tencent.mjs`.

**Pagination:** `offset` + `limit`. Honor `ctx.maxPages`. Stop early when
`hits.length < limit`.

**Security:** `TRUSTED_API_HOST = 'jobsearch.api.jobtechdev.se'`,
`TRUSTED_JOB_HOST = 'arbetsformedlingen.se'` (accept subdomains of the
latter for `webpage_url`, reject anything else), `redirect: 'error'`.

**Tests:** `parseArbetsformedlingenConfig` defaults + clamping;
`buildLocation` Sweden-omitted vs non-Sweden; `normalizeJob` happy path,
missing-headline drop, off-host `webpage_url` drop, unparseable date →
`postedAt` absent; `fetch` passes `redirect:'error'` and pins the host.

---

## Phase 2 — `providers/apec.mjs` (France) ✅ verified

**Why:** the sharpest gap in the repo. Jobber ships a full French market mode
set (`modes/fr/` — `offre`, `postuler`, CDI/CDD, SYNTEC, RTT, 13e mois) and
has **zero French providers**. APEC is France's national board for cadre /
executive roles — precisely the seniority band Jobber's archetypes target.

**Endpoint — probed live 2026-08-30, HTTP 200, no key:**

```
POST https://www.apec.fr/cms/webservices/rechercheOffre
Content-Type: application/json
{ "motsCles": "<query>",
  "typeClient": "CADRE",
  "sorts": [{ "type": "SCORE", "direction": "DESCENDING" }],
  "pagination": { "range": 100, "startIndex": 0 },
  "activeFiltre": true }
```

Live probe returned `{ resultats: [...], offreFilters: {...}, totalCount: 315 }`.

**Response fields confirmed present on a hit:**

| Job field | Source | Note |
|---|---|---|
| `title` | `intitule` | use `intitule`, **never** `intituleSurbrillance` (carries `<em>` highlight markup) |
| `url` | constructed: `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${numeroOffre}` | `numeroOffre` (e.g. `"179283743W"`) must be validated `^[0-9]+[A-Za-z]?$` and `encodeURIComponent`'d before interpolation — same discipline as `arbeitsagentur.mjs`'s `refnr` encoding. **Update from implementation (2026-08-30): this URL is best-effort, not verified.** apec.fr is a client-rendered Angular SPA — this path returns HTTP 200 for a garbage id exactly as it does for a real one, so a 200 is not proof of correctness. The only per-offer JSON detail endpoint found (`/cms/webservices/offre/public/{id}`) is behind DataDome bot-protection (403, JS challenge) and could not be probed. Shipped anyway (the search webservice itself is fully verified and useful on its own), with the caveat documented in the provider header, `docs/SUPPORTED_JOB_BOARDS.md`, and the `portals.example.yml` entry — spot-check a generated URL in a browser before relying on it for anything automated downstream of the link itself |
| `company` | `nomCommercial` | may be empty when `offreConfidentielle` is true — leave empty, do not invent "Confidential" (AGENTS.md uses `?` for unknown employers, and that is a tracker convention, not a provider one) |
| `location` | `lieuTexte` | already human-readable, e.g. `"Lille - 59"` |
| `description` | `texteOffre` | truncated teaser (~250 chars) in the list payload — free, so populate it, but **do not** follow the detail page to complete it (zero-token rule) |
| `postedAt` | `datePublication` (fallback `dateValidation`) | `"2026-08-20T00:32:28.000+0000"` → `Date.parse` |
| `salary` | `salaireTexte` | **Phase 2b, optional.** Format observed: `"45 - 55 k€ brut annuel"`. Parse **only** when the string matches an explicit annual pattern (`brut annuel` / `k€ annuel`); emit `{min: 45000, max: 55000, currency: 'EUR'}`. Any string mentioning `mensuel`, `jour`, `TJM`, or carrying no interval word → omit `salary` entirely. Ship Phase 2 without this; add it behind its own tests |

**Config block:** `keywords[]` (each a separate POST, deduped),
`type_client` (default `CADRE`), `page_size` (clamp 1–100), `max_pages`
(default 3), optional passthrough filters from `offreFilters`.

**Pagination:** `pagination.startIndex` += `range`, until
`startIndex >= totalCount` or `max_pages`.

**Security:** POST is new-ish for a core provider — `wttj.mjs`, `glints.mjs`,
`ibm.mjs`, `phenom.mjs`, and `tkms.mjs` already POST, so follow their shape.
`TRUSTED_HOST = 'www.apec.fr'`, `redirect: 'error'`, body built from
sanitized config only (never string-concatenated from raw user input).

**Language note:** APEC returns French text. `language.output` in
`config/profile.yml` governs *prose Jobber writes*, not scraped source text —
titles and teasers stay as published. No translation in the provider.

---

## Phase 3 — `providers/eures.mjs` (EU-wide) ✅ verified

**Why:** the official EU job-mobility portal, aggregating national public
employment services across the EU/EEA. Live probe reported
`numberRecords: 403027`. One provider covers every market Jobber ships a mode
set for inside the EU (DE, FR) plus the ones it does not
(ES, IT, PL, NL, …), with per-country filtering built into the query.

**Endpoint — probed live 2026-08-30, HTTP 200, no key:**

```
POST https://europa.eu/eures/api/jv-searchengine/public/jv-search/search
Content-Type: application/json
{ "resultsPerPage": 50, "page": 1, "sortSearch": "BEST_MATCH",
  "keywords": [{ "keyword": "<query>", "specificSearchCode": "EVERYWHERE" }],
  "publicationPeriod": null, "occupationUris": [], "skillUris": [],
  "requiredExperienceCodes": [], "positionScheduleCodes": [],
  "sectorCodes": [], "educationAndQualificationLevelCodes": [],
  "positionOfferingCodes": [], "locationCodes": [], "euresFlagCodes": [],
  "otherBenefitsCodes": [], "requiredLanguages": [], "minNumberPost": null,
  "sessionId": "jobber", "userPreferredLanguage": null, "requestLanguage": "en" }
```

Returns `{ numberRecords, jvs: [...], facets }`.

**Response fields confirmed present on a hit:**

| Job field | Source | Note |
|---|---|---|
| `title` | `title` | |
| `url` | constructed: `https://europa.eu/eures/portal/jv-se/jv-details/${id}?lang=en` | **probed live → HTTP 200** with the real opaque base64-ish id. `encodeURIComponent(id)` — ids contain `+`/`=`-class characters |
| `company` | `employer.name` | `employer` is an object; other keys are usually `null` |
| `location` | `locationMap` | shape is `{ "DE": ["DE138"] }` — country ISO code → NUTS codes. Render as the country code(s) joined; **do not** resolve NUTS→city names via `/shared-data-rest-api/public/reference/*` (that is a second network call per scan for cosmetics — YAGNI, and it breaks the one-request-per-page rule) |
| `description` | `description` | full HTML-ish text, carried free in the list payload. Strip tags before returning — reuse `providers/_html-entities.mjs` rather than writing another decoder |
| `postedAt` | `creationDate` | **already epoch ms** (`1786047838691`) — do not multiply. Guard the seconds-vs-ms ambiguity the way `himalayas.mjs`'s `toEpochMs` does |
| `salary` | — | **omit.** Not in the search payload |

**Config block:** `keywords[]`, `location_codes[]` (ISO country codes,
passed straight to `locationCodes`), `publication_period`
(`LAST_DAY`/`LAST_WEEK`/`LAST_MONTH`/null), `page_size` (clamp 1–50),
`max_pages` (default 3), `request_language` (default from
`config/profile.yml` `language.output`, falling back to `en`).

**Pagination:** `page` is 1-based. Stop when `jvs.length < resultsPerPage`.

**Spec provenance:** the request schema above came from the community-
maintained OpenAPI spec at `rorar.github.io/EURES-API-Documentation`
(`servers: https://europa.eu/eures/api`, `security: []`). That spec is
**reverse-engineered and unofficial** — record it as such in the provider
header comment, and treat the live probe, not the spec, as the source of
truth. `europa.eu` terms of use apply.

**Security:** `TRUSTED_HOST = 'europa.eu'`, `redirect: 'error'`. The `id`
comes from a remote payload and is interpolated into a URL — validate it
against `^[A-Za-z0-9_\-+=/]{8,256}$` and reject anything else, or a crafted
id becomes a path-traversal / open-redirect in `pipeline.md`.

---

## Phase 4 — Salary-benchmark ingestion path (documentation only, no new code)

**Finding:** [`salary-import.mjs`](../salary-import.mjs) already names "an
Apify actor's dataset export" as a first-class input in its own header. The
integration the catalog suggests **already exists**; what is missing is a
worked example. This phase writes no code — writing an actor-specific parser
would be exactly the mistake `salary-import.mjs` documents itself as
avoiding ("vendor actor output schemas vary … and actors get renamed or
delisted without notice").

**Deliverable:** a worked example in [`docs/SCRIPTS.md`](SCRIPTS.md) under
the `salary-import.mjs` section:

1. Run the actor in the user's own Apify account (their business, their
   token — Jobber never fetches it).
2. Export the dataset as JSON to a local file.
3. Reshape to `salary-import.mjs`'s documented record shape
   (`{company, amount, currency?, role?, date?, note?}`) with a `jq`
   one-liner or a throwaway script — include one worked `jq` example.
4. `node salary-import.mjs <file>` → appends to
   `data/salary-observations.tsv` as `type=advertised`, `source=benchmark`
   (bottom trust tier in `salary-gap.mjs`, never outranks a JD figure or a
   user observation).
5. Set `note` to the bare actor id so provenance survives.

**Explicit warning to include:** every candidate salary actor in the catalog
is unverified vendor copy, and one of them (`nexgendata/salary-data-search`)
is already dead while still being listed. Nothing here should imply an
endorsement of a specific actor.

**Optional (defer):** adding a row to `templates/job-data-sources.yml` for a
salary actor requires a new `hook:` value — the schema's `hook` field
currently means "which plugin hook consumes it (provider)", and a manual
export is consumed by no hook. Do not extend the schema for a single
speculative row; add it only if a verified actor is actually adopted.

---

## Phase 5 — Company-intel path (documentation only — boundary reaffirmed)

**Finding + hard constraint.** [`company-intel.mjs`](../company-intel.mjs)
reads optional pasted intel at `data/company-intel/{slug}.md` and states in
its own header: *"Never scraped, never fetched … This script never makes a
network request."* It draws the same "user-provided input, not automated
scraping" boundary as `paste-reply.mjs` and `jd-skill-gap.mjs`.

**Therefore: do not automate review scraping into that file.** An actor that
writes Glassdoor/Indeed/AmbitionBox reviews into `data/company-intel/`
without the user in the loop breaks a stated architectural boundary and
launders third-party opinion into apparent fact — which is the specific
failure mode that file's header exists to prevent.

**Deliverable:** one clarifying paragraph in `docs/SCRIPTS.md` stating that a
user *may* paste content they obtained themselves (including from a
review-scraper export they ran) into `data/company-intel/{slug}.md`, that it
lands inside the existing untrusted-data fence, that it is research context
for `interview-redflag` / `deep` only, and that per AGENTS.md §
Source-of-Truth Boundary it is **never** a content-generation source for CV,
cover letters, or application answers.

No code. No new file. No mode change.

---

## Phase 6 — Candidates evaluated, deferred (each needs a live probe first)

Recorded so the next person does not re-derive this. **No work starts on any
row until a live zero-auth probe returns 200 with a usable payload** — the
same gate Phases 1–3 passed.

| Board | Market gap it closes | Status |
|---|---|---|
| Japan-Dev / TokyoDev | `modes/ja/` ships with no JP provider | Unprobed. Small curated boards; check for a public JSON feed before assuming a parser is needed |
| Naukri | `modes/hi/naukri.md` mode exists with no provider | Unprobed, expected anti-bot. Likely keyed-only → plugin layer or nothing |
| Kariyer.net / Turkish boards | `modes/tr/` ships with no TR provider | Unprobed |
| Bayt / GulfTalent | `modes/ar/` ships with no ME provider | Unprobed |
| Wellfound (ex-AngelList) | Startup roles; no provider | Unprobed |
| Dice | US tech; no provider | Unprobed |
| Adzuna | 19 countries | **Rejected** — `app_id`/`app_key` obligatory (verified). Not zero-auth, so not a core provider; largely overlapped by Phase 3 |

**Structural observation worth acting on later:** Jobber ships market mode
sets for DE, FR, AR, JA, TR, HI but only DE has a matching national provider
today. Phase 2 (FR) and Phase 3 (EU-wide) close the largest part of that;
JA / TR / HI / AR remain the standing gap, and that mismatch — not the
catalog — is the better roadmap driver.

---

## 7. Sequencing and risk

**Order:** Phase 1 → 2 → 3, one PR each. Phases 4 and 5 are docs-only and can
land any time, independently.

Phase 1 first: it is a plain GET with the simplest payload and the closest
existing analogue (`arbeitsagentur.mjs`), so it validates the pattern before
Phase 2/3 add POST bodies and constructed URLs.

| Risk | Mitigation |
|---|---|
| APEC / EURES endpoints are undocumented or unofficial and can change without notice | Provider header records probe date + spec provenance; `fetch` throws a descriptive shape error (`himalayas.mjs`'s "expected `{jobs: […]}`, got keys: […]" pattern) rather than returning `[]`, so breakage is loud, not silent |
| Constructed job URLs (APEC `numeroOffre`, EURES `id`) drift | Validate the id against a strict regex, `encodeURIComponent`, and smoke-test one real URL for HTTP 200 before merge |
| Remote payloads feed URL construction (SSRF / open redirect) | Host allowlist before fetch, `redirect:'error'`, strict id regex, HTTPS-only. Consider extending `tests/providers/ats-ssrf-hardening.test.mjs` — it is hardcoded per provider, not auto-discovered |
| Salary misparse silently hides good roles | Phase 2b ships separately with its own tests; omit `salary` unless the source string explicitly says annual |
| Scope creep back into the catalog | Section 0's rejection table is the answer; new actors need the `templates/job-data-sources.yml` contribution rule (bare id with vendor referral/tracking query params **stripped**, direct schema check, `as_of` + `sources`) |

## 8. Verification

```bash
node test-all.mjs --only providers/_contract
node test-all.mjs --only providers/arbetsformedlingen
node test-all.mjs --only providers/apec
node test-all.mjs --only providers/eures
node verify-portals.mjs
node check-table-freshness.mjs --summary
node test-all.mjs
```

Plus one live `node scan.mjs` per phase with only the new `job_boards:` entry
enabled, confirming rows reach `data/pipeline.md` with a resolvable URL.
