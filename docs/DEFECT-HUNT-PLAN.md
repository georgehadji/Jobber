# Defect-Hunt Execution Plan — V7 Protocol Applied to Jobber

Sequential application of the **Autonomous Defect-Hunt Protocol V7 (Proactive)** across the whole Jobber codebase.

The protocol is designed for one bounded scope per run. Jobber is 98,283 lines of tracked `.mjs` across 390 files, plus 36 Go files and 128 TypeScript/TSX files under `web/`. One run cannot cover that and stay honest — Phase 0 explicitly requires a bounded surface, and Phase 8 requires a coverage statement scoped to what was actually audited. So this plan partitions the codebase into **10 sequential batches**, each of which is one complete, self-contained V7 run with its own Phase 0 through Phase 8.

Status: **not started**. This document is the plan only.

---

## 0. Measured baseline (evidence for the partition)

All figures below come from executed commands, not estimation.

```bash
node --version                                  # v24.14.0
git ls-files '*.mjs' | wc -l                    # 390
git ls-files '*.mjs' | xargs wc -l | tail -1    # 98283 total
git ls-files '*.go' | wc -l                     # 36
git ls-files 'web/*' | grep -cE '\.tsx?$'       # 128
```

Tracked `.mjs` by directory:

| Location | Files |
|---|---|
| `tests/` | 147 |
| `providers/` | 78 |
| repo root | ~130 |
| `lib/` | 17 |
| `plugins/` | 12 |
| `web/`, `test/`, `scaffolder/`, `seeds/`, `batch/`, `utils/` | 15 |

Ten largest root modules by line count (`wc -l *.mjs | sort -rn`):

```
4106 test-all.mjs
2639 scan.mjs
1386 update-system.mjs
1174 analyze-patterns.mjs
 997 scan-ats-full.mjs
 946 merge-tracker.mjs
 902 discover-ats.mjs
 874 build-cv-html.mjs
 857 company-history.mjs
 853 openrouter-runner.mjs
```

---

## 1. Global Phase 0 constants (identical in every batch)

Every batch run repeats its own Phase 0, but these values are fixed and can be pasted verbatim rather than re-derived:

```
Language:       JavaScript (ESM, .mjs) — plus Go and TypeScript in batches 9-10
Runtime:        Node.js v24.14.0   (package.json engines: ">=18")
Framework(s):   none (no web framework in core). Deps: js-yaml 4.1.1,
                playwright 1.62.0, dotenv 17.0.0, @google/generative-ai 0.24.1
Test framework: bespoke assert-based harness — tests/*.test.mjs discovered by
                lib/test-discovery.mjs, counters shared via tests/helpers.mjs.
                Canonical runner: `node test-all.mjs --quick`
                Per-file attribution: `node test-runner.mjs --parallel 4`
                NOT pytest. Phase 7 output must target this harness.
Entry point(s): every root *.mjs is its own CLI entry point (see package.json
                "scripts", 60+ entries). Additionally: agent-driven mode
                invocation from modes/*.md, and the Go dashboard at dashboard/.
Build/lockfile: package-lock.json is gitignored at root (tracked only for web/).
                Deps are pinned exact in package.json for the 4 runtime deps.
```

### Invariants (repo-documented — cite these, do not re-derive)

These are written down in `AGENTS.md` and `DATA_CONTRACT.md` and count as **documented invariants** for Phase 3a. A defect that only fires when one of these is violated is a caller defect, not a defect of the audited code — Phase 3b must reclassify it.

