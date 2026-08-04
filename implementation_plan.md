# Jobber Optimization & Architecture Hardening Plan

> **Source:** Architecture Audit (ARCH-AUDIT-V2) + Post-HARDEN Code Review
> **Date:** 2026-08-04
> **Scope:** 5 optimization tracks (3 MEDIUM severity, 2 LOW severity)
> **Baseline:** 1337 tests passing, 7/10 architecture score, Early Production maturity

---

## 1. Executive Summary

The architecture audit scored Jobber at **7/10** — Early Production maturity with a coherent prompt-driven pipeline design and no critical violations. Five optimization tracks were identified: three address MEDIUM-severity structural tensions (eval script duplication, test infrastructure, mode-translation drift) and two address LOW-severity hardening gaps (mode↔script contract, reader-writer consistency).

This plan covers all five tracks with dependency-aware sequencing, detailed task breakdowns, and risk assessments. The total estimated effort is **~8–12 development days** spread across 4 sprints.

**What we'll implement:**

| # | Track | Severity | Effort | Impact | Sprint |
|---|-------|----------|--------|--------|--------|
| 1 | Test Runner — extract from `test-all.mjs` monolith | MEDIUM | Medium | High | Sprint 1 |
| 2 | Translation SHA Stamping — freshness tracking for 105 mode files | MEDIUM | Medium | High | Sprint 1 |
| 3 | Eval Pipeline Consolidation — shared `eval-runner.mjs` | MEDIUM | High | High | Sprint 2 |
| 4 | Mode↔Script Contract — machine-readable schemas | LOW | High | Medium | Sprint 3 |
| 5 | Reader-Writer Consistency — lock-aware stats reads | LOW | Low | Low | Sprint 4 |

**Risk level:** Low-Medium — all changes are additive or refactoring; the test runner and translation stamping are low-risk; eval consolidation touches 3 user-facing CLI tools and requires careful output-format preservation.

---

## 2. Current State Assessment

### 2.1 What's Already Hardened

The HARDEN cycle and audit refinements resolved 12 fragility issues (CI gates, mode↔script validation, provider health, sentinel GC dedup, path-traversal guard, etc.). The system now has:

- CI gates for translation freshness (README), mode↔script invocation, and daily provider health
- `--help` handlers on 5 top scripts
- Pre-merge validation + `--strict`/`--summary` on merge-tracker
- Shared sentinel GC (tracker-utils)
- Direct cache read in `--health-check`
- 11 validator unit tests covering extraction + path traversal

### 2.2 Remaining Structural Tensions

| Tension | Evidence | Impact if unaddressed |
|---------|----------|----------------------|
| **Eval duplication** | `gemini-eval.mjs` (482), `ollama-eval.mjs` (395), `openai-eval.mjs` (450) share ~70% logic — ~900 duplicated lines across 3 files | Each scoring change must be replicated 3×; a bugfix in one may persist in others |
| **Test monolith** | `test-all.mjs` is 12,475 lines; 108 individual `*.test.mjs` files are concatenated | No parallelization, no test discovery, failure localization is grep-level |
| **Mode-translation drift** | 21 language dirs duplicate ~105 mode files with no SHA stamps; `check-translation-freshness.mjs` covers READMEs only | When `oferta.md` changes, all translated `angebot.md`/`offre.md`/`fursah.md` files silently go stale |
| **Mode↔script hardcoded coupling** | 315 literal `node <script>.mjs <flags>` strings in mode files; no machine-readable contract | A script CLI change silently breaks every mode that references it (mitigated by validator, not prevented) |
| **Reader-writer gap** | ~10 scripts mutate `applications.md` under lock; `stats.mjs`/`analyze-patterns.mjs` read without lock | A reader running concurrent with a merge could see an inconsistent file |

### 2.3 Dependency Graph of Tracks

```
Sprint 1 (parallel)
├── Track 1: Test Runner           ← no dependencies (additive)
└── Track 2: Translation Stamping  ← no dependencies (additive)

Sprint 2 (sequential — depends on fast CI from Track 1)
└── Track 3: Eval Consolidation    ← benefits from Track 1 (faster CI feedback)

Sprint 3
└── Track 4: Mode↔Script Contract  ← builds on validate-mode-invocations.mjs

Sprint 4
└── Track 5: Reader-Writer         ← independent, lowest priority
```

---

## 3. Detailed Implementation Plan

### Track 1: Test Runner — Extract from `test-all.mjs` Monolith

**Objective:** Replace the 12,475-line monolithic test bundle with a `test-runner.mjs` that auto-discovers `tests/**/*.test.mjs` files and runs each in isolation. Enable parallel execution and faster failure localization.

