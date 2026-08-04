# Jobber HARDEN Refinements — Implementation Plan

> **Trigger:** Code review & performance audit of the HARDEN cycle implementations
> **Source:** 8 findings (R-01, R-02, R-03, S-01, S-02, SE-01, M-01, M-02) across Robustness, Speed, Security, Modularity
> **Date:** 2026-08-04
> **Baseline:** Post-HARDEN (1337 tests, 2 pre-existing environmental failures)

---

## 1. Executive Summary

The HARDEN cycle delivered 4 fragility mitigations and passed 1,337 tests. A subsequent code review and performance audit identified 8 refinements across four dimensions: **Robustness** (3), **Speed** (2), **Security** (1), and **Modularity** (2). None are critical — the hardening work is sound — but six are Quick Wins (Low effort, Medium–High impact) worth addressing before the codebase accretes further.

**What we'll fix (6 Quick Wins + 1 Strategic + 1 Maintenance):**

| # | ID | Finding | Effort | Impact |
|---|----|---------|--------|--------|
| 1 | M-02 | Sentinel GC logic duplicated (merge-tracker ↔ verify-pipeline) → extract to shared utility | Low | Medium |
| 2 | R-02/S-02 | Sentinel GC holds the merge lock; walk `reports/` before lock acquisition | Low | Medium |
| 3 | SE-01 | No path-traversal guard on script resolution in validator | Low | Medium |
| 4 | M-01 | Validator's `collectInvocations()` not exported → regex extraction path untested | Low | Medium |
| 5 | S-01 | `--health-check` spawns a child process even when cache is fresh | Medium | High |
| 6 | R-01 | Validator runs ~40s with no progress feedback | Medium | High |
| 7 | R-03 | Cache file write not atomic (graceful fallback already in place) | Low | Low |

**Total estimated effort:** ~3 development days (5 Quick Wins at < 1 day each; 1 Strategic at 1–2 days; 1 Maintenance deferred)

**Risk level:** Low — all changes are additive or refactoring, no user-layer data touched, all existing tests must continue passing.

---

## 2. Current Architecture Assessment

### 2.1 Impact Map

```
Finding          Affected Components                  Data Flow / Integration
─────────────────────────────────────────────────────────────────────────────
M-02 (dedup)     merge-tracker.mjs                    Two independent copies of
                 verify-pipeline.mjs                  SENTINEL_MAX_AGE_MS + GC
                 tracker-utils.mjs (NEW export)       logic — one constant can
                                                      drift between them

R-02/S-02        merge-tracker.mjs                    Sentinel GC reads reports/
(lock-held GC)   (gcStaleSentinels call site only)    while the TRACKER LOCK is
                                                      held; the lock blocks a
                                                      concurrent merge for ~5ms

SE-01            validate-mode-invocations.mjs        Crafted mode file with
(path-traversal)  (validateInvocations function only)  `node ../../evil.mjs`
                                                      could resolve outside JOBBER

M-01 (export)    validate-mode-invocations.mjs        collectInvocations() + its
                 tests/validate-mode-invocations.     regex constants are private;
                  test.mjs (new test cases)            real extraction path has no
                                                      test coverage

S-01 (child-     scan.mjs (--health-check block)      Spawns a separate Node
process spawn)   provider-health.mjs                  process even when the
                                                      health cache is fresh (15min
                                                      TTL) — ~500ms wasted per scan

R-01 (progress)  validate-mode-invocations.mjs        7 help-enabled scripts × up
                 (helpFlags loop)                     to 10s playwright import
                                                      = ~40s with zero output
```

### 2.2 Dependency Graph of Fixes

```
M-02 (extract GC → tracker-utils)
  │
  ├──► S-02/R-02 (move GC call before lock)
  │      └── depends on M-02 only if you want the refactored version
  │          before moving; can be done independently
  │
  ├──► SE-01 (path guard)     ← independent
  ├──► M-01 (export func)     ← independent
  │
  └──► S-01 + R-01 (Strategic) ← independent; S-01 could reuse M-01's
                                   exported collectHealthCache if desired
```

All Quick Wins are mutually independent — they touch different files and can be parallelized.

---

## 3. Detailed Implementation Plan

### Phase 1: Quick Wins (M-02, R-02/S-02, SE-01, M-01)

#### 3.1 Fix M-02: Extract Sentinel GC to Shared Utility

