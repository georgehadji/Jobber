# Deep Audit — Jobber (Blind Spot Discovery)

> **Protocol:** ARCHITECTURAL REAPER V7 · **Date:** 2026-08-04
> **System:** Jobber — AI-powered job search CLI (Node.js ESM, local-first, no server)
> **Epistemic protocol:** EGFV — [VERIFIED], [ΕΙΚΑΣΙΑ], [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ]

---

## Input Declaration

| Input | Status |
|-------|--------|
| Source code | ✅ Full repo (124 `.mjs`, 74 providers, 42 modes, 21 translation dirs, 110 tests) |
| Architecture diagrams | ✅ `ARCHITECTURE.md`, `docs/ARCHITECTURE.md` |
| CI/CD config | ✅ 16 GitHub Actions workflows |
| Dependency manifests | ✅ `package.json` (4 runtime + 4 dev) |
| Logs / metrics | ❌ [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ] — CLI tool, no telemetry infrastructure |
| Interview with developer | ❌ [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ] |
| README / docs | ✅ `AGENTS.md`, `DATA_CONTRACT.md`, `.healing/runbook.md` |

## Audience

**Tech Lead** — full technical depth. Security-relevant findings in Part 5 are also flagged for **Security Officer**.

## Scope

All 10 parts assessed. Parts 1 (temporal), 3 (observability), 7 (failure handling), 8 (concurrency) are adapted to the CLI-tool context — findings where applicable, `N/A — CLI tool` where not.

---

## Pre-Analysis: Meta-Checks

1. **Ανάστροφη αιτιότητα:** The "flat root" (124 scripts at root) looks like disorganization but is a documented architectural decision [VERIFIED — `ARCHITECTURE.md:27-29`]. I must not flag it as a finding.
2. **Επιβεβαιωτική προκατάληψη:** I checked whether the tracker lock actually prevents lost updates on Windows — the concurrent test was failing (FC-001). The architecture responds correctly (lock serializes), but the filesystem (FAT/exFAT) violates the assumption. Finding confirmed with platform guard.
3. **Άγνοια άγνοιας:** I cannot see the user's actual `data/` files (cv.md, applications.md, pipeline.md) — they contain PII and are gitignored. Some tracker-integrity findings depend on file shape I cannot verify. [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ]
4. **Survivorship bias:** The `writeFileAtomic` + `renameSync` pattern has worked for the original author (740+ evaluations on macOS/Linux). The Windows FAT/exFAT non-atomicity never manifested because the primary deployment is POSIX. FC-001 caught this via CI matrix.
5. **Blast Radius Map:**
   - `tracker-utils.mjs` → 8 importers (merge-tracker, set-status, stats, analyze-patterns, funnel-velocity, company-history, verify-pipeline, tracker). If `readTrackerSafe` has a bug, all 4 reader scripts + verification are affected.
   - `tracker-parse.mjs` → 12 importers. If column detection breaks, every tracker reader returns wrong data.
   - `lib/llm-providers.mjs` → 4 importers (gemini, ollama, openai, openrouter). Wrong model defaults break all LLM evaluation paths.
   - Provider registry (`providers/_registry.mjs`) → 2 importers (scan.mjs, verify-portals.mjs). Failure = scan silently returns 0 results.

---

## Part 1: Χρονική Συμβατότητα

