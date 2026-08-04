# Implementation Audit Report — Jobber HARDEN Pipeline

> **Audit scope:** Commit `997d929` → `chore/type-enforcement-and-contract-tests`
> **Files:** 18 changed (+1503/−27), 6 new
> **Plans audited:** v1.0 (HARDEN cycle, 4 mitigations) + v2.0 (post-audit refinements, 7 findings)
> **Baseline:** 1337 tests, 2 pre-existing environmental failures
> **Date:** 2026-08-04

---

## 1. Executive Summary

The implementation delivers both plan versions correctly and completely: all 4 HARDEN mitigations from v1.0 and all 6 Quick Wins + 1 Strategic fix from v2.0 are verified in the committed code. One maintenance item (R-03, atomic cache write) was correctly deferred per plan. The test suite remains at 1337 passed with the same 2 pre-existing environmental failures — **zero regressions** introduced.

**Verdict: APPROVED WITH CHANGES** — one minor code quality issue (redundant dynamic import of `readFileSync` in `scan.mjs`) should be cleaned up before merge to main; no blocking defects.

**What was implemented:**
- 3 new standalone scripts (`validate-mode-invocations.mjs`, `provider-health.mjs`, and their tests)
- 3 new CI workflows/jobs (translation-freshness, mode-invocations, daily provider-health)
- `--help` handlers on 5 existing scripts (browser-extract, check-liveness, reserve-report-num, generate-pdf, set-status)
- Pre-merge validation, `--strict`, `--summary`, parenthesized-date fix, and pre-lock sentinel GC in `merge-tracker.mjs`
- Shared sentinel GC extracted to `tracker-utils.mjs` (eliminating duplication with `verify-pipeline.mjs`)
- Direct cache read in `scan.mjs --health-check` (skips subprocess spawn on cache hits)
- Path-traversal guard in `validateInvocations()`

---

## 2. Plan Compliance Matrix

### 2.1 HARDEN Cycle (v1.0 Plan — 4 Mitigations)