**Objective:** Eliminate the duplicated `gcStaleSentinels()` logic between `merge-tracker.mjs` (line 652) and `verify-pipeline.mjs` (line 228). Both define identical `SENTINEL_MAX_AGE_MS = 4 * 60 * 60 * 1000` and identical walk-delete logic. Extract into `tracker-utils.mjs` as a single exported function.

**Affected components:**
- `tracker-utils.mjs` — add new export `gcStaleSentinels(reportsDir)`
- `merge-tracker.mjs` — delete local function, import from tracker-utils, keep call site
- `verify-pipeline.mjs` — delete local logic (lines 222-246), call shared function
- `tests/` — no test changes needed (verify-pipeline tests cover the GC indirectly; the original logic is preserved verbatim)

**Design:**

```javascript
// tracker-utils.mjs (new export — identical logic, single source of truth)

import { statSync, readdirSync, unlinkSync } from 'fs'; // add to existing fs imports

export const SENTINEL_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * Remove stale report-number reservation sentinels older than the threshold.
 * Called by merge-tracker (pre-merge) and verify-pipeline (Check 8).
 *
 * @param {string} reportsDir — path to the reports/ directory
 * @returns {number} count of removed sentinels
 */
export function gcStaleSentinels(reportsDir, { maxAgeMs = SENTINEL_MAX_AGE_MS } = {}) {
  const { existsSync } = await import('fs'); // synchronous helper context
  // …existing logic verbatim from merge-tracker.mjs:652…
}
```

Wait — `tracker-utils.mjs` is a synchronous module. The sentinel GC is synchronous too. Use `existsSync`, not `await import`. The function is purely sync.

**Implementation tasks:**
1. [ ] Add `readdirSync, statSync, unlinkSync` to fs imports in `tracker-utils.mjs`
2. [ ] Add `export const SENTINEL_MAX_AGE_MS = 4 * 60 * 60 * 1000;`
3. [ ] Add `export function gcStaleSentinels(reportsDir, opts)` with the full logic (copy from merge-tracker.mjs:652-671 verbatim)
4. [ ] In `merge-tracker.mjs`: replace `import { … } from './tracker-utils.mjs'` to include `gcStaleSentinels`; delete local `SENTINEL_MAX_AGE_MS` constant and `gcStaleSentinels()` function; replace the call with imported version
5. [ ] In `verify-pipeline.mjs`: replace `SENTINEL_MAX_AGE_MS` constant reference with import; replace lines 222-246 (the entire Check 8 block) with a call to the shared function
6. [ ] Verify: `node merge-tracker.mjs --dry-run` still GCs stale sentinels
7. [ ] Verify: `node verify-pipeline.mjs` still reports "No stale reservation sentinels"

**Testing strategy:**
- Run `node updater-migration-tests.mjs` — the SYSTEM_PATHS guard ensures no user-layer drift from the utility change.
- Run `node verify-pipeline.mjs` — the Check 8 line should still print "No stale reservation sentinels" or report removed ones identically.
- Run `node merge-tracker.mjs --dry-run` — no behavior change expected.

**Acceptance criteria:**
- `SENTINEL_MAX_AGE_MS` is defined in exactly one file (`tracker-utils.mjs`)
- `gcStaleSentinels()` is defined in exactly one file (tracker-utils)
- merge-tracker and verify-pipeline both import from the same source
- All existing tests pass unchanged

**Rollback:** `git revert` — the logic is identical; if the extraction introduces an import bug, reverting restores both local copies.

---

#### 3.2 Fix R-02/S-02: Move Sentinel GC Before Lock Acquisition

**Objective:** `gcStaleSentinels()` in merge-tracker currently runs at line 672 (after TSV sort), well inside the lock-acquired region (lock acquired at line 130). The GC reads `reports/` — NOT the tracker file — so it doesn't need the lock. Moving the call before `acquireTrackerLock()` eliminates unnecessary lock-holder delay.

**Affected components:**
- `merge-tracker.mjs` — move one line (the `gcStaleSentinels()` call site)

**Implementation tasks:**
1. [ ] Move `gcStaleSentinels();` from line 672 to just before `acquireTrackerLock()` at line 128
2. [ ] The `GC_REPORTS_DIR` constant (line 644) is defined using `REPORTS_ROOT` which itself depends on `TRACKER_DIR` — move the constant definition up alongside `REPORTS_ROOT`

**Testing strategy:**
- All existing merge-tracker tests must pass (the GC is a side effect on `reports/`; no test fixture creates stale sentinels in that dir, so the behavior is unobservable in tests — which is correct: the GC should be invisible)
- Manual: create a dummy stale sentinel in `reports/`, run `merge-tracker.mjs --dry-run`, confirm it's removed AND the summary still works

