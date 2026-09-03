# Defect-Hunt Ledger

Append-only record of every candidate investigated under `docs/DEFECT-HUNT-PLAN.md`. IDs are `B<batch>-D<n>`, globally unique, never reused. `FALSE` rows are permanent — a later batch that rediscovers the same location cites the row here and moves on rather than re-running the trigger.

---

## Batch 1 — Tracker & lock core — 2026-09-02 — PARTIAL

Baseline: 3525 passed / 0 failed / 1 warning (`node test-all.mjs --quick`, pre-existing Windows rename-atomicity skip in the concurrent-writes test — expected, not a finding).
Budget: 1 confirmed / 12 allocated. Time-boxed close, not budget exhaustion — see Coverage below.

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B1-D1 | `merge-tracker.mjs:141` (module top-level, pre-lock) | error & exception paths / documented-contract violation | `--dry-run` must perform zero writes — merge-tracker gates every other mutation in the file behind `!DRY_RUN` (7 other gates) except this one | FIRED — executed trigger (below) | NO-DEFENSE — unconditional call, no guard, reachable on every invocation | **VERIFIED DEFECT** | [PR #25](https://github.com/georgehadji/Jobber/pull/25) |
| B1-C1 | `lib/file-lock.mjs` recover-guard staleness (`lockCanRecover(recoverGuardDir, staleMs)`) | resource lifecycle / concurrency | none — reasoned through, not tested | not attempted | design tradeoff, explicitly acknowledged in the module's own comment (`OWNERLESS_GRACE_MS` doc, lines 85-97): "a crash while holding the guard cannot disable recovery for good" | FALSE (innocent) — deliberate, documented conservative choice, not a defect | — |
| B1-C2 | `tracker-utils.mjs:gcStaleSentinels` vs `reserve-report-num.mjs:gcStaleReportReservations` | contract / dependency (duplicate implementations of "the same" GC, per the file's own docstring, with divergent behavior) | `gcStaleSentinels` has no PID-liveness check before deleting a >4h-old sentinel; `gcStaleReportReservations` does | not attempted — requires a >4h-alive process to manifest, out of trigger-test reach within this session | partial — the age threshold (4h) makes the window narrow, and `reserve-report-num.mjs`'s own `--gc` CLI path already has the correct check | **SUSPECTED (HYPOTHESIS)** — real inconsistency, unconfirmed real-world impact | not fixed — candidate for a follow-up session |
| B1-C3 | `dedup-tracker.mjs:270-280,423-435` dry-run gating | error & exception paths | `--dry-run` performs zero writes | not run (code-read only) | CODE-INNOCENT — `mkdirSync` before the gate is directory-creation only (non-destructive); the transaction, backup copy, and replace are all correctly behind `!DRY_RUN` | FALSE (innocent) | — |
| B1-C4 | `set-status.mjs:275` lock-acquisition gating | resource lifecycle | dry-run should not acquire/hold the exclusive lock | not run (code-read only) | CODE-INNOCENT — explicit design comment: "Dry-run never writes, so it must not hold the exclusive lock"; gated correctly | FALSE (innocent) | — |
| B1-C5 | `outcome.mjs:206-227` dry-run gating | error & exception paths | `--dry-run` performs zero writes/mkdir | not run (code-read only) | CODE-INNOCENT — `process.exit(EXIT_OK)` at line 224 precedes the first `mkdirSync` at line 227 | FALSE (innocent) | — |
| B1-C6 | `reconcile-pipeline.mjs:290-296` dry-run gating | error & exception paths | `--dry-run` performs zero writes | not run (code-read only) | CODE-INNOCENT — `process.exit(0)` at line 292 precedes `copyFileSync`/`writeFileSync` | FALSE (innocent) | — |
| B1-C7 | `tracker.mjs:511-520` `delete --dry-run` gating | error & exception paths | `--dry-run` performs zero writes | not run (code-read only) | CODE-INNOCENT — explicit early `return` at line 519 before `openTrackerTransaction`/`replace` | FALSE (innocent) | — |
| B1-C8 | `fix-slugs.mjs` default-dry-run gating | error & exception paths | default (no `--fix`) performs zero writes | not run (code-read only) | CODE-INNOCENT — `writeFileSync` at line 341 gated by `if (!dryRun && fixes.length > 0)` | FALSE (innocent) | — |
| B1-C9 | `sync-pdf-flags.mjs:108` dry-run gating | error & exception paths | `--dry-run` performs zero writes | not run (code-read only) | CODE-INNOCENT — `transaction.replace()` gated by `if (updated > 0 && !flags.dryRun)` | FALSE (innocent) | — |
| B1-C10 | `normalize-statuses.mjs:98,176-183` dry-run gating | error & exception paths | `--dry-run` performs zero writes | not run (code-read only) | CODE-INNOCENT — both mutation sites behind `!DRY_RUN` | FALSE (innocent) | — |
| B1-C11 | `add-entry.mjs:226` dry-run gating | error & exception paths | `--dry-run` performs zero writes | not run (code-read only) | CODE-INNOCENT — write behind `if (!dryRun)` | FALSE (innocent) | — |

### Coverage & residual risk (Batch 1)

**Surface audited:** `lib/file-lock.mjs` (full read), `pipeline-lock.mjs` (full read), `portal-health-lock.mjs` (full read), `tracker-utils.mjs` (full read), `tracker-parse.mjs` (full read), `tracker-links.mjs` (full read), `merge-tracker.mjs` (full read — top-level GC call, DRY_RUN gate structure, imports), `reserve-report-num.mjs` (full read), `fix-slugs.mjs` (full read), `sync-pdf-flags.mjs` (full read). Dry-run/write-gating swept by targeted read across `set-status.mjs`, `outcome.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`, `add-entry.mjs`, `reconcile-pipeline.mjs`, `tracker.mjs`.

**Surface NOT audited (deferred, not budget-exhausted — closing the batch early to land the confirmed fix and keep this doc actionable):**
- `dedup-tracker.mjs`, `outcome.mjs`, `set-status.mjs`, `add-entry.mjs`, `normalize-statuses.mjs`, `reconcile-pipeline.mjs`, `tracker.mjs`, `verify-pipeline.mjs` — read for the dry-run/write-gating class only; NOT hunted for boundary, concurrency, or trust-boundary classes at function granularity.
- `verify-pipeline.mjs` Checks 1-7, 9-12 (only Check 8's sentinel-GC call was inspected).
- Interaction between `reserve-report-num.mjs`'s sentinel reservation and a real `generate-pdf.mjs`/report-writing script's non-locked write to `reports/NNN-*.md` — not traced end to end.

**Defect classes covered:** error & exception paths (dry-run/write-gating contract) — thoroughly, across every batch-1 writer. Resource lifecycle — partially (`lib/file-lock.mjs` fully reasoned, one design tradeoff recorded as innocent). Contract/dependency — one real inconsistency found (B1-C2), unconfirmed.

**Confirmed defects:** CRITICAL 0 / HIGH 0 / MEDIUM 1 (B1-D1) / LOW 0.
**Cleared (innocent):** 9 (B1-C1, C3-C11).
**Residual SUSPECTED:** 1 (B1-C2 — `gcStaleSentinels` missing PID-liveness check present in its sibling implementation).
**Residual UNKNOWN:** 0.

**Clean-claim, scoped:** The dry-run/write-gating contract was audited across all 11 write-capable scripts in the tracker & lock core, and exactly one violation was found and fixed (B1-D1). The lock implementation (`lib/file-lock.mjs`) was read in full and no VERIFIED defect was found in its acquire/release/stale-recovery logic. This is NOT a claim that tracker.mjs, verify-pipeline.mjs, or the other partially-read files are defect-free outside the one class hunted.

**Highest-value next hunt:** B1-C2 (the `gcStaleSentinels`/`gcStaleReportReservations` PID-liveness inconsistency) — needs a real trigger with a long-lived child process to confirm impact, or a decision to unify the two GC implementations into one (the module's own docstring already claims they're unified; they aren't). Second: function-granularity concurrency/boundary hunting of `set-status.mjs`, `tracker.mjs`, and `verify-pipeline.mjs`, none of which received more than a dry-run-gate read this batch.

---

## Batch 2 — Updater & layer boundary — 2026-09-02 — PARTIAL

Baseline: 3525 passed / 0 failed / 1 warning on clean `main` (same baseline as batch 1 — batch 1's fix is not yet merged). Post-fix full run: 3529 passed / 0 failed / 1 warning (+4, the new `resolveSunsetAfterDays` assertions).
Budget: 1 confirmed / 10 allocated. Time-boxed close.

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B2-D1 | `sunset.mjs:60` (`sunsetAfterDays = Number(profile.sunset_after_days ?? 45) \|\| 45`) | boundary & arithmetic (`??` vs `\|\|` footgun on the zero boundary) | A configured `sunset_after_days` value must be honored as documented ("Threshold: `sunset_after_days` in config/profile.yml (default 45)") — the `??` already correctly distinguishes "missing" from "present", but the trailing `\|\| 45` re-applies the fallback to the one falsy-but-valid number, 0 | FIRED — isolated reproduction of the exact expression (below); repo-wide grep confirmed this is the only instance of the `?? x) \|\| x` pattern | NO-DEFENSE — no validation rejects 0, no code path treats it specially, reachable on every `sunset.mjs` invocation once a user sets the value | **VERIFIED DEFECT** | this batch's branch (`hunt/batch-2-updater-layer-boundary`); extracted into a new exported `resolveSunsetAfterDays()` in `lib/sunset-policy.mjs` |
| B2-C1 | `update-system.mjs` `apply()` re-exec + `initialStatusPaths` interaction | resource lifecycle / contract | Reasoned candidate: the re-exec'd child computes `initialStatusPaths` AFTER the parent's pre-reexec `git checkout FETCH_HEAD -- reexecFiles`, so those files could be wrongly treated as "pre-existing dirt" and protected from a later rollback's cleanup | not attempted — narrow (only matters mid-rollback after a re-exec) | CODE-INNOCENT — traced through `revertPaths()`: the main `git checkout HEAD -- path` step runs unconditionally for every path in `updated` regardless of `protectedPaths`; `protectedPaths` only gates `removeAdditionsNotInHead()`, which handles brand-new files not yet in HEAD. `update-system.mjs` and `scaffolder/bin/skill-entrypoints.mjs` both predate the update (tracked in HEAD), so the main revert path applies to them either way | FALSE (innocent) — traced, not merely asserted | — |
| B2-C2 | `check-translation-freshness.mjs` `git log -1 -- <file>` staleness computation | contract / dependency (same class as SEED-B) | Same shallow-checkout sensitivity as the already-fixed CI workflow issue | not attempted — the fix already lives at the CI-workflow level (`fetch-depth: 0`), not in this script | N/A — this script's logic was always correct; the defect was the *caller's* checkout depth, already fixed in `b74af31` | FALSE (innocent) — confirmed no second instance of the class exists in batch-2 scope | — |
| B2-C3 | `doctor.mjs` auto-create paths (`checkAutoDir`, `checkPipelineFile`, `onboardingState`'s template auto-copy) | error & exception paths | None claimed — `doctor.mjs` has no `--dry-run` flag and never claims to be non-mutating; every auto-create is create-if-absent, never an overwrite | not attempted | CODE-INNOCENT — no documented contract to violate; `existsSync` guards every write | FALSE (innocent) | — |

### Coverage & residual risk (Batch 2)

**Surface audited:** `update-system.mjs` (full read, 1387 lines — SYSTEM_PATHS/USER_PATHS/BOOTSTRAP_PATHS manifests, `apply()`/`rollback()`/`check()`/`dismiss()` control flow, `revertPaths()`/`removeAdditionsNotInHead()` rollback safety, re-exec checkout resolution), `lib/sunset-policy.mjs` (full read), `sunset.mjs` (full read), `doctor.mjs` (full read). `check-translation-freshness.mjs` swept for the SEED-B git-log-depth class specifically (not read end to end).

**Surface NOT audited:**
- `updater-migration-tests.mjs` — not read; its own test assertions were trusted rather than independently re-derived.
- `ingest-documents.mjs` — not re-audited this batch (already authored/reviewed in an earlier session; no new read).
- `check-translation-freshness.mjs` — only the git-log-depth angle was checked; not hunted for other classes.
- The `.gitignore` negation-guard logic inside `test-all.mjs` (`extractArrayFromSource` reuse) — not read this batch.
- `update-system.mjs`'s `resolveReexecCheckout()` static-import-closure walker — read, not independently stress-tested against a synthetic import graph (trusted the existing `updater-migration-tests.mjs` coverage referenced in its own comments).

**Defect classes covered:** boundary & arithmetic — one real defect found and fixed (B2-D1), plus a repo-wide grep confirming it was the only instance of that exact anti-pattern. Resource lifecycle / rollback safety — one candidate traced through to a confirmed-innocent verdict (B2-C1), not merely assumed. Contract/dependency (shallow-checkout class) — confirmed no second instance in this batch's scope (B2-C2).

**Confirmed defects:** CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 1 (B2-D1 — narrow real-world trigger condition, but a genuine documented-contract violation).
**Cleared (innocent):** 3 (B2-C1, C2, C3).
**Residual SUSPECTED:** 0.
**Residual UNKNOWN:** 0.

**Clean-claim, scoped:** `update-system.mjs`'s full read-modify-rollback lifecycle was traced for user-layer-safety and rollback-completeness defects, and none were found beyond the already-cleared B2-C1 candidate. `sunset.mjs`'s only mutable input (`sunset_after_days`) was audited end to end and its one defect fixed. This is NOT a claim that `updater-migration-tests.mjs`, `check-translation-freshness.mjs` beyond the git-log-depth angle, or `ingest-documents.mjs` are defect-free.

**Highest-value next hunt:** `update-system.mjs`'s `missingFromTargetManifest()` / re-exec checkout-closure resolution deserves a dedicated concurrency/boundary pass (two concurrent `apply()` invocations — the `.update-lock` file check has a TOCTOU window between `existsSync(lockFile)` and `writeFileSync(lockFile, ...)` that was not tested this batch). Second: `updater-migration-tests.mjs` itself, unread this batch.

---

## Seeds (pre-existing, recorded before batch 1 — see docs/DEFECT-HUNT-PLAN.md §6)

| ID | Location | Status | Note |
|----|----------|--------|------|
| SEED-A | `lib/robots.mjs` `gate()` cache | VERIFIED, unfixed | Origin-keyed cache conflates per-path verdicts. Zero production callers today (`update-system.mjs:147` is a SYSTEM_PATHS manifest entry, not an import) — LOW now, HIGH once wired into `providers/_http.mjs`. Belongs to batch 4. |
| SEED-B | `.github/workflows/test.yml` shallow checkout | VERIFIED, FIXED (`b74af31`, pre-dates this plan) | `git log -1 -- <file>` staleness checks broke under depth-1 checkout. Batch 2 checked `check-translation-freshness.mjs` for a second instance of the class (B2-C2) — none found; no other `git log`/`git rev-list`-dependent module encountered in batches 1-2. |