1. **Layer separation.** User-layer files (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `data/*`, `reports/*`, `output/*`, `interview-prep/*`, `portals.yml`, `article-digest.md`) are never auto-updated. System-layer files never hold user data.
2. **Source-of-truth boundary.** User-facing content is generated only from `cv.md`, `article-digest.md`, `config/profile.yml`, `modes/_profile.md`, `writing-samples/`, `interview-prep/*`, plus direct conversation statements. Keywords get reformulated, never fabricated.
3. **Tracker write path.** New rows enter only via TSV in `batch/tracker-additions/` merged by `merge-tracker.mjs`. Status updates go only through `set-status.mjs`. `data/applications.md` is never hand-edited to add rows.
4. **Canonical states.** Every status value must appear in `templates/states.yml`.
5. **Report numbering.** Sequential 3-digit zero-padded; parallel fan-outs reserve ranges via `reserve-report-num.mjs`, never compute `max+1` independently (this is the #749 race).
6. **TSV column order.** 9 tab-separated columns, status *before* score in TSV, score before status in `applications.md`; `merge-tracker.mjs` performs the swap.
7. **Never submit.** No code path may submit, send, or click Apply on the user's behalf.

### Threat model — ranked for Jobber specifically

The default V7 taxonomy is pruned and reordered to match what actually costs the user something here. This ranking drives batch order in §2 and severity assignment in Phase 2.

| Rank | Class | Why it matters here | Primary surface |
|---|---|---|---|
| T1 | **User-data loss / corruption** | `data/applications.md` is the user's entire job-search history; a bad merge or a lost lock destroys unrecoverable state | tracker writers, locks, updater |
| T2 | **Layer-boundary violation** | Auto-updater overwriting a user-layer file silently discards personalization | `update-system.mjs`, `SYSTEM_PATHS`/`USER_PATHS` |
| T3 | **Fabrication in user-facing output** | A CV or cover letter asserting something the user never did is a reputational, not a technical, failure | CV/cover/report generation |
| T4 | **Untrusted external input** | 78 providers parse third-party ATS JSON/HTML; plugins execute third-party code | `providers/*`, `plugins/*`, scanners |
| T5 | **PII / secret leak** | Repo is public; `contacts.tsv`, `documents/`, `data/` hold real names and scans | `.gitignore` correctness, archive/outcome paths |
| T6 | **Silent wrong result** | A wrong score or wrong funnel stat misdirects the search without ever crashing | analytics, scoring, matchers |
| T7 | **Resource lifecycle** | Playwright browsers, file handles, lock files, HTTP sockets leaked on error paths | scanners, PDF generation, locks |
| T8 | **Crash / degradation** | Lowest rank: a crash is loud and recoverable | everywhere |

Severity ladder for Phase 2, per the protocol's "rank per threat model":
**CRITICAL** = T1/T2/T5 realized · **HIGH** = T3/T4 realized, or T1 reachable-but-guarded · **MEDIUM** = T6/T7 · **LOW** = T8 or unreachable-region findings.

### Out of scope for every batch (with reason)

| Excluded | Reason |
|---|---|
| `node_modules/` | third-party, not ours to fix |
| `.tmp-script-test-*/`, `output/`, `batch/logs/` | **stale copies of real source**; a grep across them yields phantom findings against code that no longer exists. Delete before starting (see §5). |
| `Github Projects/` | local reference clones of other people's repos |
| `data/*`, `reports/*`, `cv.md`, `config/profile.yml`, `portals.yml` | user layer — read-only during a hunt, never modified by a fix |
| `test-fixtures/**` | fictional fixture data, intentionally malformed in places |
| `modes/*.md`, `docs/*.md` | prose, not executable; behavioral defects there are a separate review |

---

## 2. Batch partition and execution order

Ordered by `blast_radius × threat_rank`, so the highest-cost classes are audited while the budget is fresh. Each row is one full V7 run.

| # | Batch | Modules | ~LOC | Primary threat | Budget |
|---|---|---|---|---|---|
| 1 | **Tracker & lock core** | `tracker.mjs`, `tracker-parse.mjs`, `tracker-utils.mjs`, `tracker-links.mjs`, `merge-tracker.mjs`, `set-status.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`, `outcome.mjs`, `add-entry.mjs`, `reserve-report-num.mjs`, `reconcile-pipeline.mjs`, `verify-pipeline.mjs`, `fix-slugs.mjs`, `sync-pdf-flags.mjs`, `lib/file-lock.mjs`, `pipeline-lock.mjs`, `portal-health-lock.mjs` | ~4,500 | T1, T7 | 12 candidates |
| 2 | **Updater & layer boundary** | `update-system.mjs`, `updater-migration-tests.mjs`, `doctor.mjs`, `stamp-translations.mjs`, `check-translation-freshness.mjs`, `sunset.mjs`, `lib/sunset-policy.mjs`, `ingest-documents.mjs`, `.gitignore` negation logic in `test-all.mjs` | ~3,000 | T2, T5 | 10 candidates |
| 3 | **Plugin trust boundary** | `plugins.mjs`, `plugin-install.mjs`, `plugin-audit.mjs`, `plugins/_engine.mjs`, `plugins/_lock.mjs`, `plugins/_net.mjs`, `plugins/_registry.mjs`, `plugins/{apify,gmail,notion}/*`, `plugins/_template/*`, `validate-plugin-registry.mjs` | ~2,500 | T4, T5 | 10 candidates |
| 4 | **Provider HTTP core** | `providers/_http.mjs`, `_dns-cache.mjs`, `_trust-validator.mjs`, `_registry.mjs`, `_config-utils.mjs`, `_html-entities.mjs`, `_profile-keywords.mjs`, `local-parser.mjs`, `lib/robots.mjs`, `lib/http-errors.mjs` | ~1,800 | T4, T7 | 12 candidates |
| 5 | **Provider fleet** (70 adapters) | `providers/*.mjs` minus the `_`-prefixed infra from batch 4 | ~11,000 | T4, T6 | 15 candidates, **class-sampled** — see §4 |
| 6 | **Scanners & liveness** | `scan.mjs`, `scan-ats-full.mjs`, `scan-interamt.mjs`, `discover-ats.mjs`, `verify-portals.mjs`, `validate-portals.mjs`, `provider-health.mjs`, `check-liveness.mjs`, `liveness-core.mjs`, `liveness-api.mjs`, `liveness-browser.mjs`, `browser-extract.mjs` | ~6,500 | T4, T7 | 12 candidates |
| 7 | **Content generation** | `build-cv-html.mjs`, `build-cv-latex.mjs`, `build-cv-plaintext.mjs`, `cv-sections-core.mjs`, `cv-templates.mjs`, `generate-pdf.mjs`, `generate-latex.mjs`, `generate-cover-letter.mjs`, `img-to-pdf.mjs`, `theme-style.mjs`, `extract-latex-content.mjs`, `patch-latex-content.mjs`, `verify-cv-facts.mjs`, `cv-sync-check.mjs`, `build-dashboard.mjs`, `lib/pdf-text.mjs`, `lib/latex-content.mjs`, `lib/latex-escape.mjs`, `lib/cv-plaintext.mjs` | ~5,500 | T3, T7 | 12 candidates |
| 8 | **LLM runners & analytics** | `openrouter-runner.mjs`, `gemini-eval.mjs`, `openai-eval.mjs`, `openai-tailor.mjs`, `ollama-eval.mjs`, `eval-golden.mjs`, `eval-runner.mjs`, `batch-tailor.mjs`, `batch/aggregate-tokens.mjs`, `lib/llm-providers.mjs`, `lib/token-tracker.mjs`, `utils/token-tracker.mjs`, `lib/context-budget.mjs`, `lib/golden-budget-analysis.mjs`, `analyze-patterns.mjs`, `upskill.mjs`, `stats.mjs`, `funnel-velocity.mjs`, `followup-cadence.mjs`, `followup-seed.mjs`, `detect-reposts.mjs`, `salary-gap.mjs`, `salary-import.mjs`, `company-history.mjs`, `company-intel.mjs`, `process-quality.mjs`, `jd-similarity.mjs`, `jd-skill-gap.mjs`, `assessment-log.mjs`, `contacts.mjs`, `check-table-freshness.mjs`, `invite-match.mjs`, `reply-watch.mjs`, `reply-matcher.mjs`, `paste-reply.mjs`, `match-star.mjs`, `role-matcher.mjs`, `classify-tier.mjs`, `fingerprint-core.mjs`, `find.mjs`, `lib/report-schema.mjs`, `lib/score-summary.mjs`, `validate-report.mjs` | ~12,000 | T6, T5 | 15 candidates |
| 9 | **Go dashboard** | `dashboard/*.go` (36 files) | — | T6, T8 | 8 candidates |
| 10 | **Web UI** | `web/src/**/*.{ts,tsx}` (128 files) | — | T4, T8 | 10 candidates |

**Deliberately excluded from all batches: the test harness itself** (`test-all.mjs`, `test-runner.mjs`, `lib/test-discovery.mjs`, `tests/**`, `validate-*.mjs`, 147 test files, ~19,000 lines). Reason: it is the measuring instrument for every other batch. Auditing and modifying it mid-hunt invalidates every prior batch's Phase 3 and Phase 7 evidence. Schedule it as **batch 11**, after all others complete, as a standalone run with a clean baseline.

Total planned candidate budget: **116 investigated candidates** across 10 batches. That is the `budget_spent` ceiling; reaching it in a batch stops that batch and emits a PARTIAL coverage statement, per Phase 8.

---

## 3. Per-batch execution loop

Run this identically for every batch. `N` = batch number.

### 3.1 Pre-flight (before Phase 0)

```bash
git checkout main && git pull
git checkout -b hunt/batch-N-<slug>
node test-all.mjs --quick 2>&1 | tail -20
```

The pre-flight suite result is the **green baseline**. Record the pass/fail/warn counts in the batch record. Any Phase 7 test added later must leave those counts intact except for its own additions. If the baseline is not green, stop — a hunt against an already-red suite cannot distinguish a found defect from a pre-existing one.

### 3.2 Phase 0 — census and scope

Paste the §1 global constants. Then declare only the batch-specific fields:

```
In-scope surface:  [the module list from the §2 row, expanded to real paths]
Out-of-scope:      [§1 global exclusions] + [any module deferred to a later batch]
Audit budget:      [the §2 budget]   → counter: budget_spent = 0
Termination:       budget exhausted OR Phase 1 surface map fully triaged
Threat model:      [the T-ranks named in the §2 row, with the §1 severity ladder]
Defect taxonomy:   [prune the V7 default catalogue to the classes those T-ranks imply]
```

Blocking condition applies as written: if a module in the batch cannot be read, emit `[BLOCKED]` and do not proceed.

### 3.3 Phase 1 — defect-surface map

Enumerate regions at **function granularity**, not file granularity — a 900-line module is not one region. Target 15-40 regions per batch.

Reachability tagging uses real entry points, and Jobber has three kinds:

- **CLI** — `node <script>.mjs [flags]`, the `package.json` scripts. Reachable, user-controlled argv.
- **Module import** — another `.mjs` importing an export. Reachable, caller-controlled args.
- **Agent-driven** — a `modes/*.md` instructs an agent to run the script. Reachable, but the arguments come from an LLM reading a job description, so treat inputs as **semi-trusted at best**: a malicious JD can influence them.

That third category matters and is easy to miss. A function whose only caller is an agent following `modes/apply.md` is still `REACHABLE`, and its inputs are still attacker-influenceable via a crafted job posting.

Emit the required ≥3 map-level atomic assertions with `[VF]`/`[HYP]`/`[UNK]` tags, then the ordered hunt queue.

### 3.4 Phase 2 — suspicion generation

Standard V7. Two repo-specific constraints:

- **The `innocence path` field is mandatory and must be filled before any trigger test is written.** Jobber's modules are dense with intentional guards (`looksLikeScoreCell`, `REQ_NUMBER_RE`, `assertContained`, the `allowedSystemUserOverlap` allowlist). Guessing "unguarded" without looking is how a false positive gets promoted.
- **Consult the ledger first** (§4). Do not regenerate a candidate already recorded as `FALSE (innocent)` in a prior batch.

### 3.5 Phase 3 — proof-of-defect

Trigger tests are **executable Node scripts written to the scratchpad**, not to the repo:

```
C:\Users\tesse\AppData\Local\Temp\claude\E--Documents-Vibe-Coding-Jobber\<session>\scratchpad\
```

Pattern that already worked in this repo (the confirmed `lib/robots.mjs` cache defect, §6):

```js
import { gate, _clearCacheForTests } from 'file:///E:/Documents/Vibe-Coding/Jobber/lib/robots.mjs';
// ... construct the triggering condition, assert the property violation,
// print an explicit DEFECT CONFIRMED / no defect line, set process.exitCode
```

Rules:

- A trigger test that touches the filesystem writes to a **temp directory it creates and removes**. It never writes to `data/`, `reports/`, `output/`, or any tracked file. Verify with `git status --porcelain` after every trigger run — a non-empty result means the trigger test itself is defective.
- A trigger test that needs the network **must not make a real request.** Inject a fake `fetchText`/`fetch` the way `lib/robots.mjs`'s `gate(url, {fetchText})` seam allows. If a module has no injection seam, that absence is itself a finding (testability defect, severity LOW) — record it and route the candidate to `UNKNOWN`.
- Lock and concurrency candidates (batch 1) require the repeated-trial harness: N ≥ 100 interleavings, result labeled `STATISTICAL(rate)`, never `[VF]` from a single run.

### 3.6 Phase 4 — inventory

Produce the table. Append every row — `VERIFIED`, `FALSE`, and `UNKNOWN` alike — to the persistent ledger (§4). The `FALSE` rows are the ones that make a later batch cheaper.

### 3.7 Phase 5-7 — fix, self-review, tests

Constraints as written (≤15 lines, ≤1 function). Repo-specific additions:

- **A fix may never modify a user-layer file.** If the correct fix requires changing `data/`, `config/profile.yml`, or any USER_PATHS entry, that is `[REQUIRES HUMAN REVIEW: user-layer change]` unconditionally.
- **A fix that adds a `SYSTEM_PATHS` entry overlapping a `USER_PATHS` prefix must also add the corresponding `allowedSystemUserOverlap` entry** in `updater-migration-tests.mjs`, or the migration guard fails. That coupling is by design; it is not a workaround.
- **Phase 7 tests go in `tests/<module>.test.mjs`** using the existing helper style, discovered automatically by `lib/test-discovery.mjs`. Not pytest. Not a new framework. If the module already has a test file, extend it.
- **Sandboxed tests must copy their new dependencies.** Several tests (`tests/generate-pdf-page-budget.test.mjs`) build an isolated sandbox by copying specific files. Adding a top-level import to an audited module breaks them silently. Check for a sandbox test before adding any import.

Required per fix:

```bash
node test-runner.mjs                       # per-file attribution, fast
node test-all.mjs --quick                  # canonical, must match baseline + new
git diff --stat                            # confirm scope matches the claimed ≤15 lines
```

### 3.8 Phase 8 — verdict and commit

Emit the full coverage statement. Then:

```bash
git add <only the audited files and their tests>
git commit -m "fix(<area>): <defect> — batch N/D<n>"
```

One commit per verified defect, never one commit per batch. A batch that finds 4 defects produces 4 reviewable commits. Blanket `git add -A` is forbidden — this working tree routinely carries unrelated in-flight work.

Open a PR per batch. CI must go green before starting batch N+1.

---

## 4. Cross-batch state: the ledger

The protocol's "do not regenerate innocence-cleared candidates" rule needs memory that survives a session reset. One file, appended never rewritten:

**`docs/DEFECT-HUNT-LEDGER.md`**

```markdown
## Batch N — <name> — <date> — <PARTIAL|COMPLETE>
Baseline: <pass>/<fail>/<warn> from test-all.mjs --quick
Budget: <spent>/<allocated>

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B1-D1 | lib/x.mjs:42 fn() | boundary | ... | FIRED | NO-DEFENSE | VERIFIED | abc1234 |
| B1-D2 | lib/y.mjs:88 fn() | resource | ... | DID-NOT-FIRE | CODE-INNOCENT | FALSE | — |
| B1-D3 | lib/z.mjs:12 fn() | concurrency | ... | — | — | UNKNOWN | needs runtime |

Coverage: regions [...] audited for classes [...]
Not audited: [...]
Highest-value next hunt: [...]
```

Rules: IDs are `B<batch>-D<n>`, globally unique, never reused. `FALSE` rows are permanent — a later batch that rediscovers the same location must cite the ledger row and move on rather than re-running the trigger. `UNKNOWN` rows accumulate into the final runtime-instrumentation backlog.

### Class-sampling for batch 5 (70 provider adapters)

Batch 5 cannot audit 70 files at 15 candidates. It audits **defect classes across the fleet**, not every instance:

1. Pick one adapter per structural family (Greenhouse-shaped JSON, Lever-shaped, Ashby GraphQL, HTML-scraped, RSS, custom).
2. Hunt that representative fully.
3. For each confirmed defect, `grep` the same pattern across the other 69 and record every hit in the ledger as an **instance of a known class**, not as a new candidate.
4. The Phase 8 clean-claim is explicitly `"class C was hunted across the fleet; N instances found"`, never `"the fleet is clean"`.

This is the protocol's own coverage rule ("completeness in proactive mode is over defect classes examined, not over all possible defect instances") applied literally.

---

## 5. Pre-flight cleanup (do once, before batch 1)

The working tree currently holds stale copies of source files that will produce phantom findings. Confirmed present:

```
.tmp-script-test-7Svay5/          # full copy of ~30 root modules
.tmp-script-test-CRkSwF/          # nested second copy
output/ingest-documents-test-*/   # 4 dirs, each with a copy of lib/pdf-text.mjs
output/text-layer-test-*/         # 2 dirs, each with copies of generate-pdf.mjs, theme-style.mjs
```

These are gitignored scratch left by interrupted test runs. A `grep -r` across the repo hits them and reports defects in code that is not the real code. Remove before starting:

```bash
rm -rf .tmp-script-test-* output/ingest-documents-test-* output/text-layer-test-*
git status --porcelain          # must be clean or show only intended work
```

Also confirm no scratch remains from a prior batch between runs — the same cleanup belongs in every batch's pre-flight.

---

## 6. Known seeds — start the ledger non-empty

Two findings already exist with real evidence. Seed them so batch 1 and batch 4 do not spend budget rediscovering them.

### Seed A — `lib/robots.mjs` origin-keyed cache conflates paths `[VF]` — batch 4

**Confirmed by executed trigger test**, not reasoning.

`gate()` caches a per-*path* verdict `{allowed, reason}` in a module-level `Map` keyed only by origin (`${protocol}//${host}`, 15-minute TTL). A second call for the same origin with a different path returns the first path's verdict without re-evaluating.

Trigger (scratchpad `d1-trigger.mjs`, already written and run):

```js
_clearCacheForTests();
const robotsTxt = 'User-agent: *\nDisallow: /admin\n';
const r1 = await gate('https://example.invalid/careers',        { fetchText: async () => robotsTxt });
let secondFetchCalled = false;
const r2 = await gate('https://example.invalid/admin/secret-panel',
                      { fetchText: async () => { secondFetchCalled = true; return robotsTxt; } });
```

Observed: `r2.allowed === true` and `secondFetchCalled === false` — `/admin/secret-panel` was allowed despite an explicit `Disallow: /admin`.

Property violated: RFC 9309 path-specificity matching. Status: **VERIFIED, unfixed.** Correct shape is to cache the *parsed groups* per origin and evaluate `isAllowed()` per call, not to cache the verdict.

Reachability, measured `[VF]`:

```bash
git grep -ln "lib/robots" -- '*.mjs'
# lib/robots.mjs
# tests/robots.test.mjs
# update-system.mjs
git grep -n "robots" -- update-system.mjs
# update-system.mjs:147:  'lib/robots.mjs',      ← SYSTEM_PATHS manifest entry, not an import
```

`gate()` has **no production caller** — only its own test file. Severity is therefore **LOW today, HIGH the moment it is wired** into `providers/_http.mjs`'s escalation path as originally intended. Per the protocol, an unreachable defect is a low-severity finding, not a non-finding. Fix it before connecting it, not after.

### Seed B — shallow-checkout class `[VF]` — batch 2, already fixed

`stamp-translations.mjs` and `check-translation-freshness.mjs` derive per-file freshness from `git log -1 --format=%H -- <file>`. Under `actions/checkout@v7` with the default depth-1 clone, that walk sees only the merge commit and reports every translated file stale. Fixed in `b74af31` by adding `fetch-depth: 0` to three jobs in `.github/workflows/test.yml`; comment recorded at `.github/workflows/test.yml:29-37`.

Recorded not as open work but as a **class to hunt in batch 2**: any other module deriving state from `git log`, `git rev-list`, or `git describe` carries the same shallow-clone assumption. Grep for it.

---

## 7. Guardrails (non-negotiable across every batch)

1. **Never modify a user-layer file.** Read-only. A hunt that alters `data/applications.md` has destroyed the thing it was protecting.
2. **Never `git add -A`.** Stage explicitly, file by file.
3. **Never let a trigger test hit the real network or a real ATS endpoint.** Inject the seam or mark the candidate `UNKNOWN`.
4. **Never claim a fix works without fresh executed output.** A reasoned "FIX HOLDS" is `[HYP]` per Phase 6 and must be promoted by a passing test in Phase 7 or downgraded to CANNOT DETERMINE.
5. **Never verify a new safety check only green.** Revert the fix, confirm the new test goes red, restore. A check that passes both with and without the fix tests nothing.
6. **Flagging correct code is as severe as missing a bug.** The Phase 3b innocence attempt is mandatory and adversarial — argue *for* the code before condemning it.
7. **A partial batch is a valid result.** Budget exhaustion produces an honest PARTIAL coverage statement, not an extended run.

---

## 8. Execution schedule

| Order | Batch | Gate to proceed |
|---|---|---|
| 1 | Pre-flight cleanup (§5) | `git status --porcelain` clean |
| 2 | Batch 1 — tracker & locks | PR green |
| 3 | Batch 2 — updater & layer boundary | PR green |
| 4 | Batch 3 — plugin trust boundary | PR green |
| 5 | Batch 4 — provider HTTP core (resolves Seed A) | PR green |
| 6 | Batch 5 — provider fleet (class-sampled) | PR green |
| 7 | Batch 6 — scanners & liveness | PR green |
| 8 | Batch 7 — content generation | PR green |
| 9 | Batch 8 — LLM runners & analytics | PR green |
| 10 | Batch 9 — Go dashboard | PR green |
| 11 | Batch 10 — web UI | PR green |
| 12 | Batch 11 — test harness (deferred by design) | final |

Each batch is independently resumable: the ledger plus the batch branch is the complete state. A session reset between batches loses nothing.

---

## 9. Final deliverable

After batch 11, aggregate into a single coverage statement:

- Confirmed defects by severity, with commit SHAs
- Cleared candidates (the false-positive record — proof of coverage, not wasted work)
- Residual `UNKNOWN` set → the runtime-instrumentation backlog
- Defect classes covered per batch
- Clean-claim, scoped exactly: *"Regions [...] were audited for classes [...] and no VERIFIED defect was found"* — never *"the codebase is bug-free"*

Absence of found defects in an audited region is `[UNK]` about the unaudited remainder. It is never `[VF]` of correctness.