**Acceptance criteria:**
- `gcStaleSentinels()` is called before `acquireTrackerLock()` in the merge flow
- Dry-run and real merge both still GC stale sentinels
- Lock-held duration is reduced by whatever the GC's `readdirSync` takes

**Rollback:** Move the line back after the lock. One-line revert.

---

#### 3.3 Fix SE-01: Path-Traversal Guard in Validator

**Objective:** `validateInvocations()` at line 153 calls `existsSync(join(JOBBER, inv.script))` where `inv.script` is a regex-extracted filename from a mode `.md` file. A crafted mode file containing `node ../../some-script.mjs` would resolve outside the Jobber repo root. The `existsSync` guard catches non-existent files, but a file could exist in a sibling directory. Add a `resolve` + `startsWith` check.

**Affected components:**
- `validate-mode-invocations.mjs` — `validateInvocations()` function, line 152-158

**Implementation tasks:**
1. [ ] Inside the script-existence check (line 152), replace:
   ```js
   if (!existsSync(join(JOBBER, inv.script))) { errors.push(...); continue; }
   ```
   with:
   ```js
   const scriptPath = resolve(JOBBER, inv.script);
   if (!scriptPath.startsWith(resolve(JOBBER) + sep) || !existsSync(scriptPath)) {
     errors.push({ ... message: `mode references node ${inv.script} which does not exist or escapes the repo root` });
     continue;
   }
   ```
2. [ ] Add `sep` to the `path` import line

**Testing strategy:**
- Add a test case: `validateInvocations([{file:'x.md', script: '../../bad.mjs', flags:[]}])` → expects ERROR (path escapes repo)
- Add a test case: `validateInvocations([{file:'x.md', script: 'stats.mjs', flags:[]}])` → no error (valid script stays inside)

**Acceptance criteria:**
- Script name containing `../` or `..\\` is rejected as an error (not just silently missing)
- Valid script names (flat filenames like `stats.mjs`) still pass
- All 6 existing validator tests still pass

**Rollback:** Remove the `startsWith` check — restores previous behavior. One-line revert.

---

#### 3.4 Fix M-01: Export `collectInvocations()` for Test Coverage

**Objective:** `collectInvocations()` (the mode-file walking + regex extraction function) is not exported, making it untestable from `tests/validate-mode-invocations.test.mjs`. The 6 existing tests cover `validateInvocations()` against hand-crafted inputs but never exercise the real regex-based extraction. Export the function and add 2 integration tests against temp directories with known mode files.

**Affected components:**
- `validate-mode-invocations.mjs` — export `collectInvocations`, `INVOCATION_RE`, `FLAG_RE`
- `tests/validate-mode-invocations.test.mjs` — add 2 extraction tests

**Implementation tasks:**
1. [ ] Export `collectInvocations(modesDir = MODES_DIR)` — accept an optional directory for test isolation
2. [ ] Export `INVOCATION_RE` and `FLAG_RE` as named constants for edge-case testing
3. [ ] Add test: create temp dir with a mode file containing `node real-script.mjs --flag`, call `collectInvocations(tempDir)`, assert the extraction yields `{script: 'real-script.mjs', flags: ['--flag']}`
4. [ ] Add test: create temp dir with a mode file containing `node <template>.mjs` (placeholders should NOT yield a flag), assert no flags extracted from placeholder invocations

**Testing strategy:**
- Integration: temp dir with known `.md` files, test extraction output
- Edge case: placeholder tokens (`{###}`, `<script>`) should not appear in flags
- Edge case: `npm run` invocations should NOT be matched (the regex is `node `-specific)

**Acceptance criteria:**
- `collectInvocations()` is accessible from tests via import
- Two new tests cover: (a) real flag extraction, (b) placeholder filtering
- Existing 6 tests unchanged

**Rollback:** Remove the `export` keyword from `collectInvocations` — pure revert, no behavior change.

---

### Phase 2: Strategic (R-01 + S-01)

#### 3.5 Fix S-01: Direct Cache Read in `--health-check`

**Objective:** `scan.mjs --health-check` always spawns a child Node process via `execFileSync('node', ['provider-health.mjs', '--summary'])`, costing ~500ms cold-start on every scan even when the health cache is fresh (15-min TTL). Instead, read the cache file directly in scan.mjs; only spawn the child process on a cache miss.

**Affected components:**
- `scan.mjs` — `--health-check` block (lines ~2050-2065)
- `provider-health.mjs` — no changes (the cache format is the contract)