**Current state:**
- 108 individual `*.test.mjs` files under `tests/`, each using `pass()`/`fail()`/`finish()` from `tests/helpers.mjs`
- `test-all.mjs` concatenates them into one file and runs the whole thing
- CI runs `node test-all.mjs --quick` (3 OS matrix, ~6–7 min per leg)
- `tests/helpers.mjs` provides the assertion harness (counter-based, no framework)

**Design:**

```
test-runner.mjs
├── Discover all tests/**/*.test.mjs files
├── For each file:
│   ├── Spawn `node <file>` as a child process
│   ├── Collect stdout (pass/fail counters) and exit code
│   └── Aggregate results
├── Output:
│   ├── Per-file: pass/fail/warnings + timing
│   └── Total: aggregate counters
├── --parallel N: run N workers simultaneously (worker_threads or child_process pool)
├── --quick: skip slow tests (passes --quick to each process)
├── --ci: JSON output for CI annotations
└── Compatibility: must produce IDENTICAL pass/fail counts to test-all.mjs
```

**Key constraint:** The runner must produce the SAME pass/fail/warnings counts as `test-all.mjs`. Golden test: run both against the current codebase, assert identical counters.

**Affected components:**
- **New:** `test-runner.mjs` (~200 lines)
- **Modified:** `.github/workflows/test.yml` — replace `node test-all.mjs --quick` with `node test-runner.mjs --quick`
- **Modified:** `package.json` — add `"test": "node test-runner.mjs"` script
- **Deprecated (not deleted):** `test-all.mjs` — keep as fallback for one release cycle
- **No changes:** All 108 test files under `tests/` — they already use the helpers harness

**Implementation tasks:**

1. [ ] Create `test-runner.mjs`:
   - `discoverTests(dir)` → glob `tests/**/*.test.mjs`, return sorted list
   - `runTest(file, opts)` → `spawnSync` or `execFileSync` node with the file, capture stdout, parse pass/fail/warn from final line
   - `runAll(files, { parallel })` → serial or Promise.all-based parallel (with concurrency cap)
   - `--quick` → passes `--quick` flag to each test process
   - `--json` → JSON aggregate output
   - `--ci` → exits 1 if any failure, prints per-file timing
2. [ ] Add fallback parsing for `test-all.mjs`-era output format (the `📊 Results: N passed, M failed, W warnings` line)
3. [ ] Run golden comparison: `node test-all.mjs --quick` counter vs `node test-runner.mjs --quick` counter — must match within ±0
4. [ ] Update `.github/workflows/test.yml`:
   - Replace `node test-all.mjs --quick` with `node test-runner.mjs --quick`
   - Keep the OS matrix
5. [ ] Add `"test": "node test-runner.mjs"` to `package.json` scripts
6. [ ] Document migration in `test-runner.mjs` header comments
7. [ ] **Do NOT delete** `test-all.mjs` — keep as reference/fallback; add deprecation comment

**Testing strategy:**
- Golden: `test-all.mjs` pass count must equal `test-runner.mjs` pass count (±0)
- Edge: runner with empty test dir → 0 tests, exit 0
- Edge: runner with one failing test → exit 1, correct failure count
- CI: all 3 OS matrix legs pass

**Acceptance criteria:**
- `node test-runner.mjs --quick` produces identical pass/fail/warn counts to `test-all.mjs --quick`
- `node test-runner.mjs --quick` completes within ±20% of `test-all.mjs --quick` time
- CI passes on all 3 OSes
- Per-file failure output identifies which test file failed (not just "something failed")

**Rollback:** Restore `node test-all.mjs --quick` in CI — one-line revert. Keep `test-runner.mjs` in tree for future use.

---

### Track 2: Translation SHA Stamping — Freshness Tracking for Mode Files

**Objective:** Add `<!-- jobber-source-sha: <40-hex> -->` stamps to all translated mode files (same mechanism as README translations), then extend `check-translation-freshness.mjs` to discover and validate them. The CI gate (`translation-freshness` job) already exists — it just needs the stamping infrastructure in mode files.

**Current state:**
- 21 language directories with ~105 translated mode files
- 5 core mode files have the most translation coverage: `_shared.md` (18 dirs), `pipeline.md` (18), `oferta.md` (8), `apply.md` (5)
- `check-translation-freshness.mjs` currently scans `README.<lang>.md` files only (17 files)
- SHA stamps use `<!-- jobber-source-sha: <sha> -->` HTML comments
- The CI `translation-freshness` job runs the checker with `--ci` (soft, annotation-based)

**Design:**