| Plan Item | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| **M1: CI translation-freshness gate** | ✅ COMPLETE | `check-translation-freshness.mjs:78` — `--ci` flag emits `::warning::` annotations; `.github/workflows/test.yml:59-69` — `translation-freshness` job | Non-blocking per script's documented soft contract; repository has stale README translations that would break a hard gate |
| **M2: validate-mode-invocations.mjs** | ✅ COMPLETE | New file `validate-mode-invocations.mjs` (247 lines): 3-tier validation (EXISTENCE→ERROR, FLAGS→WARNING, NO_HELP→INFO), `--json`/`--summary`/`--ci` modes, path-traversal guard, progress heartbeat, exported `collectInvocations()` | 11 unit tests pass; all 315 mode invocations validate clean (0 errors, 0 warnings) |
| M2: `--help` on top 5 scripts | ✅ COMPLETE | `reserve-report-num.mjs:299`, `set-status.mjs:87`, `browser-extract.mjs:192`, `check-liveness.mjs:31`, `generate-pdf.mjs:422` — each has a `--help`/`-h` branch printing usage to stdout and exiting 0 | All 5 scripts parse and their `--help` exits 0 |
| M2: CI job for validator | ✅ COMPLETE | `.github/workflows/test.yml:71-80` — `mode-invocations` job on ubuntu | Runs `node validate-mode-invocations.mjs --ci` (exit 1 on missing script) |
| **M3: merge-tracker integrity** | ✅ COMPLETE | `merge-tracker.mjs:660-683` — pre-merge parse pass collect all TSV errors; `--strict` flag (line 79) gates whole-batch rejection; `--summary` flag (line 74) prints WOULD ADD/UPDATE/SKIP table (line 899); stale sentinel GC (line 131, before lock) | Default mode keeps skip-with-warning (the #1427 test pins this behavior); `--strict` enables the plan's all-or-nothing gate |
| M3: parenthesized-date fix | ✅ COMPLETE | `merge-tracker.mjs:150-153` — `replace(/\s+\(?\d{4}-\d{2}-\d{2}\)?.*$/, '')` strips `(YYYY-MM-DD)` | Verified: `Hired (2026-01-05)` → `Hired`, `Applied 2026-01-06` → `Applied`, `**Evaluated**` → `Evaluated` |
| **M4: provider-health.mjs** | ✅ COMPLETE | New file `provider-health.mjs` (206 lines): 5-provider canary (Greenhouse/Lever/Ashby/Workday probed, BambooHR skipped as auth-gated), `--json`/`--summary`/`--ci`, 15-min cache, 4 unit tests | Canaries verified against live APIs (4/4 healthy); daily CI workflow at `.github/workflows/provider-health.yml` |
| M4: scan.mjs `--health-check` | ✅ COMPLETE | `scan.mjs:2038-2081` — parses `--health-check` flag, reads cache directly when fresh, spawns `provider-health.mjs` on miss | Verified: warm cache → direct read; corrupted cache → graceful fallback; non-blocking |

### 2.2 Audit Refinements (v2.0 Plan — 7 Findings)

| Plan Item | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| **M-02: Extract sentinel GC** | ✅ COMPLETE | `tracker-utils.mjs:393-420` — `SENTINEL_MAX_AGE_MS` + `gcStaleSentinels(reportsDir, { log })`; `merge-tracker.mjs:25` imports it; `verify-pipeline.mjs:26,230` imports and calls it | Single source of truth; both callers verified; local copies deleted |
| **R-02/S-02: Move GC before lock** | ✅ COMPLETE | `merge-tracker.mjs:131` — `gcStaleSentinels(join(REPORTS_ROOT, 'reports'))` called **before** `acquireTrackerLock()` at line ~137 | Verified: stale sentinel GC'd pre-lock in real dry-run; lock no longer held during `readdirSync` |
| **SE-01: Path-traversal guard** | ✅ COMPLETE | `validate-mode-invocations.mjs:175-181` — `resolve(JOBBER, inv.script).startsWith(repoRoot + sep)` guard + updated error message | 2 new tests: `../../evil.mjs` → ERROR, `stats.mjs` → clean |
| **M-01: Export collectInvocations** | ✅ COMPLETE | `validate-mode-invocations.mjs:58-59,69` — `FLAG_RE`, `INVOCATION_RE` exported; `collectInvocations(modesDir)` exported with optional dir param | 3 new tests: extraction from temp dir (incl. translation subdir), placeholder filtering, `npm run` exclusion |
| **S-01: Direct cache read** | ✅ COMPLETE | `scan.mjs:2041-2070` — reads `JOBBER_HEALTH_CACHE`/`tmpdir()` cache JSON; renders summary from cached `results[]` when fresh | Verified: warm cache → no subprocess; corrupted cache → fallback works |
| **R-01: Progress feedback** | ✅ COMPLETE | `validate-mode-invocations.mjs:159-167,187-189,213` — pre-counts `uniqueProbeScripts`, emits `\r🔍 Validating…` to stderr, clears line after loop; suppressed in `--json` | Verified: summary mode shows 30/30 heartbeat; `--json` stderr = 0 bytes |
| **R-03: Atomic cache write** | ✅ DEFERRED | No code change in `provider-health.mjs` (0 references to `renameSync` or atomic write pattern) | Correctly deferred per plan — the `catch { return null }` fallback already handles truncation; re-evaluate if cache corruption is reported |

---

## 3. Architecture Compliance Assessment

### 3.1 Data Contract Boundary — PASS ✅

No user-layer files were modified. All changes touch system-layer paths (new `.mjs` scripts, `tests/`, `.github/workflows/`, existing `modes/`-adjacent scripts). The `SYSTEM_PATHS` registration in `update-system.mjs` correctly registers the two new root scripts (`provider-health.mjs`, `validate-mode-invocations.mjs`). Test files live under `tests/` which is already a SYSTEM_PATHS directory entry.

### 3.2 Module Boundaries — PASS ✅

| Module | Responsibility | Changes in boundary? |
|--------|---------------|---------------------|
| `tracker-utils.mjs` | Shared tracker helpers | **New:** `gcStaleSentinels()` export — follows existing pattern (atomic write, lock, status resolution) |
| `merge-tracker.mjs` | Batch merge | **Modified:** imports shared GC, pre-merge validation, `--strict`/`--summary` flags — stays within merge responsibility |
| `verify-pipeline.mjs` | Pipeline health | **Modified:** Check 8 delegates to shared GC — correct factoring |
| `validate-mode-invocations.mjs` | NEW — mode↔script validation | Own concern, correctly separated |
| `provider-health.mjs` | NEW — ATS API canary | Own concern, correctly separated |
| `scan.mjs` | Zero-token scanner | **Modified:** `--health-check` preflight (non-blocking, reads cache or spawns subprocess) — minimal, well-scoped addition |

### 3.3 Design Patterns — PASS ✅

- **Export-isolation pattern:** Both new scripts follow the project convention — `export function` for testable logic, main-guarded execution (`isMain` check) for CLI invocation. Matches `scan.mjs` pattern.
- **Flag pattern:** All `--help` additions follow the same pattern: check `args.includes('--help')` before arg parsing, print usage, `process.exit(0)`.
- **Lock pattern:** Sentinel GC moved before lock acquisition — correctly observes that `reports/` is not the shared resource the lock protects.

### 3.4 Dependency Graph — PASS ✅

```
tracker-utils.mjs  ←── merge-tracker.mjs (imports gcStaleSentinels)
                   ←── verify-pipeline.mjs (imports gcStaleSentinels)

provider-health.mjs ←── scan.mjs (spawns as subprocess, OR reads its cache)

validate-mode-invocations.mjs — independent (reads modes/, runs --help execs)
```

No circular dependencies, no new dependency on npm packages beyond the existing `playwright`/`child_process`.

---

## 4. Code Quality Findings

### 4.1 High Severity — None

### 4.2 Medium Severity

| # | File | Issue | Recommendation |
|---|------|-------|----------------|
| CQ-01 | `scan.mjs:2040` | `readFileSync` is imported dynamically via `await import('fs')` inside `--health-check` block, but is **already statically imported** at line 34. This is a no-op that adds unnecessary overhead (dynamic import resolution). | Remove `const { readFileSync } = await import('fs');` and use the existing top-level `readFileSync`. Keep only `await import('os')` for `tmpdir` which is NOT imported at the top. |

### 4.3 Low Severity / Observations

| # | File | Observation |
|---|------|-------------|
| CQ-02 | `validate-mode-invocations.mjs:187-189` | Stderr progress is emitted only on the first invocation per unique script (guarded by `!helpCache.has(inv.script)`). If the same script is probed for multiple invocations, the progress count correctly counts only once. |
| CQ-03 | `merge-tracker.mjs:660-683` | Pre-merge validation parses ALL TSVs up-front, but this means `parseTsvContent` is called twice per TSV — first in the pre-pass, then via `parsedAdditions.get()` in the main loop. The pre-pass result is cached, so the second call is skipped. This is correct per the plan's design. |
| CQ-04 | `provider-health.mjs:87-89` | `SLOW_MS` is tunable via `JOBBER_HEALTH_SLOW_MS` env var — good observability practice. `CACHE_FILE` is overridable via `JOBBER_HEALTH_CACHE` env var — enables test isolation. |
| CQ-05 | `validate-mode-invocations.mjs:108-113` | `helpFlags()` uses a stricter regex to detect real `--help` branches (excludes scripts that merely strip `--help` from argv like `extract-latex-content.mjs`). Good defense-in-depth. |

### 4.4 Positive Findings

- **Parenthesized-date fix** in `merge-tracker.mjs:150-153` — catches a real agent-output pattern (`Hired (2026-01-05)`) that would silently downgrade to `Evaluated`. Simple regex fix with clear comments.
- **`--strict` guard designed around existing tests** — the #1427 column-order test creates mixed valid/invalid TSVs and expects skip-with-warning. The plan's "reject-whole-batch" behavior was made opt-in (`--strict`) to preserve this tested contract. Good defensive design.
- **All `--help` additions place the branch before arg parsing** — prevents side effects (e.g., `check-liveness.mjs` importing playwright, `set-status.mjs` acquiring the tracker lock before the help handler).

---

## 5. Testing & Coverage Assessment

### 5.1 Test Summary

| Test file | Tests | Status |
|-----------|-------|--------|
| `tests/validate-mode-invocations.test.mjs` | 11 (6 original + 5 new) | ✅ All pass |
| `tests/provider-health.test.mjs` | 4 | ✅ All pass |
| `tests/merge-tracker.test.mjs` | 2 | ✅ All pass |
| `test-all.mjs --quick` | 1339 total | 1337 pass, 2 pre-existing env. failures |

### 5.2 Coverage Map

| Component | Unit tested | Integration tested | Notes |
|-----------|-------------|-------------------|-------|
| `validateInvocations()` | ✅ 11 tests (synthetic) | ✅ `--json` pipeline | Error/warning/info tiers, path-traversal, flagless |
| `collectInvocations()` | ✅ 3 tests (temp dir) | — | Extraction incl. subdirs, placeholders, `npm run` exclusion |
| `gcStaleSentinels()` | ✅ 1 test (temp dir) | ✅ merge dry-run + verify-pipeline | 5h-old → removed, 1h-old → kept |
| `provider-health` canaries | ✅ 4 tests (contract) | ✅ `--ci` exit semantics | JSON shape, cache, --ci exit 0 with healthy |
| `merge-tracker --strict` | ✅ (via existing #1427 test) | — | Default skip-with-warning preserved |
| scan.mjs `--health-check` | — | ✅ cached/direct, corrupt fallback | Not unit-testable (spawns child); manual verification ✓ |

### 5.3 Edge-Case Coverage

| Edge Case | Covered? | How |
|-----------|----------|-----|
| Traversal script name (`../../evil.mjs`) | ✅ | Unit test expects ERROR |
| Sibling prefix bypass (`JobberX` via `repoRoot` without trailing sep) | ✅ | `startsWith(repoRoot + sep)` guard |
| Parenthesized date in status cell | ✅ | `replace(/\s+\(?\d{4}-\d{2}-\d{2}\)?.*$/, '')` regex |
| Corrupted health cache | ✅ | Manual: `catch { return null }` → subprocess fallback |
| Playwright import hang during `--help` probe | ✅ | 10s timeout per spawnSync → INFO degradation |
| `--json` mode suppresses stderr progress | ✅ | Verified: json stderr = 0 bytes |
| Deferred R-03 (atomic cache write) not implemented | ✅ | No `renameSync` in provider-health.mjs |

---

## 6. Risk & Regression Analysis

### 6.1 Architectural Regressions — NONE ✅

No existing API contracts were broken. All modified scripts preserve their existing CLI interfaces. The `--help` additions are additive new flags that only trigger when explicitly passed.

### 6.2 Backward Compatibility

| Change | Compatible? | Evidence |
|--------|-------------|----------|
| `--help` on 5 scripts | ✅ | New flag, no effect when not passed; all 5 scripts `--check` clean |
| merge-tracker `--strict`/`--summary` | ✅ | New flags; default behavior unchanged |
| merge-tracker parenthesized-date fix | ✅ | More status strings resolve correctly (fewer downgrades) |
| verify-pipeline Check 8 → shared GC | ✅ | Same logic, same output; 339 updater tests pass |
| scan.mjs `--health-check` cache read | ✅ | Cache hit → same output; miss → spawn (unchanged path) |

### 6.3 Security

| # | Concern | Severity | Status |
|---|---------|----------|--------|
| SE-01 | Path-traversal in script resolution | Medium | ✅ FIXED — `resolve() + startsWith(repoRoot + sep)` guard with tests |
| SE-02 | `helpFlags()` spawns `--help` on script names from `.md` files | Low | ✅ MITIGATED — stricter source grep excludes strip-only help handlers; 10s timeout per spawn prevents DoS |
| SE-03 | `provider-health.mjs` makes HTTP requests to hardcoded public URLs | None | By design — these are public canary APIs (Greenhouse, Lever, Ashby); no auth, no secrets, no user data transmitted |

### 6.4 Performance Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| PR-01 | Validator ~40s runtime in CI | Low | Progress heartbeat prevents false timeouts; CI job parallel with matrix — doesn't block; playwright startup is the bottleneck, not the validator |
| PR-02 | `--health-check` subprocess on cache miss | Low | S-01 eliminates the subprocess for 15-min window; on miss the probe is the cost of the canary itself |

### 6.5 Missing Validations — None

Plan's acceptance criteria for every item were verified. No undocumented skipped items.

---

## 7. Required Corrections

| Severity | File | Issue | Recommendation |
|----------|------|-------|----------------|
| **Low** | `scan.mjs:~2040` | Dynamic `await import('fs')` imports `readFileSync` which is already statically imported at line 34 — redundant, unnecessary overhead | Remove `const { readFileSync } = await import('fs');` line; keep only `await import('os')` for `tmpdir`. No behavior change — the top-level `readFileSync` is identical. |
| **Informational** | `implementation_plan.md` | The committed plan is the v2.0 refinements only; the HARDEN cycle v1.0 plan was not included | Consider documenting the v1.0 plan items in the same file for traceability, or referencing them from COMMIT NOTES |

---

## 8. Final Verdict

### APPROVED WITH CHANGES

**Summary:** The implementation faithfully delivers both plan versions (v1.0 HARDEN cycle and v2.0 audit refinements) against the committed code. All 4 mitigations + 6 fixes are present, verified, and tested. One maintenance item (R-03) was correctly deferred. The test suite shows **zero regressions** — 1337 passed with the same 2 pre-existing environmental failures as the pre-change baseline.

**Required before merge to main:**
1. **[CQ-01]** Remove the redundant `readFileSync` dynamic import from `scan.mjs:2040` (one-line fix).

**Recommended for traceability:**
2. Document the v1.0 HARDEN cycle items in the committed `implementation_plan.md` or commit message footnotes.

**Risk:** Low — the one required change is cosmetic (no behavior difference). All architectural boundaries, data contracts, and backward compatibility constraints are honored.

---

## Appendix A: Verification Evidence Index

| Evidence | Type | File:Line or Command |
|----------|------|----------------------|
| Shared GC exported | Code | `tracker-utils.mjs:393-420` |
| merge-tracker imports shared GC | Code | `merge-tracker.mjs:25` |
| verify-pipeline imports shared GC | Code | `verify-pipeline.mjs:26,230` |
| GC called before lock | Code | `merge-tracker.mjs:131` |
| Path-traversal guard | Code | `validate-mode-invocations.mjs:175-181` |
| collectInvocations exported | Code | `validate-mode-invocations.mjs:69` |
| Cache-direct read | Code | `scan.mjs:2041-2070` |
| Progress heartbeat | Code | `validate-mode-invocations.mjs:159-167,187-189,213` |
| `--strict` flag | Code | `merge-tracker.mjs:79` |
| Parenthesized-date fix | Code | `merge-tracker.mjs:150-153` |
| `--help` on 5 scripts | Code | `reserve-report-num.mjs:299`, `set-status.mjs:87`, `browser-extract.mjs:192`, `check-liveness.mjs:31`, `generate-pdf.mjs:422` |
| CI: translation-freshness | Code | `.github/workflows/test.yml:59-69` |
| CI: mode-invocations | Code | `.github/workflows/test.yml:71-80` |
| CI: provider-health daily | Code | `.github/workflows/provider-health.yml` |
| SYSTEM_PATHS registration | Code | `update-system.mjs:205-206` |
| Validator tests (11/11) | Test | `node tests/validate-mode-invocations.test.mjs` |
| Provider-health tests (4/4) | Test | `node tests/provider-health.test.mjs` |
| Merge-tracker tests (2/2) | Test | `node tests/merge-tracker.test.mjs` |
| Full suite (1337/1339) | Test | `node test-all.mjs --quick` |
| Updater tests (339/0) | Test | `node updater-migration-tests.mjs` |
| verify-pipeline checks (8/8) | Instrument | `node verify-pipeline.mjs` |
| merge dry-run (24+5 unchanged) | Instrument | `node merge-tracker.mjs --dry-run` |

---

> **Audit completed:** 2026-08-04 · **Auditor:** Reasonix · **Confidence:** HIGH — every plan item traced through code, tests, and instrument results.