**Implementation tasks:**
1. [ ] Read the cache file path: `join(tmpdir(), 'jobber-provider-health.json')`
2. [ ] If cache exists and `Date.now() - ts < 15 * 60_000`: parse the cached `results` array directly (no subprocess)
3. [ ] On cache miss or stale cache: spawn the child process (existing path)
4. [ ] Print the health table from either source (identical format)
5. [ ] Extract the cache-read logic into a small helper to keep the scan.mjs diff minimal

**Testing strategy:**
- Manual: run `node scan.mjs --health-check --company x` twice — first run (cache miss → spawn), second run (cache hit → direct read, no spawn overhead visible)
- The test fixture `tests/provider-health.test.mjs` already verifies cache semantics; no new test needed

**Acceptance criteria:**
- Second `--health-check` invocation within 15 min reads the cache directly (no subprocess)
- Cache format change in `provider-health.mjs` (e.g., new field) is forward-compatible — scan.mjs gracefully falls back to subprocess on parse failure
- Non-blocking: a broken cache doesn't block the scan

**Rollback:** Remove the direct-read block; restore `execFileSync` unconditionally.

---

#### 3.6 Fix R-01: Progress Feedback During Validation

**Objective:** `validate-mode-invocations.mjs` runs `helpFlags()` serially for each unique help-capable script (~7 scripts). With playwright-importing scripts, each probe takes up to 10s. The total runtime (~40s) produces zero output between the "📄 N mode files" header and the final results, making CI operators wonder if the validator is stuck. Add a stderr progress heartbeat.

**Affected components:**
- `validate-mode-invocations.mjs` — `helpFlags()` call loop (should already dedup via `helpCache`; just needs progress output)

**Implementation tasks:**
1. [ ] Before the validation loop, collect unique scripts that will be probed: `const toProbe = [...new Set(invocations.map(i => i.script))].filter(s => /* needs --help */)`
2. [ ] In the loop, emit a progress line to stderr every N scripts:
   ```js
   if (++checked % 2 === 0) process.stderr.write(`\r🔍 Validating script flags: ${checked}/${toProbe.length}`);
   ```
3. [ ] After the loop completes, clear the progress line: `process.stderr.write('\n');`
4. [ ] In `--json` mode, suppress progress (stderr should be clean for parsers)

**Testing strategy:**
- Manual: run `node validate-mode-invocations.mjs` — should see a stderr progress line updating every 2 script probes
- Manual: run `node validate-mode-invocations.mjs --json` — stderr should be empty
- Existing tests: progress on stderr doesn't affect test assertions (they check exit codes + stdout)

**Acceptance criteria:**
- A progress line appears on stderr during validation (not in `--json` mode)
- The final output format (summary / JSON) is unchanged
- CI output shows a heartbeat (stderr is captured in job logs)

**Rollback:** Remove the progress lines — one-line revert, no behavior change.

---

### Phase 3: Maintenance (R-03 — Deferred)

#### 3.7 Fix R-03: Atomic Cache Write (Deferred)

**Objective:** `provider-health.mjs` writes the cache file with a plain `writeFileSync`. A crash or concurrent scanner during the write could leave a truncated JSON file that the next reader's `catch { return null }` falls through to a fresh probe (graceful degradation). The fix: write to a `.tmp` file, then `renameSync` (atomic on the same filesystem). Deferred because (a) the fallback already handles truncation gracefully, (b) the blast radius is one extra HTTP probe on the next run, and (c) crash-during-cache-write is extremely unlikely (the cache is written after all probes complete).

**Re-evaluation trigger:** Promote to Quick Win if a user reports "health check probes APIs every scan instead of using cache" — that would indicate a truncated cache causing repeated cache misses.

---

## 4. Task Breakdown Structure (WBS)