```
Phase A: Stamp existing translations
├── Find all translated mode files: modes/<lang>/<file>.md
├── For each: determine the English source file (modes/<file>.md)
├── Compute source SHA: git log -1 --format=%H -- modes/<file>.md
├── Insert <!-- jobber-source-sha: <sha> --> near top of translated file
└── Commit stamped files

Phase B: Extend checker
├── check-translation-freshness.mjs:
│   ├── Add --modes flag (or auto-detect if modes/<lang>/ dirs exist)
│   ├── For modes/<lang>/<file>.md: find English modes/<file>.md
│   ├── Compare stored SHA vs current source SHA
│   └── Report stale findings (same format as existing README findings)
├── Output: --summary (human), --json (machine), --ci (annotations)
└── CI: translation-freshness job now covers BOTH READMEs and modes

Phase C: Stamp automation (optional, future)
├── Add npm script: "translate:stamp" that auto-stamps after a translation update
└── Document in CONTRIBUTING.md
```

**Key design decision:** The stamping uses the English source file's current HEAD SHA. When a translator refreshes a mode file, they re-stamp it with the updated source SHA. The checker flags a mismatch as stale. This is identical to the README translation mechanism.

**Affected components:**
- **Modified:** 105 translated mode files (stamp insertion only)
- **Modified:** `check-translation-freshness.mjs` — extend with mode-file support
- **New:** `stamp-translations.mjs` (optional automation script)
- **No changes:** CI workflows (the `translation-freshness` job already exists)

**Implementation tasks:**

1. [ ] Create `stamp-translations.mjs` (helper script):
   - Walk `modes/` subdirectories (skip `_*`, `interview/`, `heuristics/`, `regional/`)
   - For each `modes/<lang>/<file>.md`, find `modes/<file>.md` (source)
   - Compute source SHA via `git log -1 --format=%H -- modes/<file>.md`
   - If file has existing stamp: update it; if missing: insert after first HTML comment block or after first `#` heading
   - `--dry-run` mode: show what would be stamped
2. [ ] Run `node stamp-translations.mjs` against the repo — stamp all ~105 translation files
3. [ ] Review stamped files: verify stamp placement, ensure no garbled content
4. [ ] Extend `check-translation-freshness.mjs`:
   - Add `checkModeTranslations({ sourceSha })` function — mirrors `checkTranslations({ sourceSha })`
   - Discover `modes/<lang>/` dirs, match files against English `modes/` root
   - Use same `SHA_RE` regex, same finding types (`stale`, soft)
   - `--modes` flag: check mode translations (default: both READMEs AND modes)
   - `--ci` annotations include file paths for both README and mode findings
5. [ ] Add discovery: auto-detect `modes/<lang>/` dirs (no hardcoded language list)
6. [ ] Test: change `modes/_shared.md`, run checker → all 18 `_shared.md` translations flagged stale
7. [ ] Test: re-stamp one translation, run checker → that one is fresh, others still stale
8. [ ] Commit stamped files + checker extension

**Testing strategy:**
- Unit: `checkModeTranslations` returns correct findings for a temp dir structure with known SHAs (via `--sha` injection)
- Integration: run checker against real repo — all 105 files should have stamps (fresh after stamping)
- Edge: a mode file with no English source (e.g., `README.md` in a language dir) → skipped, not an error
- Edge: a language dir with files that don't exist in English root → skipped with warning

**Acceptance criteria:**
- All 105 translated mode files carry a `<!-- jobber-source-sha -->` stamp
- `node check-translation-freshness.mjs --json` reports findings for both READMEs and mode translations
- Changing a core mode file and running the checker flags the translations as stale
- CI `translation-freshness` job now reports mode-translation drift (annotations, non-blocking)
- Stamping is idempotent: running `stamp-translations.mjs` twice produces the same files

