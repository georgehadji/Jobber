# Port Plan — Capabilities Adapted from `MadsLorentzen/ai-job-search`

**Status:** All 8 phases implemented · **Drafted:** 2026-09-01 · **Scope:** `lib/`, `providers/`, `modes/`, `config/`, `docs/`, `tests/`, `documents/`

**Implementation notes:**
- **Phase 6** (relevance-weighted trim guidance): landed in `generate-pdf.mjs`
  and `modes/pdf.md`.
- **Phase 1** (`lib/robots.mjs` + `tests/robots.test.mjs`, registered in
  `SYSTEM_PATHS`): 18 passing assertions, three verified to fail red without
  their corresponding fix (blank-line tolerance, percent-decoding, soft-200
  detection). Correction from the plan as drafted: an oversized robots.txt
  body is truncated and parsed (RFC 9309 permits ignoring content past 500
  KiB), not rejected as unconfirmed — the plan text above is updated to
  match.
- **Phase 2** (`lib/pdf-text.mjs`, `--dump-text`/`--strict-text` on
  `generate-pdf.mjs`, `modes/pdf.md` step 20-21): the object/font-resolution
  logic was validated against REAL Chromium PDF output (rendered live via
  Playwright during development, not assumed) — confirmed classic
  non-xref-stream objects, Type0/Identity-H composite fonts with embedded
  ToUnicode CMaps, matching the assumption `countRenderedPdfPages` already
  relies on in production. One real bug caught and fixed before any test was
  written: nested `<<...>>` dicts (Resources containing ExtGState and Font)
  broke a non-greedy regex, which stops at the FIRST `>>` — replaced with a
  balanced-bracket walker (`findBalancedDict`). 13 unit assertions in
  `tests/pdf-text-layer.test.mjs` (hand-built fixtures via
  `tests/fixtures/pdf-fixtures.mjs`, mirroring the verified real-PDF shape)
  plus 5 CLI-integration assertions in `tests/generate-pdf-text-layer.test.mjs`
  (sandboxed subprocess + stub Playwright, mirroring the existing
  `tests/generate-pdf-page-budget.test.mjs` harness). Both mandatory negative
  cases (a font with no ToUnicode CMap; `--strict-text` rejection) were
  verified to fail red without their fix, not just pass green as written.
  Deviation from the plan as drafted: fixtures are a generated `.mjs` builder
  rather than committed binary `.pdf` files — a hand-built PDF's byte layout
  is far more reviewable as generator code than as an opaque binary blob in
  a text-heavy repo, and the module's own object-scanning approach (same as
  `countRenderedPdfPages`) never reads xref/trailer, so a fixture doesn't
  need one to be byte-accurate.

- **Phase 3** (`languages:` table in `config/profile.example.yml`, the Language
  Gate section in `modes/oferta.md`, `language_gate`/`language_note` in
  `lib/report-schema.mjs`): `validate-report.mjs` needed zero changes — it
  already calls the shared `validateReportSummary`, which now inherits the
  new check for free, exactly the "single shared parser" design the M1
  dimensions work already established. Confirmed against the real
  `reports/` corpus: `node validate-report.mjs --summary` shows the same 3
  pre-existing defects (an out-of-range `red_flags` score, unrelated to this
  work) and zero new ones, since no real report carries a `language_gate`
  field yet. One scope correction made during implementation, not present
  in the plan as drafted: `modes/triage.md` explicitly reads ONLY
  `modes/_brief.md` and forbids reading `config/profile.yml` — so the gate
  cannot run inside triage without breaking that design. Resolution: the
  gate is authoritative in `modes/oferta.md` only; `modes/triage.md` and
  `modes/_brief.template.md` gained a note + an example Hard-DQ bullet
  pointing users at encoding a language requirement there too, if they want
  triage itself (not just the full evaluation after it) to catch the
  mismatch. A role triage misses still gets stopped by the real gate before
  Block A — nothing slips through, it just costs one triage pass instead of
  zero.