```
1. Quick Wins — Phase 1
   1.1 Fix M-02: Extract sentinel GC to tracker-utils.mjs
       1.1.1 Add readdirSync/statSync/unlinkSync to tracker-utils imports
       1.1.2 Copy GC logic + SENTINEL constant → tracker-utils
       1.1.3 Replace merge-tracker local imports with shared call
       1.1.4 Replace verify-pipeline Check 8 with shared call
       1.1.5 Verify: merge + verify-pipeline produce identical GC behavior
   1.2 Fix R-02/S-02: Move GC before lock
       1.2.1 Move gcStaleSentinels() call to before acquireTrackerLock
       1.2.2 Verify: dry-run still runs, lock not held during GC
   1.3 Fix SE-01: Path-traversal guard
       1.3.1 Add resolve+startsWith check in validateInvocations
       1.3.2 Add 2 test cases (traversal, valid script)
       1.3.3 Verify: all 6 existing tests still pass
   1.4 Fix M-01: Export collectInvocations
       1.4.1 Export collectInvocations + regex constants
       1.4.2 Add 2 extraction integration tests
       1.4.3 Verify: real mode files still parse cleanly

2. Strategic — Phase 2
   2.1 Fix S-01: Direct cache read in --health-check
       2.1.1 Add cache-read helper to scan.mjs
       2.1.2 Fallback to subprocess on cache miss/parse failure
       2.1.3 Verify: second scan invocation within 15 min is sub-100ms
   2.2 Fix R-01: Progress feedback in validator
       2.2.1 Collect unique scripts before loop
       2.2.2 Emit stderr progress every N probes
       2.2.3 Suppress in --json mode
       2.2.4 Verify: stderr shows progress, --json output is clean

3. Maintenance — Phase 3 (deferred)
   3.1 Fix R-03: Atomic cache write
       3.1.1 Re-evaluate if cache corruption is reported
```

---

## 5. Risk & Mitigation Matrix

| # | Risk | P | I | Mitigation | Residual |
|---|------|---|---|------------|----------|
| R1 | `tracker-utils.mjs` import change breaks scripts that import only specific symbols (not wildcard) | Low | Low | Each script imports named symbols from tracker-utils; adding a new export is backward-compatible. Verify with `node --check` on all importing scripts. | Very Low |
| R2 | Moving GC before the lock creates a race with another process creating a fresh sentinel RIGHT before the lock is acquired | Very Low | Very Low | Sentinels are created atomically via `O_CREAT|O_EXCL` (reserve-report-num.mjs). The GC window between relocate and lock is < 1ms — not a realistic race. | Very Low |
| R3 | Direct cache read format changes → scan.mjs fails to parse | Low | Medium | Wrap in try/catch; on failure, fall back to subprocess spawn. The original behavior is the fallback, so cache-skip can never be worse than current. | Very Low |
| R4 | Stderr progress in validator conflicts with a CI parser expecting clean stderr | Low | Low | Progress is suppressed in `--json` mode; CI jobs use `--ci` which only checks exit code. Summary mode (default) already writes to stdout; stderr progress is additive. | Very Low |
| R5 | `collectInvocations()` export changes the function's closure scope (it references `MODES_DIR` from module scope) | Low | Low | Already parameterized: `collectInvocations(dir = MODES_DIR)`. Adding the export + default param is safe — the existing call path doesn't change. | Very Low |
| R6 | verify-pipeline Check 8 replacement breaks its test assertion format | Low | Medium | Check 8's output line format `"No stale reservation sentinels"` or `"⚠ Removed stale…"` stays identical — the function is copied verbatim, only the caller changes. Verify by running `node verify-pipeline.mjs`. | Very Low |

---

## 6. Testing & Quality Assurance Strategy

### 6.1 Test Plan

| Fix | Unit Tests | Integration Tests | Regression Gate |
|-----|-----------|-------------------|-----------------|
| M-02 (shared GC) | N/A (logic unchanged) | `verify-pipeline.mjs` Check 8 output | updater-migration-tests |
| R-02/S-02 (move GC) | N/A (call-site reorder) | `merge-tracker.mjs --dry-run` | merge-tracker tests |
| SE-01 (path guard) | 2 new validation tests | N/A | Existing 6 VMI tests |
| M-01 (export) | 2 new extraction tests | `collectInvocations()` against real modes | Full VMI run |
| S-01 (direct cache) | N/A (read path) | `scan.mjs --health-check` × 2 | provider-health tests |
| R-01 (progress) | N/A (UI) | Manual visual check | VMI output regression |

### 6.2 Combined Regression Gate

```bash
node test-all.mjs --quick  # Must stay at 1337 passed (the 2 pre-existing failures unchanged)
node updater-migration-tests.mjs  # Must pass 339/0
node verify-pipeline.mjs   # Clean
node merge-tracker.mjs --dry-run --summary  # 24 adds, 5 skips unchanged
node validate-mode-invocations.mjs  # Clean (0 errors, 0 warnings)
```

---

## 7. Deployment & Rollback Plan

### 7.1 Deployment Order (Dependency-Aware)