**Rollback:** Remove the stamps from mode files (they're HTML comments, no functional impact). Revert the checker to README-only. The CI job degrades gracefully (just reports fewer files).

---

### Track 3: Eval Pipeline Consolidation

**Objective:** Merge the three parallel evaluation pipelines (`gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs`) into a shared `eval-runner.mjs` core with provider-specific LLM callers. Eliminate ~900 lines of duplication while preserving each script's CLI interface and output format.

**Current state:**
- `gemini-eval.mjs` (482 lines): full A-G evaluation pipeline, Google AI SDK
- `ollama-eval.mjs` (395 lines): same pipeline, local Ollama API
- `openai-eval.mjs` (450 lines): same pipeline, OpenAI-compatible API
- `lib/llm-providers.mjs` already centralizes provider facts (model IDs, base URLs, context windows, pricing) — but only for provider METADATA, not the evaluation pipeline itself
- All three parse `process.argv` identically, build prompts similarly, parse the 7-block output with near-identical regexes
- Each runs `node reserve-report-num.mjs` for report-number allocation
- The openai and ollama scripts have nearly-identical system prompts (~150 lines each); gemini uses a different prompt format

**Design:**

```
eval-runner.mjs (NEW — ~300 lines)
├── Parses CLI args (identical across all 3 scripts)
├── Loads CV + JD (same for all providers)
├── Builds prompt from templates/ (provider-agnostic core)
├── Calls provider-specific LLM function via lib/llm-providers.mjs
├── Parses structured A-G output (same block detection regexes)
├── Writes report file + tracker TSV (same for all providers)
└── Exports: runEval({ provider, cv, jd, ... })

gemini-eval.mjs → thin wrapper (~50 lines)
├── import { runEval } from './eval-runner.mjs'
├── provider: 'gemini'
└── CLI glue only

ollama-eval.mjs → thin wrapper (~50 lines)
├── provider: 'ollama'
└── CLI glue only

openai-eval.mjs → thin wrapper (~50 lines)
├── provider: 'openai'
└── CLI glue only

lib/llm-providers.mjs (extended)
├── Existing: provider facts (model IDs, URLs, context windows)
├── NEW: llmCall(provider, { prompt, model, ... }) → { text, usage }
│   ├── gemini: uses @google/generative-ai SDK
│   ├── ollama: raw fetch to localhost:11434
│   └── openai: raw fetch to OpenAI-compatible endpoint
└── NEW: buildPrompt(provider, { cv, jd, systemPrompt }) → provider-specific prompt format
```

**Key constraint:** Each wrapper script MUST preserve its existing CLI interface exactly. Users invoking `node gemini-eval.mjs <url>` must see identical behavior.

**Affected components:**
- **New:** `eval-runner.mjs` (~300 lines)
- **Modified:** `gemini-eval.mjs` — reduce to ~50-line wrapper
- **Modified:** `ollama-eval.mjs` — reduce to ~50-line wrapper
- **Modified:** `openai-eval.mjs` — reduce to ~50-line wrapper
- **Modified:** `lib/llm-providers.mjs` — add `llmCall()` and `buildPrompt()` exports
- **New:** `eval-runner.test.mjs` — unit tests for the shared pipeline
- **No changes:** `openrouter-runner.mjs` — it uses a different orchestration model (batch scanning/pipeline processing, not single-JD evaluation)

**Implementation tasks:**

1. [ ] Extract the shared evaluation pipeline into `eval-runner.mjs`:
   - CLI argument parsing (identical across all 3: `process.argv.slice(2)`, URL vs file, flags)
   - CV loading (`cv.md` + `article-digest.md` + `config/profile.yml`)
   - JD loading (Playwright `browser_extract` or file read)
   - Prompt assembly (provider-agnostic system prompt + CV + JD)
   - LLM call dispatch → `lib/llm-providers.mjs.llmCall(provider, ...)`
   - Output parsing (A-G block detection, machine-summary YAML extraction)
   - Report writing + tracker TSV (identical path across all 3)
   - Report-number reservation via `reserve-report-num.mjs`
2. [ ] Add `llmCall(provider, opts)` to `lib/llm-providers.mjs`:
   - `gemini`: use existing `@google/generative-ai` SDK pattern
   - `ollama`: `fetch('http://localhost:11434/api/generate', { body: JSON.stringify({ model, prompt, stream: false }) })`
   - `openai`: `fetch('https://api.openai.com/v1/chat/completions', { body: JSON.stringify({ model, messages }) })`
   - Each returns `{ text: string, usage?: { inputTokens, outputTokens } }`
   - Error handling: provider-specific error codes mapped to common `LLMError` shape
3. [ ] Add `buildPrompt(provider, { cv, jd, systemPrompt })` to `lib/llm-providers.mjs`:
   - `gemini`: single text string (no system/user separation)
   - `ollama`: single text string
   - `openai`: messages array `[{ role: 'system', content }, { role: 'user', content }]`
4. [ ] Rewrite `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs` as thin wrappers:
   - Import `runEval` from `eval-runner.mjs`
   - Pass `provider` identifier
   - Keep `process.argv` handling identical (forward all args)
   - Remove duplicated pipeline code
5. [ ] Run golden comparison: for a fixed JD+CV, all 3 scripts must produce byte-identical report files to the pre-consolidation versions
6. [ ] Create `tests/eval-runner.test.mjs`:
   - Mock `llmCall` to return a known A-G text
   - Assert report file contains correct blocks
   - Assert tracker TSV format
   - Assert report-number allocation works
7. [ ] Update `package.json` scripts: `gemini:eval`, `ollama:eval`, `openai:eval` remain unchanged

**Testing strategy:**
- Golden: pre/post consolidation runs against a frozen JD → output file diff must be empty
- Mock: `eval-runner.test.mjs` with a faked LLM response → verifies the pipeline end-to-end without an API call
- Integration: run each wrapper script with `--help` (preserved CLI behavior)
- Regression: `test-all.mjs` must pass (task 1 should already be done by this point)

**Acceptance criteria:**
- `node gemini-eval.mjs <url>`, `node ollama-eval.mjs <url>`, `node openai-eval.mjs <url>` produce identical reports to pre-consolidation versions
- `lib/llm-providers.mjs` is the single source of truth for all LLM-calling logic
- Each wrapper script is ≤ 60 lines (CLI glue only)
- `eval-runner.test.mjs` covers the shared pipeline with mocked LLM calls
- Code duplication across the three scripts is reduced by ≥ 70% (~900 lines removed)

**Rollback:** Revert to the 3 independent eval scripts. `lib/llm-providers.mjs` extensions are backward-compatible. One-file revert per script.

---

### Track 4: Mode↔Script Contract Hardening

**Objective:** Define a lightweight machine-readable contract so `validate-mode-invocations.mjs` can validate not just script existence, but also flag compatibility — without executing `--help` on every script. Scripts expose supported flags via a `--capabilities` output; the validator cross-checks mode invocations against it.

**Current state:**
- `validate-mode-invocations.mjs` validates script existence (hard error) and flag compatibility via `--help` parsing (warning, when available)
- Only 7 of ~40 mode-referenced scripts have `--help` handlers
- The `--help`-based approach has limitations: requires executing scripts (slow for playwright-importing scripts), and parsing human-readable help output is fragile

**Design:**

```
Phase A: Add --capabilities to scripts
├── Each mode-referenced script gains a --capabilities flag
├── Output: JSON { "script": "merge-tracker.mjs", "flags": ["--dry-run", "--verify", "--strict", "--summary", "--migrate", "--migrate-via"] }
├── Exits 0, prints to stdout, no side effects
├── Initially: the top 10 most-referenced scripts get --capabilities
│   (reserve-report-num, browser-extract, set-status, generate-pdf,
│    merge-tracker, cv-sync-check, check-liveness, doctor,
│    cv-templates, build-cv-html)
└── Remaining scripts: degrade to --help parsing (existing behavior)

Phase B: Extend validator
├── validate-mode-invocations.mjs:
│   ├── Try --capabilities first (fast, machine-readable, no playwright import)
│   ├── Fall back to --help parsing only if --capabilities fails
│   ├── Cross-check mode-side flags against capabilities output
│   └── Much faster: --capabilities scripts skip 10s playwright startup
└── CI: mode-invocations job becomes faster (fewer playwright-spawning execs)
```

**Affected components:**
- **Modified:** 10 scripts — add `--capabilities` handler
- **Modified:** `validate-mode-invocations.mjs` — prefer `--capabilities` over `--help`
- **New:** `capabilities-schema.json` (optional: JSON Schema for the capabilities output format)

**Implementation tasks:**

1. [ ] Define the capabilities JSON format:
   ```json
   { "script": "merge-tracker.mjs", "version": 1, "flags": ["--dry-run", "--verify", "--strict", "--summary"], "description": "Merge batch tracker additions" }
   ```
2. [ ] Add `--capabilities` handler to the top 10 scripts:
   - Pattern: `if (args.includes('--capabilities')) { console.log(JSON.stringify({...})); process.exit(0); }`
   - Must execute BEFORE any side-effect imports (before `playwright` import for browser scripts)
3. [ ] Extend `validate-mode-invocations.mjs`:
   - `helpFlags()` → try `spawnSync(node, [script, '--capabilities'])` first
   - Parse JSON → extract `flags` array
   - On failure: fall back to existing `--help` parsing
   - Flag `capabilitiesUsed` in output (so CI can track adoption)
4. [ ] Update `validate-mode-invocations.test.mjs`: test `--capabilities` extraction path
5. [ ] Benchmark: `node validate-mode-invocations.mjs` runtime should drop from ~40s to ~5s once top scripts have `--capabilities` (avoids playwright import timeouts)
6. [ ] Document the contract in a mode-file header comment or `docs/SCRIPT_CONTRACT.md`

**Testing strategy:**
- Unit: `helpFlags` prefers `--capabilities` over `--help` when available
- Integration: run validator — runtime drops proportionally to `--capabilities` coverage
- Edge: script with broken `--capabilities` (non-JSON output) gracefully falls back to `--help`

**Acceptance criteria:**
- 10 top scripts support `node <script>.mjs --capabilities` → valid JSON on stdout
- `validate-mode-invocations.mjs` uses `--capabilities` preferentially
- Validator runtime reduced by ≥ 50% (from ~40s baseline)
- Backward compatibility: scripts without `--capabilities` still validated via `--help`

**Rollback:** The `--capabilities` flag is additive; scripts without it use the existing `--help` path. Remove the `--capabilities` preference from the validator to revert.

---

### Track 5: Reader-Writer Consistency

**Objective:** Ensure scripts that READ `data/applications.md` (stats, patterns, funnel-velocity) see a consistent snapshot, even when a concurrent merge is writing. The fix is a shared-read-lock or a `readFileSync`-with-retry on `ENOENT`/truncation.

**Current state:**
- Writers (`merge-tracker.mjs`, `set-status.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`) acquire an exclusive lock via `acquireTrackerLock`
- Writers use `writeFileAtomic` (write to `.tmp` + rename)
- Readers (`stats.mjs`, `analyze-patterns.mjs`, `funnel-velocity.mjs`, `company-history.mjs`) read with plain `readFileSync` — no lock, no retry
- On Linux/macOS, `rename` is atomic → readers see either old or new file, never partial. [VERIFIED — POSIX guarantee]
- On Windows, `rename` on FAT/exFAT is NOT atomic → reader could see a 0-byte or partial file during the rename window. [HYPOTHESIS — not reproduced]

**Design:**

```
Option A (simplest, LOW effort):
├── Add a shared-read lock function to tracker-utils.mjs:
│   ├── acquireTrackerReadLock(lockDir, { timeoutMs, retryMs })
│   │   └── A read lock IS the same exclusive lock, but with a short timeout
│   │       and NO wait — if the lock is held, return null (try without lock)
│   └── Readers try the lock; if unavailable, they read anyway (best-effort)
└── This is "advisory locking" — prevents the common case, doesn't guarantee

Option B (more robust, MEDIUM effort):
├── Readers retry on truncated content:
│   ├── readTrackerSafe(path): readFileSync, check for minimum valid content
│   │   (at least the header line + 1 data row)
│   └── On failure: wait 50ms, retry once
└── Covers the Windows rename-is-not-atomic case

Recommendation: Option B (additive, no lock overhead, handles the real failure mode)
```

**Affected components:**
- **Modified:** `tracker-utils.mjs` — add `readTrackerSafe(path)` export
- **Modified:** 4 reader scripts — replace `readFileSync(APPS_FILE, 'utf-8')` with `readTrackerSafe(APPS_FILE)`

**Implementation tasks:**

1. [ ] Add `readTrackerSafe(filePath)` to `tracker-utils.mjs`:
   - Read file with `readFileSync`
   - Validate: must contain `| # |` header and at least one `|---|` separator
   - If invalid (truncated/mid-write): wait 50ms, retry once
   - On second failure: return the content anyway (best-effort) + console.warn
2. [ ] Update reader scripts: `stats.mjs`, `analyze-patterns.mjs`, `funnel-velocity.mjs`, `company-history.mjs`
   - Replace `readFileSync(trackerPath, 'utf-8')` with `readTrackerSafe(trackerPath)`
3. [ ] Test: create a concurrent merge while running stats → stats should succeed (old or new data, not truncated)
4. [ ] No CI changes needed (reads are fast; retry adds < 100ms worst case)

**Testing strategy:**
- Unit: `readTrackerSafe` returns content for a valid tracker file
- Unit: `readTrackerSafe` retries on a truncated file (temp file with only header)
- Stress: run `node stats.mjs --summary` in a loop while a merge is in progress → no crashes

**Acceptance criteria:**
- Reader scripts use `readTrackerSafe` instead of raw `readFileSync`
- A truncated file (header only) triggers exactly one retry
- Existing test suite passes (no reader behavior change for valid files)

**Rollback:** Restore `readFileSync` calls — the retry is additive, removing it restores previous behavior.

---

## 4. Task Breakdown Structure (WBS)

```
Sprint 1 (parallel tracks)
├── 1. Test Runner
│   1.1 Create test-runner.mjs (discovery + execution + aggregation)
│   1.2 Golden comparison: test-all.mjs vs test-runner.mjs
│   1.3 Update test.yml + package.json
│   1.4 Mark test-all.mjs deprecated (keep as fallback)
├── 2. Translation Stamping
│   2.1 Create stamp-translations.mjs helper
│   2.2 Stamp all 105 mode translation files
│   2.3 Extend check-translation-freshness.mjs with mode support
│   2.4 Verify CI job now covers mode translations
│   2.5 Commit stamped files

Sprint 2
├── 3. Eval Pipeline Consolidation
│   3.1 Extract shared eval-runner.mjs core
│   3.2 Add llmCall() + buildPrompt() to lib/llm-providers.mjs
│   3.3 Rewrite 3 eval scripts as thin wrappers
│   3.4 Golden comparison: output diffs must be empty
│   3.5 Create eval-runner.test.mjs with mocked LLM

Sprint 3
├── 4. Mode↔Script Contract
│   4.1 Define capabilities JSON format
│   4.2 Add --capabilities to top 10 scripts
│   4.3 Extend validator to prefer --capabilities over --help
│   4.4 Benchmark runtime improvement
│   4.5 Document contract

Sprint 4
├── 5. Reader-Writer Consistency
│   5.1 Add readTrackerSafe to tracker-utils.mjs
│   5.2 Update 4 reader scripts
│   5.3 Stress test: concurrent merge + stats loop
```

---

## 5. Risk & Mitigation Matrix

| # | Risk | Probability | Impact | Mitigation | Residual |
|---|------|------------|--------|------------|----------|
| R1 | `test-runner.mjs` produces different pass/fail counts than `test-all.mjs` | Medium | High — breaks CI signal | Golden comparison gate: both must match ±0 before CI switchover | Low |
| R2 | Stamping 105 translation files introduces merge conflicts with in-flight translation PRs | Low | Medium — blocks a translation contributor | Run stamp during a quiet period; stamping is idempotent; conflicts are one-line comment additions | Very Low |
| R3 | Eval consolidation changes output format subtly (whitespace, order) | Medium | High — breaks users who parse report files | Golden comparison: byte-identical output MUST be confirmed before merge | Medium |
| R4 | `--capabilities` contract creates a new maintenance burden — scripts must keep capabilities output in sync with actual flags | Low | Low — same as `--help` today | The validator already catches drift; `--capabilities` just makes it faster and more reliable | Very Low |
| R5 | `readTrackerSafe` retry loop adds latency to every stats call | Very Low | Low | Retry only on parse failure; valid files take the same fast path (no retry) | Very Low |
| R6 | Consolidation breaks `openrouter-runner.mjs` (it imports eval patterns) | Low | High — breaks a user-facing runner | Audit openrouter-runner.mjs imports BEFORE consolidation; ensure it uses public APIs only | Low |

---

## 6. Testing & Quality Assurance Strategy

### 6.1 Golden Comparison Gates

| Track | Golden Test | Pass Condition |
|-------|------------|----------------|
| Test Runner | `test-runner.mjs --quick` vs `test-all.mjs --quick` | Identical pass/fail/warn counts (±0) |
| Eval Consolidation | Pre/post `gemini-eval.mjs <url>` output | Byte-identical report file (diff empty) |
| Translation Stamping | `check-translation-freshness.mjs --json` before/after stamping | Before: many "no stamp" findings; after: 0 "no stamp" findings |
| Mode Contract | `validate-mode-invocations.mjs` runtime before/after | ≥ 50% runtime reduction |

### 6.2 Regression Gates (every track)

```bash
node test-runner.mjs --quick     # Must stay at 1337 pass (post-track-1)
node updater-migration-tests.mjs # 339/0
node verify-pipeline.mjs         # Clean
node validate-mode-invocations.mjs  # 0 errors
```

### 6.3 CI Evolution

```
Current:  test.yml → test-all.mjs --quick (3 OS matrix, 6–7 min)
After T1: test.yml → test-runner.mjs --quick (3 OS matrix, ~6–7 min, per-file timing)
After T1+T4: test-runner.mjs --quick --parallel 4 (3 OS, ~2–3 min)
```

---

## 7. Deployment & Rollback Plan

### 7.1 Sprint Sequencing

```
Sprint 1 ──► Merge Track 1 + Track 2 in parallel PRs
              ├── PR-A: test-runner.mjs + CI update
              └── PR-B: translation stamping + checker extension

Sprint 2 ──► PR-C: eval consolidation (depends on T1 for fast CI feedback)

Sprint 3 ──► PR-D: --capabilities contract (depends on T1 for fast CI)

Sprint 4 ──► PR-E: reader-writer consistency (independent, low priority)
```

### 7.2 Rollback per Track

| Track | Rollback | Time | Data Loss Risk |
|-------|----------|------|----------------|
| Test Runner | Restore `test-all.mjs --quick` in CI | < 1 min | None |
| Translation Stamping | Remove stamps + revert checker | < 5 min | None (stamps are HTML comments) |
| Eval Consolidation | Revert to 3 independent scripts | < 5 min | None |
| Mode Contract | Remove `--capabilities` preference from validator | < 1 min | None |
| Reader-Writer | Restore `readFileSync` calls | < 1 min | None |

---

## 8. Post-Implementation Validation Checklist

### Sprint 1 (after Track 1 + Track 2 merge)

- [ ] `node test-runner.mjs --quick` → 1337 pass (same as baseline)
- [ ] CI: test matrix passes on all 3 OSes
- [ ] `node check-translation-freshness.mjs --json` → covers READMEs AND mode translations
- [ ] `node stamp-translations.mjs --dry-run` → reports 0 unstamped files (all stamped)
- [ ] Manual: change `modes/_shared.md`, run freshness checker → all 18 `_shared.md` translations flagged stale

### Sprint 2 (after Track 3 merge)

- [ ] Golden: `diff <(node gemini-eval.mjs <url>) <(pre-consolidation output)` → empty
- [ ] Same for ollama and openai
- [ ] `lib/llm-providers.mjs` exports `llmCall` and `buildPrompt`
- [ ] Each wrapper script is ≤ 60 lines
- [ ] `eval-runner.test.mjs` passes with mocked LLM

### Sprint 3 (after Track 4 merge)

- [ ] `node reserve-report-num.mjs --capabilities` → valid JSON
- [ ] Same for 9 other top scripts
- [ ] `node validate-mode-invocations.mjs` runtime ≤ 20s (≥ 50% reduction from ~40s baseline)
- [ ] CI `mode-invocations` job passes

### Sprint 4 (after Track 5 merge)

- [ ] `node stats.mjs --summary` succeeds during a concurrent merge
- [ ] `readTrackerSafe` retries exactly once on truncated input
- [ ] No reader scripts use raw `readFileSync` on the tracker file

---

## Appendix A: File Manifest

### New Files

| File | Track | Lines (est.) |
|------|-------|-------------|
| `test-runner.mjs` | T1 | ~200 |
| `stamp-translations.mjs` | T2 | ~80 |
| `eval-runner.mjs` | T3 | ~300 |
| `eval-runner.test.mjs` | T3 | ~100 |
| `capabilities-schema.json` | T4 | ~20 |

### Modified Files

| File | Track | Change |
|------|-------|--------|
| `.github/workflows/test.yml` | T1 | Replace `test-all.mjs` with `test-runner.mjs` |
| `package.json` | T1 | Add `"test"` script |
| `test-all.mjs` | T1 | Add deprecation comment (not deleted) |
| 105 files in `modes/*/` | T2 | Insert `<!-- jobber-source-sha -->` stamp |
| `check-translation-freshness.mjs` | T2 | Add mode-translation discovery |
| `gemini-eval.mjs` | T3 | Reduce to ~50-line wrapper |
| `ollama-eval.mjs` | T3 | Reduce to ~50-line wrapper |
| `openai-eval.mjs` | T3 | Reduce to ~50-line wrapper |
| `lib/llm-providers.mjs` | T3 | Add `llmCall()`, `buildPrompt()` |
| 10 scripts | T4 | Add `--capabilities` handler |
| `validate-mode-invocations.mjs` | T4 | Prefer `--capabilities` over `--help` |
| `tracker-utils.mjs` | T5 | Add `readTrackerSafe()` |
| 4 reader scripts | T5 | Use `readTrackerSafe()` |

### Deleted / Deprecated

| File | Track | Action |
|------|-------|--------|
| `test-all.mjs` | T1 | Deprecate (keep as fallback for one release) |

---

## Appendix B: Effort Estimate

| Track | Task | Effort | Est. Hours | Sprint |
|-------|------|--------|-----------|--------|
| T1 | Test runner | Medium | 6–8 | 1 |
| T2 | Translation stamping | Medium | 5–7 | 1 |
| T3 | Eval consolidation | High | 12–16 | 2 |
| T4 | Mode↔script contract | High | 8–12 | 3 |
| T5 | Reader-writer | Low | 3–4 | 4 |
| **Total** | | | **34–47 hours** | **~6–8 days** |

---

> **Document version:** 3.0 — supersedes v1.0 (HARDEN cycle) and v2.0 (audit refinements).
> **Previous versions:** v1.0 — HARDEN Cycle 1 (4 mitigations) · v2.0 — Post-Audit Refinements (6 fixes + 1 deferred).