- **Phase 8** (supply-chain guard parity): `plugin-audit.mjs` gained
  `auditManifest` — flags any `package.json` under a plugin directory
  (including nested, e.g. `cli/package.json`, the shape ai-job-search's
  portal skills use) that defines a `preinstall`/`install`/`postinstall`/
  `prepare`/`prepack` lifecycle script or sets `trustedDependencies`. No test
  existed for `plugin-audit.mjs` before this — `tests/plugin-audit.test.mjs`
  is new and scoped to the manifest check specifically, with the mandatory
  negative case (every lifecycle-script name, individually) verified to fail
  red without the fix. `test-all.mjs` gained a `.gitignore` negation guard:
  reuses `USER_PATHS` from `update-system.mjs` (via the same
  `extractArrayFromSource` helper `validate-system-paths-coverage.mjs`
  already relies on, rather than a second hand-maintained list) and flags any
  `!`-prefixed line that would re-include a non-`.gitkeep`, non-`README.md`
  file under a user-data prefix. Two real false positives surfaced and were
  excluded during implementation, not anticipated in the plan as drafted:
  `!data/offers/` / `!interview-prep/sessions/` (the standard "negate the
  directory, re-ignore its contents" idiom for keeping an empty dir in git)
  and `!interview-prep/sessions/README.md` / `!writing-samples/README.md`
  (system-authored documentation re-included inside an otherwise-ignored
  directory) — both legitimate, confirmed clean against the real
  `.gitignore` with zero suspicious entries, and a synthetic injected leak
  (`!config/profile.yml`) confirmed still caught.

- **Phase 4** (`ingest-documents.mjs`, `documents/` scaffold): landed as
  drafted, with one deliberate scope cut made explicit rather than silently
  dropped — **DOCX is unsupported**. The plan proposed reusing `node:zlib`
  for ZIP-container parsing plus a minimal XML sweep; on reflection this
  matches roughly the same complexity class as `lib/pdf-text.mjs` for a
  format the reference implementation itself does not support either (its
  own `documents/README.md`: `.docx` → "No, convert to PDF before placing
  here"). Shipping `.pdf`/`.md`/`.txt`/`.tex` first, with `.docx` reported
  in `skipped[]` with a clear reason rather than silently ignored, delivers
  the overwhelmingly common case (CV PDF, LinkedIn PDF export, diploma PDF)
  without the added parser surface; DOCX can be added later as its own
  follow-up if real demand shows up.

  The containment guard resolves symlinks on BOTH the file and its parent
  subdirectory (the plan only specified the file) — necessary because
  `documents/cv/` itself could in principle be a symlink/junction, and
  resolving only the file while comparing against the subdirectory's
  UNresolved path would miss that case. Verified for real on this Windows
  machine, not just reasoned about: a symlink was created inside
  `documents/cv/` pointing at `config/profile.example.yml`, and confirmed
  refused (`ingest()` never reads the target) both via manual smoke test and
  via `tests/ingest-documents.test.mjs`'s own symlink case, which degrades
  to a skipped-with-explanation assertion rather than a false failure on a
  CI runner that can't create symlinks without elevation.

  `documents/` needed the same two-level negate-then-reignore `.gitignore`
  idiom `interview-prep/sessions/` already established (a bare `!writing-
  samples/README.md`-style single negation isn't enough once there are
  nested subdirectories) — verified with a real synthetic "personal data"
  file placed in `documents/cv/` and confirmed excluded by `git add`, while
  the four `.gitkeep` scaffolds and `documents/README.md` were confirmed
  included. `tests/ingest-documents.test.mjs` runs against a fully isolated
  sandbox (never the repo's own `documents/`), and includes a structural
  read-only check: snapshot every file's size+mtime before and after a run,
  assert byte-for-byte and mtime-for-mtime identical — the "writes nothing"
  guarantee AGENTS.md's confirm-before-write rule depends on, checked
  directly rather than only reasoned about.

  Wired into `docs/ONBOARDING.md` Step 1: `ingest-documents.mjs` runs before
  the paste/narrate fallback prompt, findings are summarized and confirmed
  before any write to `cv.md`, and `documents/` was deliberately NOT added
  to `AGENTS.md`'s Source-of-Truth Boundary list — it is an input that
  funnels into `cv.md`/`config/profile.yml` through the existing confirm
  gate, never a parallel source of truth alongside them.

- **Phase 7** (`providers/freehire.mjs`): the plan's own gate — "no work
  starts on any row until a live zero-auth probe returns 200 with a usable
  payload" — was run for real, not assumed. `GET
  https://freehire.me/api/v1/jobs` returns 200 with no key, `meta.total:
  3199525`. Danish-market coverage confirmed directly:
  `countries=dk&is_tech=tech` alone returns **2337** real tech postings
  (Lunar, emagine — genuine Danish companies), closing the `modes/da/`
  provider gap `docs/JOB-DATA-SOURCES-PLAN.md` already flagged, with zero
  Danish-specific code.

  One correction to the plan as drafted, found only by testing the live
  API rather than trusting the aggregator's own skill description: `GET
  /api/v1/jobs` (the bare list endpoint) takes **no filter params at all** —
  `?q=kubernetes` against it silently returns the same 3.2M-job unfiltered
  count every time. The actual keyword/facet-filterable endpoint is `GET
  /api/v1/jobs/search`, confirmed by reading the backend's own source
  (`strelov1/freehire`, MIT — `internal/api/handler/search.go`'s
  `searchParams = []string{"q", "sort", "order", "limit", "offset"}` and
  `internal/search/search/query_filter.go`'s `StringFacets` map), not by
  guessing param names against the wrong route. That same source read
  surfaced the full real facet vocabulary — `countries`, `regions`,
  `work_mode`, `is_tech`, `seniority`, `category`, `posted_within_days`, and
  more — none of which the freehire skill's own flag list
  (`--region`/`--country`/`--remote`) documents by name.

  `salary` is deliberately never emitted (see the provider's module header):
  `enrichment.salary_min/max` carry a per-posting `salary_period`
  (year/month/day/hour) with no normalized currency, and the Job contract's
  own KEY PRESENCE rule (`_types.js`) means a wrong day/hour→annual guess
  silently drops a well-paid role as "below minimum" with no visible error
  — the same reasoning `eures.mjs` already established for omitting salary
  rather than risk it.

  Built to the existing `providers/README.md` contract exactly:
  `providers/freehire.mjs` (config-block-driven, `resolveProfileKeywords()`
  fallback, per-keyword pagination with dedup, matching `eures.mjs`'s
  established shape for a config-driven multi-page provider) plus
  `tests/providers/freehire.test.mjs` (21 assertions, auto-discovered by
  `tests/providers/_contract.test.mjs` with zero registration). Two
  mandatory negative cases verified to fail red without their fix: the
  `FREEHIRE_API_URL` self-host override's scheme guard (a `file:` URL is
  refused, not followed) and the total-outage throw. Live smoke-tested
  against the real API during development (not just the mocked test suite)
  — real Danish "Platform Engineer" postings at Terraform and Relesys came
  back with full descriptions and correct `postedAt` epoch-ms values.

  `docs/SUPPORTED_JOB_BOARDS.md` and `templates/portals.example.yml` gained
  a `freehire` row/example block, added by reverting each file to its
  clean, already-committed state first and editing that — both files
  carried unrelated, not-yet-committed additions from the apec/
  arbetsformedlingen/eures work already in this working tree before this
  session started, and mixing an unrelated diff into this commit would have
  wrongly attributed someone else's in-progress work.

All eight phases are now implemented.

Trigger: review of [`MadsLorentzen/ai-job-search`](https://github.com/MadsLorentzen/ai-job-search)
(MIT, Python + TypeScript, Claude Code framework) for capabilities Jobber does
not have. That repo is a single-market fork template of roughly 200 files.
Jobber is larger and stronger in nearly every area the two overlap on: tracker
state machine, report allocation, five-vendor ATS scanning, salary tooling,
interview modes, plugin layer, 20 market mode sets. The transferable value is a
small set of **verification and safety habits**, not features.

---

## 0. Framing — what this plan is and is not

Every item below closes the same class of gap: **Jobber owns the producing half
of a loop and not the checking half.** It normalizes text for ATS parsers and
never reads the text back out of the finished PDF. It fetches HTML with a
browser User-Agent and never asks whether the site published a policy against
it. It generates application documents and never has a second reader attack
them.

Three constraints bound everything here:

1. **Nothing in this plan changes the layer boundary.** New code is system
   layer and must be registered in `SYSTEM_PATHS`; new data is user layer and
   must never appear there. `DATA_CONTRACT.md` wins over convenience in every
   case, and `updater-migration-tests.mjs` enforces it.
2. **Core stays zero-auth, zero-token, and dependency-light.** `package.json`
   carries four runtime dependencies on purpose. No item below adds a fifth.
   Where the source repo reached for `pypdf` or Poppler, this plan uses
   `node:zlib`.
3. **Prompt work stays in `modes/`; deterministic work stays in scripts.** A
   rule an agent must follow is a Markdown edit. A check that must not depend
   on model judgment is a `.mjs` file with a test.

MIT on both sides, so porting is permitted. Only `robots_check.py` and
`verify_pdf.py` were read closely enough to inform a port; both are
reimplemented here rather than copied, so no notice is carried. Where a rule
came from their prompt files, that is stated in the phase.

### Not doing, and why

| Candidate | Decision |
|---|---|
| LinkedIn `jobs-guest` scraper as a core provider | **Rejected.** Automated access breaks LinkedIn's terms of service. `ARCHITECTURE.md` restricts core providers to open, no-auth public sources, and `AGENTS.md`'s ethics section governs the rest. If anyone wants it, it is a plugin-layer decision for the maintainer, not an enhancement. |
| Their `upstream_triage.py` / `check_upstream_updates.py` | **Deferred.** Jobber is the upstream in this relationship. Value accrues only to people running personalized forks, and `update-system.mjs` already covers the layer-safety half. Revisit if fork-maintenance issues appear. |
| Their `/reset` command | **Rejected.** `git checkout` and deleting a file already do this. A destructive command that needs a typed `RESET` confirmation is a support liability with no capability gain. |
| Copying their per-portal CLI skill architecture (`bun`, one CLI per board) | **Rejected.** `providers/` already solves this with less: filesystem-convention discovery, one contract, one shared HTTP transport, one contract test that covers new providers with no registration. Their pattern needs `bun install` per board. |

---

## Phase 1 — robots.txt gate for browser-User-Agent escalation

**Gap.** `grep robots` across the repo returns one hit, a contributor
signature in `SIGNATURES.md:60`. `providers/_http.mjs:17` exports
`BROWSER_LIKE_USER_AGENT` for providers that must clear a WAF, used today by
`glints.mjs`, `icims.mjs`, and `workday.mjs`. That escalation currently runs
with no reference to what the site published.

**Boundary — read this before writing code.** The gate covers the escalation
path only:

| Path | Gated? | Reason |
|---|---|---|
| Browser-UA retry after a block | **Yes** | This is the case the gate exists for: a WAF default on a site whose published policy allows access, versus a site that actually declined |
| `browser-extract.mjs`, `liveness-browser.mjs` | **Yes** | Headless browser against arbitrary boards |
| `scan-ats-full.mjs` HTML sweeps | **Yes** | Broad crawl over hosts the user never named individually |
| Configured ATS JSON APIs under the default UA | **No** | Documented public APIs for boards the user explicitly configured in `portals.yml`. Gating them would break working scans over a file that governs crawlers of HTML, not API clients |

Gating everything is the tempting version and the wrong one. It converts a
safety improvement into a regression across 70 providers.

### Design

New file `lib/robots.mjs`. **Functional core, imperative shell.** Parsing and
matching are pure and total; the only IO is a fetch injected by the caller,
which is what lets the tests run with no network, matching the
`tests/providers/_contract.test.mjs` convention.

```js
// pure
export function parseRobots(text)                 // → Map<agent, Rule[]>
export function isAllowed(rules, agent, path)     // → boolean
export function looksLikeRobots(text)             // → boolean
// shell (fetch injected)
export async function gate(url, { fetchText, now }) // → { allowed, reason }
```

Rules to implement, each one a bug the source repo documents having fixed:

1. Longest match wins. On equal specificity, `Disallow` wins.
2. A `Disallow` for `*` or for the Jobber agent token blocks the escalation.
3. Blank lines inside a record do not end the record.
4. Percent-decode the pattern before matching the already-decoded path, or
   `Disallow: /foo%20bar` silently never matches `/foo bar` and fails open.
5. `404` means no published policy, which is permission.
6. `200` with a body carrying no recognized directive is **unreadable**, not
   permission. A misconfigured host answering `/robots.txt` with an HTML error
   page must not grant access it never gave. An empty body stays allow-all,
   which is what RFC 9309 says.
7. Any other outcome leaves permission **unconfirmed**, and unconfirmed means
   no escalation.

Caching: one `Map<origin, {result, expiresAt}>` with a short TTL, in the module,
mirroring `providers/_dns-cache.mjs`. Keyed by scheme plus host, never by host
alone.

### Security

- **SSRF.** Rebuild the target as `${scheme}://${host}/robots.txt` from the
  parsed URL; never concatenate caller input. Accept `http:` and `https:` only.
- **Redirects.** `providers/README.md` mandates `redirect: 'error'` for SSRF
  reasons, but `http → https` on `/robots.txt` is normal. Compromise: follow at
  most two redirects, and only while the host is unchanged. Any cross-host
  redirect returns unconfirmed rather than following.
- **ReDoS.** Build the match regex from per-character escaped literals with `*`
  and `$` as the only metacharacters, exactly as the source does. Never
  interpolate a pattern into a regex unescaped.
- **Response size.** Cap the read at 512 KiB and treat a longer body as
  unreadable. RFC 9309 permits ignoring beyond 500 KiB.
- **Fail closed on this path only.** Unconfirmed blocks the escalation and
  never blocks the default path, so a robots.txt outage degrades one retry
  rather than the scanner.

### Tests — `tests/robots.test.mjs`

`lib/*.mjs` modules are tested from `tests/<name>.test.mjs` (see
`tests/score-summary.test.mjs`, `tests/sunset-policy.test.mjs`) — that is the
directory `discoverTests(TESTS_DIR)` actually walks in `test-all.mjs`/
`test-runner.mjs` (`TESTS_DIR = join(ROOT, 'tests')`). `lib/context-budget.test.mjs`
lives beside its module as a legacy exception, not the pattern to copy. Auto-discovered,
no registration. Each of the seven
rules gets a case, and each must fail without the corresponding line of the
implementation. Specifically required, because these are the fail-open cases:

- blank line inside a record still binds the following `Disallow`
- `Disallow: /foo%20bar` blocks `/foo bar`
- `200` with `<html>Not found</html>` returns unconfirmed, not allowed
- equal-length `Allow` and `Disallow` resolves to disallowed
- a body over the cap is truncated and parsed from the first 512 KiB (RFC 9309 permits ignoring content past 500 KiB — this is a cap-and-parse, not a cap-and-reject)

### Registration checklist

- `// @ts-check` at the top; `node validate-typecheck-coverage.mjs --bless`
- `SYSTEM_PATHS`: add `'lib/robots.mjs'` and `'lib/robots.test.mjs'`. The array
  lists `lib/` files individually (`update-system.mjs:145`), it does not carry
  the directory
- `node validate-system-paths-coverage.mjs` clean
- No `docs/SCRIPTS.md` row: this is a library, not a runnable script

**Effort:** one session. **Risk:** low, additive, one call site per consumer.

---

## Phase 2 — verify the PDF text layer that an ATS actually reads

**Gap.** `generate-pdf.mjs:52` normalizes text for ATS parsers on the way in.
`generate-pdf.mjs:297` reads the page count from the PDF catalog. Nothing reads
the text back out of the rendered PDF. An applicant tracking system parses the
embedded text layer, not the rendered page, so the file Jobber reports as clean
is never checked the way the recipient will read it.

`modes/pdf.md:41` asks the model to report a keyword-coverage percentage
without naming a source. After this phase it has one.

### Design

New file `lib/pdf-text.mjs`, pure decoding, no IO:

```js
export function extractPdfText(buffer)   // → { text, perPage: string[], warnings: string[] }
export function auditTextLayer(text, { mustContain, expectedOrder })
                                          // → { ok, findings: Finding[] }
```

Decoding path, all `node:zlib`, no new dependency:

1. Walk the xref or scan objects for page content streams.
2. Inflate `FlateDecode` streams. Cap the inflated size at 32 MiB and abort
   past it.
3. Collect `Tj`, `TJ`, `'` and `"` show-text operands.
4. Map bytes to characters through each font's `ToUnicode` CMap. Chromium
   embeds subset fonts with a `ToUnicode` map, which is exactly why this is
   tractable for PDFs Jobber itself produced.
5. A font with no `ToUnicode` yields a warning and `(cid:N)` placeholders,
   which is the failure signal, not an error.

**This is a validator for our own output, not a general PDF parser.** State
that in the module header so nobody grows it into one. If the file was not
produced by `generate-pdf.mjs`, unreadable is an acceptable answer.

Checks in `auditTextLayer`, ported from their `/apply` checklist:

| Check | Failure it catches |
|---|---|
| Extraction is non-empty | A PDF that renders correctly and parses as nothing |
| Email and phone appear as literal text | A contact detail carried only by an icon glyph or a hyperlink, invisible to a parser |
| No `(cid:` and no `�` | Font embedding that extracts as garbage |
| Section order matches the payload's order | Multi-column or float layouts that interleave lines |

### Wiring

Inside `generate-pdf.mjs`, after the buffer exists and beside the existing page
budget call. Follow the flag design already there rather than inventing one:

- `--dump-text=<path>` writes the extraction, so the keyword-coverage step in
  `modes/pdf.md` has a real artifact to score against
- warn by default, exactly like `--max-pages`
- `--strict-text` turns findings into a non-zero exit, exactly like
  `--strict-pages`
- both flags added to the `--capabilities` JSON at `generate-pdf.mjs:417`, or
  `validate-mode-invocations.mjs` will reject the mode edit

`modes/pdf.md` gains one line in step 20 and a source for step 21's coverage
percentage.

### Tests — `tests/pdf-text-layer.test.mjs`

Two committed fixtures under `tests/fixtures/`, both small and hand-built so
the suite stays offline and Playwright-free:

1. A clean PDF with an uncompressed content stream and a `ToUnicode` CMap.
   Asserts extraction, contact literals, and order.
2. A PDF whose font carries no `ToUnicode`. Asserts the audit **fails**.

The second fixture is the point. A check that cannot fail proves nothing, so
the negative case is mandatory, not optional.

### Security

- Decompression bomb: hard cap on inflated bytes, abort rather than allocate.
- Never `eval` or execute anything found in a PDF. Only string extraction.
- The dump path is caller-supplied: resolve it and refuse paths outside the
  repository root, matching how the rest of the generator handles output paths.
- Input is the user's own generated file, so trust is high, but the caps stay,
  because Phase 4 feeds the same decoder with arbitrary PDFs the user drops into
  `documents/`.

**Effort:** two to three sessions, the largest item here. The CMap handling is
where the time goes. **Risk:** medium, contained by warn-by-default.

---

## Phase 3 — Language Gate

**Gap, stated precisely.** Jobber is not silent on language: `modes/oferta.md:463`
and `:496` already tell the model to detect a language requirement and surface
it as a gap in the cover-letter draft. What is missing is the **declared-levels
table to compare against** and the **pre-scoring stop**. `config/profile.example.yml:89`
defines `language.output` and `:188` defines languages being learned. Neither
says what the candidate actually speaks.

### Design — data

`config/profile.yml` gains an optional block. User layer, so the shipped change
is to `config/profile.example.yml` (system layer) plus the onboarding prompt:

```yaml
languages:
  - language: Spanish
    level: native
  - language: English
    level: C2
    note: "Cambridge CPE"
```

`level` is free text on purpose. CEFR letters, LinkedIn buckets, and plain
words all appear in the wild and do not map cleanly onto each other. Forcing a
scale would produce false precision in a judgment the human should make.

**Absent block means the gate is off**, mirroring `data/blacklist.md`
semantics at `modes/oferta.md:18`. `doctor.mjs` must not start requiring it.

### Design — rule

Prompt layer. New section in `modes/oferta.md` beside the blacklist gate, before
Block A, and a veto line in `modes/triage.md`:

| Posting requirement versus the declared table | Verdict |
|---|---|
| Names a language absent from the table | **FAIL.** No score, no draft. Quote the requirement verbatim |
| Names a declared language at a bar that reads higher than the declared level | **FLAG, then proceed.** Score and draft, surface both quotes, let the human judge |
| Names a declared language at or below the level, or names it with no level | **PASS** |

The distinction worth copying from their `04-job-evaluation.md` is this: **the
language the advertisement is written in is not the language the job requires.**
A German-language advertisement for a role whose working language is English
passes cleanly. Only an explicit job condition triggers the gate.

When genuinely unsure whether a stated bar exceeds the declared level, FLAG
beats a silent PASS. The human is the tiebreaker, not the gate.

### Design — machine surface

`## Machine Summary` gains `language_gate: pass | flag | fail` and an optional
`language_note`. Add the field to `lib/report-schema.mjs` and
`validate-report.mjs` as **optional**, so every existing report in `reports/`
still validates. A required field here would fail the whole corpus on the first
run.

### Tests

`tests/mode-file-integrity.test.mjs` already asserts structure across modes;
extend it for the new gate section. Add a schema case proving an old report
without the field still passes and a new report with an invalid value fails.

**Effort:** one session, mostly prose. **Risk:** low, but the FAIL branch
discards work, so the wording must be tight enough that a model does not
over-trigger it. Write the worked examples into the mode file.

---

## Phase 4 — ingest documents the user already has

**Gap.** `docs/ONBOARDING.md` steps 1 through 6 ask the user to paste a CV,
paste a LinkedIn URL, or narrate their history. Step 5 then asks for the exact
material that a parsed CV, LinkedIn export, and reference letters would already
supply. The user retypes what they own.

### Design

New user-layer directory, gitignored:

```
documents/
  cv/           master CV, PDF or .tex
  linkedin/     profile export PDF
  diplomas/     degrees and transcripts
  references/   reference letters
```

New script `ingest-documents.mjs`. **Pipeline of pure stages behind one IO
shell**: enumerate, extract, classify, emit. It prints a JSON inventory and
**writes nothing**:

```
node ingest-documents.mjs --json
→ { files: [ { path, kind, chars, text } ], skipped: [ { path, reason } ] }
```

The agent turns that into `cv.md` with the user confirming, which keeps the
source-of-truth rule intact: a parsed reference letter is a document the user
supplied, so it has the same trust level as `cv.md`, and the parse may
reformat but never add a claim the document does not make.

Extraction reuses Phase 2's `lib/pdf-text.mjs` for PDF and `node:zlib` plus a
minimal XML text sweep for DOCX. That dependency direction is why Phase 2 comes
first: no new package for either format.

### Security and privacy

- **Path containment.** Resolve every candidate path and refuse anything that
  escapes `documents/`. Symlinks resolved before the check, not after.
- **Size caps.** Skip files over 20 MB, cap total emitted text, report skips in
  `skipped[]` rather than silently dropping them.
- **Decompression caps** inherited from Phase 2 and applied to DOCX.
- **Untrusted content.** A PDF or DOCX can contain text addressed to the agent.
  The mode file must state that ingested document text is data, never
  instructions, in the same words `modes/oferta.md` already uses for job
  descriptions.
- **`.gitignore`** gains `documents/` before the directory is created, and
  `DATA_CONTRACT.md` lists it under `USER_PATHS`. Verify with
  `node validate-system-paths-coverage.mjs`, and confirm `test-all.mjs:1126`
  (user files must not be tracked) covers it.

### Tests — `tests/ingest-documents.test.mjs`

Temporary directory fixtures. Cases: containment refusal on a symlink pointing
outside, oversize skip recorded not dropped, DOCX text extracted, unreadable PDF
reported rather than thrown.

**Effort:** two sessions after Phase 2. **Risk:** low. The script has no write
path, which is most of the risk removed by construction.

---

## Phase 5 — adversarial review pass on generated documents

**Gap.** Grepping `reviewer|critique|adversarial|second agent` across `modes/`
returns only `offer-prep.md` and `regional/eu-swe.md` in unrelated senses.
`verify-cv-facts.mjs` is a stronger fabrication guard than anything in the
source repo, but a fabrication guard and a quality critic answer different
questions. The first asks whether every claim is backed. The second asks
whether the framing is generic, whether posting keywords were missed, and
whether the opening paragraph could have been written for any employer.

### Placement — the architectural constraint

`modes/oferta.md:35` states: *"Do not spawn subagents or delegate research to
another agent."* Evaluation runs under a bounded research budget and the
reviewer must not violate it.

So the reviewer belongs in the **generation** modes, `modes/pdf.md` and
`modes/cover.md`, and never in evaluation. It runs:

1. after `verify-cv-facts.mjs` passes, never before, so the critic never
   argues for a claim the fact gate would reject
2. opt-in, with the token cost stated in the mode file
3. under an explicit instruction that it may cut, reframe, and reorder, and may
   never introduce a claim absent from the in-scope files

That last line is the whole safety argument. A critic that can add text is a
fabrication channel with a friendly name.

**Effort:** one session, prose only. **Risk:** low, opt-in.

---

## Phase 6 — say what to cut when the CV overflows

**Gap.** `modes/pdf.md:39` warns on overflow with unspecified "trimming
guidance". `generate-pdf.mjs:274` holds the message.

**Change.** Specify the cut rule in both places: score each candidate line by
relevance to the target posting, uniqueness in the document, and whether the
cover letter depends on it, then cut the lowest total first. The consequence is
that an older-role bullet hitting posting keywords survives ahead of a recent
bullet that does not, which is the opposite of what a chronological trim does.

**Effort:** under an hour. **Risk:** none. Do this one first as a warm-up.

---

## Phase 7 — new job sources, folded into the existing plan

This phase does not stand alone. `docs/JOB-DATA-SOURCES-PLAN.md:334` already
governs new boards:

> No work starts on any row until a live zero-auth probe returns 200 with a
> usable payload.

Add rows to that document's Phase 6 table rather than starting a parallel
process.

| Board | Market gap | Note |
|---|---|---|
| `freehire.me` | Multi-market tech aggregator, roughly 50 ATS platforms normalized into one schema | Public JSON, no key, full descriptions in the list payload, so it stays zero-token. Backend is MIT and self-hostable. **Unprobed** |
| Jobindex, Jobnet, Jobdanmark, Akademikernes Jobbank | `modes/da/` ships with no Danish national provider. `providers/thehub.mjs` covers Nordic startups only | Jobnet is the government portal and is the one most likely to expose an official API. **Unprobed** |

When a probe passes, implement to the existing contract in
`providers/README.md`: default export, unique `id` matching the filename,
explicit-only `detect()` for a board-wide feed, `fetch(entry, ctx)` through the
injected `ctx.fetchJson`, `description` populated only if the list payload
carries it for free, host allowlist plus `redirect: 'error'` before any request.
`tests/providers/<name>.test.mjs` is auto-discovered, and
`tests/providers/_contract.test.mjs` covers the new file with no registration.
One row in `docs/SUPPORTED_JOB_BOARDS.md` in the same change.

**One extra security note for `freehire.me`:** the skill in the source repo
honors a `FREEHIRE_API_URL` override. If Jobber keeps that, validate it as
`http:` or `https:`, keep `redirect: 'error'`, and document that pointing it at
a private host is the user's own decision. An unvalidated base-URL env var is
an SSRF primitive handed to anything that can set the environment.

**Effort:** one session per board after a passing probe. **Risk:** low, isolated
by the provider contract.

---

## Phase 8 — supply-chain guard parity

Their `tools/security_guards.py` rejects `npm` and `bun` lifecycle scripts
(`preinstall`, `install`, `postinstall`, `prepare`, `prepack`) and
`trustedDependencies` in shipped manifests, and rejects `.gitignore` negations
that would re-include personal data.

Jobber's overlap: `plugin-audit.mjs` scans community plugins for forbidden APIs,
and `test-all.mjs:1126` asserts user files stay untracked. Neither checks
lifecycle scripts, and grepping `postinstall|preinstall|lifecycle` in
`plugin-audit.mjs` and `plugin-install.mjs` returns nothing.

**Change.** Extend `plugin-audit.mjs` with a manifest check, and add a
`.gitignore` negation guard to `test-all.mjs`. Both are a few lines inside
existing files, so no new registration.

This matters only if a plugin ever ships a `package.json`. Priority accordingly.

**Effort:** under a session. **Risk:** none.

---

## Ordering

```
6 (trim rule, warm-up)
└─► 1 (robots gate)          independent
└─► 3 (language gate)        independent
└─► 2 (PDF text layer) ──► 4 (documents ingestion)
└─► 5 (reviewer pass)        after 2 lands, so the critic reads a verified PDF
└─► 7 (providers)            gated on live probes, any time
└─► 8 (supply chain)         any time
```

Phases 1, 3, 6, 7, and 8 are independent and can land in any order. Phase 4
depends on Phase 2 for its PDF decoder. Phase 5 is prose but reads better after
Phase 2 gives the reviewer a verified artifact.

## Per-change registration checklist

Every new root-level or `lib/` script must satisfy all of these, or CI fails:

1. `// @ts-check` present, then `node validate-typecheck-coverage.mjs --bless`
2. Path added to `SYSTEM_PATHS` in `update-system.mjs`. `lib/` entries are
   listed file by file, not as a directory
3. `node validate-system-paths-coverage.mjs` clean
4. Runnable scripts: a row in `docs/SCRIPTS.md`, and in the `AGENTS.md` table if
   an agent invokes it
5. Any script a mode calls with flags exposes `--capabilities` and lists them,
   or `validate-mode-invocations.mjs` rejects the mode edit
6. Tests land as `*.test.mjs` and are auto-discovered. No registration
7. `npm run lint`, `npm run check:types`, `npm run knip`, `node test-runner.mjs`

## Cross-cutting security summary

| Risk | Where it appears | Control |
|---|---|---|
| SSRF | Phase 1 robots fetch, Phase 7 base-URL override | Rebuild URL from parsed parts, `http`/`https` only, same-host redirects only, host allowlist per the provider convention |
| ReDoS | Phase 1 pattern matching | Escape every character, allow only `*` and `$` as metacharacters |
| Decompression bomb | Phases 2 and 4 | Hard cap on inflated bytes, abort rather than allocate |
| Path traversal | Phase 2 dump path, Phase 4 ingestion | Resolve, then contain. Resolve symlinks before the check |
| Prompt injection | Phase 4 ingested documents | Document text is data, never instructions. State it in the mode file in the same words used for job descriptions |
| Fabrication | Phase 5 reviewer | The critic may cut, reframe, reorder. It may never add a claim absent from the in-scope files |
| Silent fail-open | Phase 1 | Unconfirmed blocks the escalation. Every fail-open case has a test that fails without its fix |
| Layer violation | Phases 3 and 4 | New data is user layer, gitignored, in `USER_PATHS`. `updater-migration-tests.mjs` enforces it |

## Evidence and gaps in this plan

Verified by reading the files named: the robots gap, the missing text-layer
check, the missing reviewer pass, the missing declared-languages table, the
onboarding paths, `providers/` contract and transport, `SYSTEM_PATHS` shape,
CI guard behavior, and the existing job-data-sources plan.

Not verified: the source repo's `/apply` and `/rank` command bodies were not
read in full, so the reviewer-pass and trimming-rule descriptions in Phases 5
and 6 come from that repo's README rather than from its command files. Neither
phase depends on their implementation, since both land as Jobber prose, but the
attribution should stay honest. No `freehire.me` or Danish-board endpoint has
been probed, so Phase 7 has no evidence yet by design.