```
Phase 1 (parallelizable — all independent):
  PR-1: M-02 (shared GC) → merge first (it's a pure extraction)
  PR-2: R-02/S-02 (move GC call) → can merge before or after PR-1
  PR-3: SE-01 (path guard) + M-01 (export) → bundle together (both touch VMI)
    OR: two separate PRs (SE-01 is trivial, M-01 is slightly larger)

Phase 2 (sequential — after Phase 1 is stable):
  PR-4: S-01 (direct cache read in scan.mjs)
  PR-5: R-01 (progress feedback in VMI)
```

All Phase 1 PRs are independent and can be opened simultaneously.

### 7.2 Rollback per Fix

| Fix | Rollback | Time | Risk |
|-----|----------|------|------|
| M-02 | `git revert` PR-1; restore both local copies | < 1 min | No data change |
| R-02/S-02 | Move the line back; one-commit revert | < 1 min | No data change |
| SE-01 | Remove `startsWith` guard; one-line revert | < 1 min | No data change |
| M-01 | Remove `export` from `collectInvocations` | < 1 min | No data change |
| S-01 | Remove direct-read block; always exec child | < 1 min | No data change |
| R-01 | Remove progress lines | < 1 min | No data change |

---

## 8. Post-Implementation Validation Checklist

### 8.1 Immediate (within same PR)

- [ ] `node test-all.mjs --quick` → 1337 passed, 2 environmental failures (unchanged)
- [ ] `node updater-migration-tests.mjs` → 339/0
- [ ] `node verify-pipeline.mjs` → clean (no new warnings)
- [ ] `node merge-tracker.mjs --dry-run --summary` → 24 adds, 5 skips (unchanged)
- [ ] `node validate-mode-invocations.mjs` → 0 errors, 0 warnings
- [ ] `node provider-health.mjs --ci` → exits 0
- [ ] `node scan.mjs --dry-run --health-check --company x` → prints health table, continues

### 8.2 Short-Term (within 1 week)

- [ ] Run a real scan with `--health-check` twice — verify second run uses cache (< 100ms health step)
- [ ] Create a dummy stale sentinel in `reports/`, run merge — verify it's GC'd
- [ ] Open a PR that changes `modes/_shared.md` — CI `translation-freshness` job annotates stale README translations
- [ ] Open a PR that breaks a mode invocation (reference a renamed script) — CI `mode-invocations` job fails

### 8.3 Medium-Term

- [ ] Monitor CI runtimes for the `mode-invocations` job — with progress feedback, should show consistent ~40s ± 5s
- [ ] If a provider goes down, the daily `provider-health.yml` CI workflow should fail within 24h
- [ ] R-03 (atomic cache write): promote if a user reports repeated fresh probes despite cache

---

## Appendix A: File Manifest

### Modified Files

| File | Change | Fix ID |
|------|--------|--------|
| `tracker-utils.mjs` | Add `gcStaleSentinels` export + `SENTINEL_MAX_AGE_MS` constant + fs imports | M-02 |
| `merge-tracker.mjs` | Delete local GC function; import from tracker-utils; move GC call before lock | M-02, R-02/S-02 |
| `verify-pipeline.mjs` | Replace Check 8 block (lines 222-246) with shared function call | M-02 |
| `validate-mode-invocations.mjs` | Path-traversal guard in `validateInvocations()`; export `collectInvocations` + regex constants; stderr progress | SE-01, M-01, R-01 |
| `scan.mjs` | Direct cache-read helper in `--health-check` block | S-01 |
| `tests/validate-mode-invocations.test.mjs` | 4 new test cases: traversal guard (2) + extraction coverage (2) | SE-01, M-01 |

### Deferred

| File | Change | Reason |
|------|--------|--------|
| `provider-health.mjs` | Atomic `writeFileSync` → `writeFileSync(.tmp) + rename` | Deferred (graceful fallback handles corruption; crash-during-write extremely unlikely) |

---

## Appendix B: Effort Estimate

| Phase | Fixes | Effort | Estimated Hours |
|-------|-------|--------|-----------------|
| Quick Wins | M-02, R-02/S-02, SE-01, M-01 | Low × 4 | 4–6 hours |
| Strategic | S-01, R-01 | Medium × 2 | 3–5 hours |
| Maintenance | R-03 | Low (deferred) | 0 |
| **Total** | | | **7–11 hours (~1.5 days)** |

---

> **Document version:** 2.0 — corresponds to post-HARDEN audit refinements.
> **Previous version:** 1.0 (2026-08-03) — HARDEN Cycle 1 implementation plan.