| # | Εύρημα | Τοποθεσία | Σενάριο Αστοχίας | Severity | Confidence |
|---|--------|-----------|-----------------|---------|------------|
| T-01 | Report filenames use local date (`new Date().toISOString().split('T')[0]`), not UTC. On a machine with clock set to a different timezone, reports get wrong-date filenames. | `gemini-eval.mjs:410`, `ollama-eval.mjs:341`, `openai-eval.mjs:392` | User in UTC+12 runs evaluation at 23:30 local on Jan 1; report gets `Jan 1` date but it's already Jan 2 in UTC. Cross-timezone collaboration sees date-mismatched reports. | **P3** | HIGH |
| T-02 | `SENTINEL_MAX_AGE_MS = 4 * 60 * 60 * 1000` (4 hours) — reservation sentinels GC'd based on local system clock. If the clock jumps backward (NTP correction, DST), a 3.5h-old sentinel could be GC'd as 5h-old. | `tracker-utils.mjs:395` | Report number reservation released prematurely → two evaluators get the same number → report collision. | **P2** | MEDIUM |
| T-03 | No timeout on `browser-extract.mjs` Playwright navigation (defaults to Playwright's 30s). Very slow job boards can hang the extraction indefinitely. The `--timeout` flag exists but is optional — modes call `node browser-extract.mjs <url>` without it. | `browser-extract.mjs:140-142`, modes use `node browser-extract.mjs <url>` without `--timeout` | AI evaluation session hangs for 30s on a slow ATS page. | **P2** | HIGH |

**Adapter note:** T-01/T-02 are inherent to a local-first CLI tool — there's no server clock to standardize against. NTP drift is the user's responsibility. T-03 could benefit from a default timeout in the mode instructions.

---

## Part 2: Σχεδιαστικές Αποφάσεις Που Μοιάζουν Με Bugs

| # | Λειτουργία | Απόφαση | Τεκμηριωμένο | Ρίσκο αν Παραβιαστεί | Severity | Confidence |
|---|-----------|---------|-------------|---------------------|---------|------------|
| D-01 | `merge-tracker.mjs` merge is idempotent (same TSV re-run → duplicate detected, skipped) | Per-plan: merge-tracker deduplication by company+role+report# | **Ναι** — documented in header comment | Duplicate tracker rows if TSV format changes break dedup detection | **P2** | HIGH |
| D-02 | `writeFileAtomic` in `tracker-utils.mjs` uses `writeFileSync(tmp) + renameSync(tmp, target)` | Per-architecture: Markdown files are canonical; SQLite is derived | **Ναι** — `ARCHITECTURE.md:23-25` | Windows FAT/exFAT: `renameSync` is not atomic over an existing target. A concurrent reader can see a truncated/empty file. **T5's `readTrackerSafe()` mitigates reader-side** with retry. | **P2** (mitigated) | HIGH |
| D-03 | `check-translation-freshness.mjs` exits `process.exit(0)` at module top — not import-safe. Any script that imports it is killed before its own code runs. | Deliberate: "Exit code is always 0 (soft)" — it's a standalone CLI, not a library | **Ναι** — documented in header | `stamp-translations.test.mjs` must spawn it as a child process instead of importing `checkTranslations()` directly. The exported functions are unreachable in-process. | **P3** | HIGH |
| D-04 | `ollama-eval.mjs` and `openai-eval.mjs` do NOT write tracker TSVs or call `merge-tracker.mjs` — they only print the tracker entry. `gemini-eval.mjs` writes TSVs and merges. | Unknown — [ΕΙΚΑΣΙΑ] the ollama/openai evaluators were built as lightweight alternatives and tracker integration was deferred | **Όχι** | User evaluates with ollama, expects the tracker to be updated, but the row only prints to stdout. Must manually add it. Inconsistency across evaluators. | **P2** | HIGH |

---

## Part 3: Παρατηρησιμότητα & Κόστος

**N/A — CLI tool, no server process. Adapted findings:**

| # | Pillar | Current State | Gap | Impact | Severity | Confidence |
|---|--------|-------------|-----|--------|---------|------------|
| O-01 | Alerting | `provider-health.mjs` daily CI workflow probes ATS APIs. `verify-pipeline.mjs` checks tracker integrity. `validate-mode-invocations.mjs` checks mode↔script references. | No dead man's switch — if the daily provider-health CI silently stops running (e.g., workflow disabled), nobody is alerted. | ATS API going down is discovered only when the user manually runs `scan.mjs --health-check` and sees a degraded provider. | **P2** | HIGH |
| O-02 | Logging | No structured logging. Scripts use `console.log`/`console.warn`/`console.error` with emoji prefixes. | No machine-parseable log format. No correlation IDs across spawned processes (test-runner spawns children; batch-runner spawns workers). | Debugging a batch run with 50 parallel workers requires grepping emoji-prefixed log lines — no per-worker tracing. | **P3** | HIGH |
| O-03 | Metrics | `stats.mjs` provides pipeline roll-up (counts per status, scan totals, follow-up compliance). `provider-health.mjs` reports API health. | No historical metrics database. Each stats run is a point-in-time snapshot. Cannot answer "what was my interview rate 3 months ago?" | Trend analysis requires manual snapshot archiving. | **P3** | HIGH |

---

## Part 4: Ανθρώπινοι Παράγοντες

| # | Περιοχή | Κενό | Επίπτωση | Severity | Confidence |
|---|---------|------|----------|---------|------------|
| H-01 | Error messages | No unique, searchable error codes. Errors are prose strings: `"❌ Gemini API error: [REDACTED]"`. | A user searching for their error finds 0 results in the repo or on StackOverflow. Each error is a unique snowflake. | **P3** | HIGH |
| H-02 | Knowledge concentration | `tracker-utils.mjs` (422 lines) — the lock, atomic write, safe read, status resolution, and sentinel GC all live here. `tracker-parse.mjs` (360 lines) — column detection, score/status resolution, row parsing. | If the author leaves, the tracker subsystem (the heart of the pipeline) has a bus factor of 1. The logic is well-commented but dense. | **P2** | HIGH |
| H-03 | Onboarding | `AGENTS.md` has an onboarding wizard (Steps 0–6 in doctor.mjs). `.healing/runbook.md` covers testing and healing loops. | No "contributing your first provider" walkthrough. `providers/README.md` exists but references internal conventions (`_http.mjs`, `_registry.mjs`) that a new contributor must reverse-engineer. | New provider contributions are harder than they need to be. | **P3** | MEDIUM |
| H-04 | Documentation staleness | `ARCHITECTURE.md` references ~70 root scripts; the count is now 124. The "Component map" diagram hasn't been updated for `test-runner.mjs`, `eval-runner.mjs`, `stamp-translations.mjs`, or `.healing/`. | A new developer reading ARCHITECTURE.md gets an incomplete picture. | **P3** | HIGH |

---

## Part 5: Ασφάλεια Πέρα Από Το Προφανές

| # | Εύρημα | STRIDE | Attack Vector | Current Control | Gap | Severity | Confidence |
|---|--------|--------|--------------|----------------|-----|---------|------------|
| S-01 | `GEMINI_API_KEY` / `OPENAI_API_KEY` are read from `.env` via `dotenv`. If `.env` is accidentally committed (it's gitignored but not in `.gitignore`-enforced CI), API keys leak. `.github/workflows/no-user-data.yml` blocks `data/` and `config/` but not `.env`. | Information Disclosure | PR adds `.env` with real keys → CI passes → keys are in git history forever | `.gitignore` entry for `.env` | `.github/workflows/no-user-data.yml` does not block `.env`. The `.gitignore` prevents `git add` but doesn't prevent `git add -f`. | **P1** | HIGH |
| S-02 | `ollama-eval.mjs:156-175` has a **loopback guard** — refuses remote endpoints unless `OLLAMA_ALLOW_REMOTE=1`. `openai-eval.mjs:158-195` has an **HTTPS enforcement** guard — refuses non-HTTPS remote endpoints. `gemini-eval.mjs` has **neither** — it uses the Google SDK which defaults to `generativelanguage.googleapis.com` (always HTTPS, always remote), but no explicit guard validates this. | Information Disclosure | Man-in-the-middle intercepts Gemini API traffic if the SDK ever connects to a non-HTTPS endpoint (unlikely with Google's SDK, but the guard is absent while the other two evaluators have one) | Google SDK defaults to HTTPS | Guards are asymmetric across the three evaluators — inconsistency in defense-in-depth | **P3** | HIGH |
| S-03 | `providers/` contains 74 adapters that fetch from public ATS APIs. No adapter validates TLS certificates or checks for redirect-to-http. The `_http.mjs` helper uses native `fetch` with `redirect: 'follow'` — a malicious redirect could send the scan request (including the user's IP) to an attacker-controlled server. | Tampering | A compromised DNS returns an attacker IP for `boards-api.greenhouse.io` → `_http.mjs:55` follows the redirect → scan data leaks | `fetch` validates TLS by default | No explicit redirect chain validation; `redirect: 'follow'` follows any redirect silently | **P2** | MEDIUM |
| S-04 | `reserve-report-num.mjs` allocates report numbers using `O_CREAT|O_EXCL` sentinel files under `reports/`. The sentinel GC uses `mtimeMs` (filesystem timestamp) to determine staleness. An attacker with filesystem write access could `touch` a sentinel to make it appear fresh, permanently occupying a report number. | Denial of Service | Attacker with write access to `reports/` touches sentinels hourly → all numbers occupied → evaluations can't save reports | File permissions (user's machine) | No integrity check on sentinel content — only mtime is checked | **P3** | LOW |

---

## Part 6: Διαχείριση Δεδομένων

| # | Περιοχή | Current Behavior | Risk | Severity | Confidence |
|---|---------|-----------------|------|---------|------------|
| DM-01 | Soft vs Hard Deletes | **All deletes are hard.** `rmSync` on sentinels (reserve-report-num, gcStaleSentinels), `rmSync` on lock dirs, `unlinkSync` on stale files. Applications in the tracker are never truly deleted — status transitions to `Rejected`/`Discarded`/`Hired`. The tracker itself is the soft-delete layer. | Accidental `rm -rf reports/` loses all evaluation reports permanently. No recycle bin, no backup mechanism. | **P2** | HIGH |
| DM-02 | Migration Safety | The `update-system.mjs` self-updater fetches new system files and checks out `SYSTEM_PATHS` from upstream. It backs up before applying. `updater-migration-tests.mjs` tests the upgrade path. | A botched update that corrupts a system file (e.g., `merge-tracker.mjs`) is recoverable via `rollback`. But a user who doesn't know about rollback might lose functionality until they manually repair. | **P3** | HIGH |
| DM-03 | Data Retention | User-layer files (`data/`, `reports/`, `jds/`) are never touched by the updater. The user controls retention. No automated cleanup of old reports. | A user with 500+ evaluations accumulates ~500 report files and a growing tracker. No mechanism suggests archiving or pruning. Performance impact is minimal (Markdown files are tiny), but navigability degrades. | **P3** | HIGH |

---

## Part 7: Αντιμετώπιση Αστοχίας Σε Βάθος

| # | Σενάριο | Trigger | Detection | Behavior | Severity | Confidence |
|---|---------|---------|-----------|----------|---------|------------|
| F-01 | **Retry storms** | The batch runner (`batch/batch-runner.sh`) spawns N parallel workers. `reserve-report-num.mjs` allocates numbers atomically. No retry mechanism exists at the worker level — if a worker's LLM call fails, the worker exits with an error and the batch runner marks it failed. **No exponential backoff retry.** | The `--replay` mechanism in `eval-golden.mjs` allows re-running failed evaluations. The batch-runner itself does not retry — it's single-pass. | **P2** — a single transient API error loses one evaluation slot. Acceptable for a free-tier local tool. | HIGH |
| F-02 | **Resource exhaustion** | `test-runner.mjs --parallel N` spawns N child Node processes. No `os.cpus()` cap. `--parallel 999` on a 2-core machine spawns 999 children competing for CPU. | No guard — the user can specify arbitrarily high parallelism. | **P3** — the user owns the machine; over-provisioning hurts only themselves. But a CI runner with `--parallel 999` could OOM and crash the CI job. | HIGH |
| F-03 | **Partial success** | `merge-tracker.mjs` in `--strict` mode rejects the entire batch on any malformed TSV. Default mode skips bad TSVs with warnings and merges the rest. Both behaviors are explicit and documented. | Clear — the user sees exactly what merged and what was skipped. No silent partial merge. | **P2** — `--strict` mode means one bad TSV blocks 28 good ones until manually fixed. Default mode is the safer default. | HIGH |
| F-04 | **Provider API failure** | `provider-health.mjs` canary probes APIs. `scan.mjs` reports per-provider results but continues scanning other providers. A down provider means 0 results from that ATS — the user discovers this via the scan summary line (`"0 jobs"` for that company). | Detection is passive — the user must notice the gap. The daily CI workflow provides active monitoring but only for 5 major ATS vendors, not all 74. | **P3** — affects scan completeness, not data integrity. The user can re-scan later. | HIGH |

---

## Part 8: Concurrency & Distributed State

| # | Εύρημα | Τοποθεσία | Σενάριο Αστοχίας | Severity | Confidence |
|---|--------|-----------|-----------------|---------|------------|
| C-01 | **Distributed lock** | `tracker-utils.mjs:acquireTrackerLock` — file-based lock with PID file + stale detection (10 min timeout). Used by merge-tracker, set-status, dedup-tracker, normalize-statuses. | Process dies holding the lock → lock dir persists with dead PID → next acquirer waits `staleMs` (10 min) before reclaiming. During those 10 minutes, all tracker writes are blocked. | **P2** — the 10-minute recovery window is acceptable for a single-user CLI tool. In a CI/batch context with rapid merges, 10 minutes is an eternity. | HIGH |
| C-02 | **Optimistic vs Pessimistic** | Merge-tracker uses **pessimistic** locking (acquire before read-modify-write). Reader scripts (stats, analyze-patterns) use **no lock** — they read the file directly. T5's `readTrackerSafe()` adds a one-retry validation but doesn't acquire the lock. | A reader running during a merge sees either old data (before merge) or new data (after merge) — never partial, thanks to `writeFileAtomic` on POSIX. On Windows FAT/exFAT: `renameSync` is NOT atomic, so a reader can see a truncated file. `readTrackerSafe` catches this with header+separator validation and retries once. | **P2** (mitigated) — T5 reduces the blast radius to one retry. The remaining risk is the second read also hitting the mid-write window (very unlikely — the rename completes in microseconds). | HIGH |
| C-03 | **Configuration drift** | `config/profile.yml` is user-layer (never auto-updated). System-layer configs are `templates/states.yml`, `portals.example.yml`. The updater only touches `SYSTEM_PATHS`. | A user who edits `portals.yml` (user-layer) and then copies `templates/portals.example.yml` (system-layer) over it loses their customizations. The updater won't overwrite `portals.yml` (it's in USER_PATHS), but a manual copy will. | **P3** — user error, not a code bug. The two-layer contract is well-documented in `DATA_CONTRACT.md`. | HIGH |

---

## Part 9: Εξαρτήσεις Και Εφοδιαστική Αλυσίδα

| # | Dependency | Version | License | CVE | Maintenance | Blast Radius | Severity |
|---|-----------|---------|---------|-----|------------|-------------|---------|
| D-01 | `@google/generative-ai` | 0.24.1 | Apache-2.0 | 1 (npm audit) [VERIFIED] | Active (Google) | `gemini-eval.mjs` — all Gemini evaluations | **P2** |
| D-02 | `playwright` | 1.62.0 | Apache-2.0 | 0 | Active (Microsoft) | `generate-pdf.mjs`, `check-liveness.mjs`, `browser-extract.mjs`, `scan-interamt.mjs` — PDF generation, liveness checks, browser extraction, Interamt scanning | **P2** |
| D-03 | `js-yaml` | 4.1.1 | MIT | 0 | Active | All YAML config loading (portals.yml, profile.yml, states.yml, templates) — 38 references across the codebase | **P1** — if this package breaks, the entire scanner/config system stops |
| D-04 | `dotenv` | 17.0.0 | BSD-2-Clause | 0 | Active | 16 references — environment variable loading for API keys | **P2** |

**Left-pad risk:** All 4 runtime dependencies are from major organizations (Google, Microsoft, Node community). The risk of a left-pad-style takedown is LOW. The npm registry is the single point of failure — no mirror/cache configured. [VERIFIED — no `npm config get registry` override in CI or Dockerfile]

**Vendor lock-in:** The only Google-specific dependency is `@google/generative-ai`. `openai-eval.mjs` and `ollama-eval.mjs` use raw `fetch` — provider-agnostic. Switching from Gemini to another provider requires adding one evaluator (the pattern is established). **Lock-in: LOW** [VERIFIED]

---

## Part 10: Απόδοση Που Δεν Φαίνεται Στο Profiler

| # | Πρόβλημα | Τοποθεσία | Μηχανισμός | Επίπτωση | Severity | Confidence |
|---|---------|-----------|-----------|----------|---------|------------|
| P-01 | **Connection management** | `providers/_http.mjs:50-55` — `fetchWithTimeout` creates a new `AbortController` per request but does not reuse connections. Node's native `fetch` uses a global connection pool by default (no explicit pooling config). | No explicit `keepAlive` or connection reuse tuning. For the scanner (which makes 1 request per company, serial), this is fine. For `scan-ats-full.mjs` (which can query hundreds of companies), connection reuse matters. | **P3** — impact is limited to scan runtime (a few extra milliseconds per request for TLS handshake). The scanner is not a high-throughput service. | MEDIUM |
| P-02 | **Orphaned file handles** | `check-liveness.mjs:82-84` — browser launch via `ensureBrowser()`. If the process is killed during a liveness check (Ctrl+C), the Playwright browser process may not be cleaned up. The `finally` block at the bottom closes the browser, but SIGKILL bypasses `finally`. | Zombie Chromium processes accumulate on the user's machine after repeated Ctrl+C during liveness checks. | **P3** — the user can `pkill chromium`. Not data-loss. | HIGH |
| P-03 | **Synchronous logging** | All scripts use synchronous `console.log`. No async logging, no buffering. | For a CLI tool, this is normal and expected. The only scenario where it matters: `scan.mjs` with `--verbose` could spend measurable time on console I/O for thousands of job listings. | **P3** — cosmetic, user-facing CLI. | HIGH |

---

## Executive Summary

### Top 5 Critical Findings

| # | ID | Finding | Severity | Blast Radius |
|---|----|---------|----------|-------------|
| 1 | **S-01** | `.env` with API keys is not blocked by CI gate — `git add -f .env` bypasses `.gitignore` | **P1** | API key leak into git history |
| 2 | **D-04** | ollama/openai evaluators do not write tracker TSVs or merge — inconsistent with gemini | **P2** | User confusion, tracker gaps |
| 3 | **C-01** | Tracker lock stale recovery is 10 minutes — blocks all writes if a process crashes holding the lock | **P2** | Batch/CI merge pipeline stalls for 10 min |
| 4 | **D-02** | `writeFileSync` + `renameSync` is not atomic on Windows FAT/exFAT — mitigated by T5's `readTrackerSafe()` retry | **P2** | Reader sees truncated tracker snapshot |
| 5 | **T-02** | Reservation sentinel GC uses local system clock — NTP correction or DST jump could prematurely GC a sentinel | **P2** | Report number collision |

### Single Point of Failure
**`tracker-utils.mjs`** — the lock, atomic write, safe read, status resolution, and sentinel GC are all here. A bug in any of these functions affects every tracker operation (merge, status set, dedup, normalize, stats, analysis, verification).

### First 3AM Alert Prediction
**`S-01` — leaked API keys.** A contributor accidentally commits `.env` with a real `GEMINI_API_KEY`. The `.gitignore` prevents `git add .` but not `git add -f .env`. CI passes (the `no-user-data.yml` workflow doesn't block `.env`). The key is now in git history. Google's key rotation is manual. The user discovers it when their quota is exhausted by an attacker.

### One Change → Maximum Reliability
**Add `.env` to the `no-user-data.yml` CI workflow's USER_PATHS regex.** This prevents the most likely P1 scenario with a one-line CI change. The blast radius is zero — it only blocks PRs that accidentally include the secrets file.

---

### Severity Summary

| Part | P0 | P1 | P2 | P3 | Confidence Avg |
|------|----|----|----|-----|---------------|
| 1. Temporal | — | — | 2 (T-02, T-03) | 1 (T-01) | HIGH |
| 2. Design Decisions | — | — | 2 (D-01, D-04) | 1 (D-03) | HIGH |
| 3. Observability | — | — | 1 (O-01) | 2 (O-02, O-03) | HIGH |
| 4. Human Factors | — | — | 1 (H-02) | 3 (H-01, H-03, H-04) | HIGH |
| 5. Security | — | 1 (S-01) | 1 (S-03) | 2 (S-02, S-04) | HIGH |
| 6. Data Management | — | — | 1 (DM-01) | 2 (DM-02, DM-03) | HIGH |
| 7. Failure Handling | — | — | 1 (F-01) | 1 (F-03) | HIGH |
| 8. Concurrency | — | — | 2 (C-01, C-02) | 1 (C-03) | HIGH |
| 9. Dependencies | — | 1 (D-03) | 3 | — | HIGH |
| 10. Performance | — | — | — | 3 | HIGH |
| **TOTAL** | **0** | **2** | **14** | **16** | **HIGH** |

### Ship Decision: **CONDITIONAL**

P1 items exist with mitigations. The `.env` CI gate (S-01) should be added before the next release to prevent the most likely accident. The `js-yaml` dependency risk (D-03) is inherent to any YAML-based config system — acceptable with active maintenance. No P0 items — no data loss, no security breach, no service-down risks.

---

### Uncertainty Register

1. **Top 3 claims most likely to be wrong:**
   - [ΕΙΚΑΣΙΑ] T-02 clock-jump sentinel GC — I assume NTP can jump backward by hours; on modern NTP this is typically < 1s. [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ] — need a real-world NTP drift measurement on the user's OS.
   - [ΕΙΚΑΣΙΑ] S-03 redirect-chain validation — I assume `fetch` validates TLS on redirects. This is correct per the Fetch spec but I haven't verified it on the user's Node version with their CA bundle. [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ] — need the user's Node environment.
   - [ΕΙΚΑΣΙΑ] D-04 ollama/openai tracker inconsistency — I assume it's deferred, not a bug. The original author may have intended gemini as the primary evaluator and ollama/openai as quick-look alternatives. [ΔΕΔΟΜΕΝΟ ΕΛΛΙΠΕΣ] — need developer intent.

2. **Requires runtime validation:**
   - Windows FAT/exFAT `renameSync` atomicity for `writeFileAtomic` — static analysis says it's non-atomic; a stress test with 100 concurrent merges would confirm.
   - Browser orphan cleanup on SIGKILL — need to test with actual `kill -9` and count zombie Chromium processes.

3. **[ΕΙΚΑΣΙΑ] items needing confirmation:**
   - T-02 clock-jump sentinel GC (see above)
   - D-04 ollama/openai tracker intent (see above)
   - F-02 parallel over-provisioning impact on CI runner memory
