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

## Batch 3 — Plugin trust boundary — 2026-09-02 — PARTIAL

Baseline: 3525 passed / 0 failed / 1 warning on clean `main` (same baseline as batches 1-2 — neither is merged yet). Post-fix full run: 3527 passed / 0 failed / 1 warning (+2, the new gmail dry-run assertions).
Budget: 1 confirmed / 10 allocated. Time-boxed close.

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B3-D1 | `plugins/gmail/index.mjs` `ingest()`, final `saveProcessedIds(processedIds)` call | error & exception paths / documented-contract violation (same class as B1-D1) | `ctx.dryRun` must be a preview — the sibling `notion` plugin's `export` hook explicitly checks `ctx?.dryRun` before every external write; `gmail`'s `ingest()` never checks it before persisting `data/gmail-state.json`, its own processed-message-id cursor | FIRED — ran the real plugin module (`gmailPlugin.ingest(ctx)`) against a mocked `ctx.fetch` in an isolated temp cwd with `ctx.dryRun: true`; `data/gmail-state.json` was written and contained the message id | NO-DEFENSE — unconditional call, no guard, reachable on every dry-run invocation that finds any message | **VERIFIED DEFECT** | this batch's branch (`hunt/batch-3-plugin-trust-boundary`); gated behind `if (!ctx?.dryRun)` |
| B3-C1 | `plugin-audit.mjs`'s direct-`fetch()` heuristic (`/(?<![.\w$])fetch\s*\(/`) | trust boundary / static-analysis gap | The negative lookbehind excludes any `<ident>.fetch(` from the finding — so `globalThis.fetch(...)` or `window.fetch(...)` evades the "direct global fetch() — use ctx.fetch" flag, bypassing the SSRF/allowedHosts guard undetected | not attempted — the file's own header comment already discloses this scope: "a STATIC heuristic, not containment... a determined attacker can obfuscate" | DOCUMENTED LIMITATION — the module explicitly disclaims general evasion resistance; this is exactly the class of obfuscation it says it doesn't catch, not an unstated gap | FALSE (innocent) — real gap, but within the file's own honestly-scoped disclaimer | — |
| B3-C2 | `plugins.mjs` `cmdEnable`/`cmdTrust`/`cmdRemove`/`cmdAdd` writes to `config/plugins.yml` and `plugins.lock` | resource lifecycle / concurrency | No shared cross-process lock (unlike `lib/file-lock.mjs` on the tracker) around these writes — two concurrent `plugins.mjs enable`/`add` invocations could race | not attempted — `plugins.mjs` is a manual, single-operator CLI, never invoked by parallel batch workers (unlike the tracker) | design-scope — no concurrent-writer scenario exists for this CLI today; the tracker's locking exists because `batch/` runs N parallel workers, which plugins.mjs has no equivalent of | FALSE (innocent) — no reachable concurrent caller in this codebase | — |
| B3-C3 | `plugin-install.mjs` `installFromRepo()` — `existsSync(dest)` check, then a slow `safeClone()`, then `cpSync` | resource lifecycle / TOCTOU | Same shape as B3-C2: a second `add <id>` for the same id started during the first's clone would also pass the `existsSync` guard | not attempted — same manual-CLI reasoning as B3-C2 | design-scope — no automated concurrent caller | FALSE (innocent) | — |

### Coverage & residual risk (Batch 3)

**Surface audited:** `plugins/_engine.mjs` (full read — manifest validation, `discoverPlugins`, `resolveSuccessorIds`, `lockGate`, `buildCtx`/guarded-fetch, `loadPlugins`/`runHook`, `mergeProviderPlugins`), `plugins/_lock.mjs` (full read), `plugins/_net.mjs` (full read — SSRF allowlist/DNS-rebinding guard), `plugins/_registry.mjs` (full read), `plugin-install.mjs` (full read — clone-time-RCE hardening, `safeClone`/`validateInstall`/`installFromRepo`/`scaffoldNew`), `plugin-audit.mjs` (full read — static safety scan), `plugins.mjs` (full read — the CLI host, all 9 subcommands), `plugins/notion/index.mjs` + `_notion.mjs` (full read), `plugins/gmail/index.mjs` + `_helpers.mjs` (full read), `plugins/apify/index.mjs` + `_apify.mjs` (full read).

**Surface NOT audited:**
- `plugins/_template/` (`index.mjs`, `test/smoke.mjs`) — not read this batch; it's inert scaffolding until a user runs `plugins.mjs new`.
- `validate-plugin-registry.mjs` (the registry-validate CI script) — not read.
- `plugins/_types.js` — a types-only file, skipped (no runtime logic).
- End-to-end interaction between `scan.mjs`'s `mergeProviderPlugins()` call and a real `portals.yml` entry — reasoned through the code, not run against a live config.

**Defect classes covered:** error & exception paths (dry-run contract) — the class carried over from B1-D1; found a second, more severe instance (permanent silent data loss vs. B1's stale-sentinel case) in a *different* subsystem, confirming this is a recurring repo-wide pattern worth checking in every future batch that touches a `--dry-run`/`ctx.dryRun` surface. Trust boundary / static-analysis limits — one real gap found, but already within the module's own honest disclaimer (B3-C1). Resource lifecycle / concurrency — two TOCTOU-shaped candidates traced and cleared as design-scope (no concurrent caller exists for either).

**Confirmed defects:** CRITICAL 0 / HIGH 0 / MEDIUM 1 (B3-D1 — permanent, silent loss of job leads on the next real run after any dry-run preview) / LOW 0.
**Cleared (innocent):** 3 (B3-C1, C2, C3).
**Residual SUSPECTED:** 0.
**Residual UNKNOWN:** 0.

**Clean-claim, scoped:** The entire plugin engine's trust-boundary surface (manifest validation, integrity/rug-pull lock, SSRF egress guard, clone-time-RCE hardening in `plugin-install.mjs`, and the static audit scanner) was read in full and no VERIFIED defect was found beyond the one static-analysis gap already disclosed by the module itself (B3-C1). All three bundled reference plugins (gmail, notion, apify) were read end to end; the one real defect (B3-D1) was in the `ctx.dryRun` contract, not the trust/security boundary itself. This is NOT a claim that `plugins/_template/`, `validate-plugin-registry.mjs`, or a live `scan.mjs` + `portals.yml` provider-plugin run are defect-free.

**Highest-value next hunt:** `providers/` fleet itself (batch 5) should specifically re-check the `?? x) || x` boundary-arithmetic class (B2-D1's pattern) and the `ctx.dryRun`/`--dry-run` contract (B1-D1's and B3-D1's pattern) in every provider and plugin that accepts a numeric config default or exposes a dry-run mode — two confirmed hits across three batches makes this the single highest-yield repeatable check left in the plan. Second: `validate-plugin-registry.mjs`, unread this batch.

---

## Batch 4 — Provider HTTP core (resolves Seed A) — 2026-09-02 — PARTIAL

Baseline: 3525 passed / 0 failed / 1 warning on clean `main` (same baseline as batches 1-3 — none merged yet). Post-fix full run: 3526 passed / 0 failed / 1 warning (+1, the new path-conflation regression assertion).
Budget: 1 confirmed (Seed A resolved) / 12 allocated. Time-boxed close.

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B4-D1 (= SEED-A) | `lib/robots.mjs` `gate()`, the `cache.set(origin, { result, ... })` line | boundary / cache-key granularity mismatch | The cached verdict is PATH-specific (`isAllowed(groups, agent, path)`) but the cache key is origin-only — a second call for a *different* path on the same origin, inside the 15-minute TTL, wrongly reused the first path's allow/disallow verdict instead of being re-evaluated | FIRED — real `gate()` call for `/admin/secret` (Disallow'd) then `/public` (not covered) on the same origin; `/public` came back `allowed: false`, inheriting `/admin/secret`'s cached verdict | NO-DEFENSE — unconditional per-origin cache of the final decision, reachable on every second call to a distinct path on an already-cached origin | **VERIFIED DEFECT** (pre-existing finding from plan authoring, now fixed) | this batch's branch (`hunt/batch-4-provider-http-core`); cache now stores the parsed rule `groups` per origin (still one fetch per origin — the expensive part), and `isAllowed()`/the allow-decision is recomputed per path on every call, cached or not |
| B4-C1 | `providers/local-parser.mjs` `resolveCommand`/`resolveInsideRoot` argument-injection and path-escape guards | trust boundary | `parser.command`/`parser.args`/`parser.script` from a shared/template `portals.yml` must never reach an arbitrary binary or an out-of-repo path, and an interpolated `{company}`/`{careers_url}` must never be read as a CLI flag | not attempted — traced through by hand instead: an absolute out-of-repo command (POSIX or Windows-style) is caught by `resolveInsideRoot`'s `realpathSync` + prefix check; a flag-shaped `parser.script` would have to resolve to a real in-repo file to pass at all, which a portals.yml author cannot place | CODE-INNOCENT — every escape path traced ends in a thrown `Error`, not a spawn; `execFileAsync` is called with no `shell` option (argv, not a shell string) throughout | FALSE (innocent) — traced, not merely asserted | — |
| B4-C2 | `providers/_dns-cache.mjs` `createCachedLookup`'s per-key coalescing (`inflight` Map) | resource lifecycle / concurrency | A crashed/never-callback-invoking `realLookup` would leave a key's `inflight` entry (and every coalesced waiter) stuck forever | not attempted — `dns.lookup`'s C++ binding always invokes its callback exactly once (success or error), so there is no code path in Node's own contract that would leave this hanging | design-scope — depends on a guarantee from Node's own `dns.lookup` contract, not this module's logic | FALSE (innocent) — no reachable trigger within this module's own code | — |

### Coverage & residual risk (Batch 4)

**Surface audited (full read, all 10 files in this batch's scope):** `providers/_http.mjs`, `providers/_dns-cache.mjs`, `providers/_trust-validator.mjs`, `providers/_registry.mjs`, `providers/_config-utils.mjs`, `providers/_html-entities.mjs`, `providers/_profile-keywords.mjs`, `providers/local-parser.mjs`, `lib/robots.mjs`, `lib/http-errors.mjs`.

**Surface NOT audited:**
- No live end-to-end run of a real provider (e.g. `greenhouse.mjs`) through `providers/_http.mjs`'s `fetchJson`/`fetchText` against a real or mocked server — the transport helpers were read and reasoned through, not exercised via an actual provider call in this batch.
- `providers/_dns-cache.mjs`'s token-bucket pacing (`createTokenBucket`) was read and reasoned through but not driven with injected fake timers to confirm its scheduling math under load — `tests/` may already cover this (not independently re-derived here).
- `gate()` still has zero production callers (confirmed unchanged this batch — `providers/_http.mjs` does not call it). The fix makes it CORRECT for whenever it is wired in, but does not itself wire it in — that remains a separate, deliberate follow-up per the plan's own scope note for Seed A.

**Defect classes covered:** boundary / cache-key granularity — the batch's one confirmed, pre-identified defect (B4-D1/Seed A), fixed and regression-tested. Trust boundary (command execution from a semi-trusted config) — one high-value candidate (`local-parser.mjs`) traced in full, no bypass found. Resource lifecycle / concurrency — one candidate in the DNS cache traced to a Node-contract guarantee, cleared.

**Confirmed defects:** CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 1 (B4-D1 — zero production callers today, so no live scan is currently affected; severity rises to HIGH the moment `gate()` is wired into `providers/_http.mjs`'s escalation path, per the original Seed A note. Fixing it now, before that wiring, was the point).
**Cleared (innocent):** 2 (B4-C1, C2).
**Residual SUSPECTED:** 0.
**Residual UNKNOWN:** 0.

**Clean-claim, scoped:** All 10 files named in this batch's plan entry were read in full and no VERIFIED defect was found beyond the one already identified during plan authoring (Seed A/B4-D1), which is now fixed and regression-tested. `local-parser.mjs`'s command-execution trust boundary — the highest-stakes single file in this batch's scope — was traced end to end with no bypass found. This is NOT a claim that a live provider run through `_http.mjs`, or `_dns-cache.mjs`'s pacing math under real concurrency, is defect-free — neither was exercised end to end this batch.

**Highest-value next hunt:** the plan's batch 5 (provider fleet, class-sampled across ~70 adapters) should specifically re-check the `?? x) || x` boundary-arithmetic class (B2-D1) and the `ctx.dryRun`/`--dry-run` contract (B1-D1, B3-D1) — now confirmed twice across three batches, the single highest-yield repeatable check left in the plan (carried over from batch 3's note, unchanged — no new instance found this batch). Second: an actual live (or fixture-driven) end-to-end run of one provider through `providers/_http.mjs`, not yet done in this plan.

---

## Batch 5 — Provider fleet (class-sampled) — 2026-09-02 — PARTIAL

Baseline: 3525 passed / 0 failed / 1 warning on clean `main` (same baseline as batches 1-4 — none merged yet). Post-fix full run: 3529 passed / 0 failed / 1 warning (+4, the new per-provider assertions in `tests/providers/ats-ssrf-hardening.test.mjs`).
Budget: 4 confirmed (one class, 4 instances) / 15 allocated. Class-sampled per plan §4: one representative per structural family hunted fully, then the two flagged recurring classes (dry-run contract, `?? x) || x` boundary arithmetic) grepped fleet-wide.

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B5-D1 | `providers/radancy.mjs` — 3 `ctx.fetchJson`/`ctx.fetchText` call sites | trust boundary / SSRF via server-side redirect (same class as `#1440`, `tests/providers/ats-ssrf-hardening.test.mjs`'s pre-existing lever/ashby coverage) | `providers/_http.mjs`'s `fetchWithTimeout` defaults `redirect: 'follow'` when a caller omits the option; every other GET/POST provider in the fleet explicitly passes `redirect: 'error'` to block a company's server from redirecting the crawler off-host (documented inline in 7+ sibling files as "prevents SSRF via a server-side redirect") — these 4 omitted it | FIRED — spun up two real local HTTP servers (one 302-redirecting to the other, standing in for an internal/metadata endpoint) and called the real `fetchText` from `_http.mjs` exactly as each provider calls it: with no `redirect` option, the request followed the redirect and reached the "internal" server; with `redirect: 'error'` (the fix), it threw instead | NO-DEFENSE — unconditional follow, reachable on every fetch this provider makes | **VERIFIED DEFECT** | this batch's branch (`hunt/batch-5-provider-fleet`); `redirect: 'error'` added to all 3 call sites |
| B5-D2 | `providers/deutschebahn.mjs` — 1 `ctx.fetchText` call site | same class as B5-D1 | same | same trigger method, same file family (single-company HTML scraper "pattern: ibm/dassault/rheinmetall" per this file's own header comment — `ibm.mjs` and `dassault.mjs` DO pass `redirect: 'error'`; this later copy dropped it) | NO-DEFENSE | **VERIFIED DEFECT** | same branch; `redirect: 'error'` added |
| B5-D3 | `providers/rheinmetall.mjs` — 1 `ctx.fetchText` call site | same class as B5-D1 | same | same trigger method, same family | NO-DEFENSE | **VERIFIED DEFECT** | same branch; `redirect: 'error'` added |
| B5-D4 | `providers/hecklerkoch.mjs` — 1 `ctx.fetchText` call site | same class as B5-D1 | same | same trigger method, same family | NO-DEFENSE | **VERIFIED DEFECT** | same branch; `redirect: 'error'` added |

### Class-sampling results (Batch 5)

**Representative families hunted fully, no defect found beyond B5-D1..D4:** `greenhouse.mjs` (Greenhouse-shaped JSON), `lever.mjs` (Lever-shaped JSON), `ashby.mjs` (Ashby posting-API + compensation parsing), `workday.mjs` (CXS pagination/retry/early-stop — the most structurally complex file read this batch), `successfactors.mjs` (dual-transport RMK tile scrape + CSB JSON, largest file in the fleet), `dassault.mjs` and `radancy.mjs` (regex-over-HTML/XML scrapers), `arbetsformedlingen.mjs` / `apec.mjs` / `eures.mjs` (the three newest zero-key gov/EU providers added in `b31733a`, least-reviewed by wall-clock age).

**`?? x) || x` boundary-arithmetic class (B2-D1's pattern):** grepped fleet-wide (`\?\?.*\|\|` across `providers/*.mjs`) — **0 instances.** This class needs a numeric-default footgun shape that doesn't occur in provider code (providers don't compute derived numeric defaults the way `sunset.mjs` did); not a defect surface here.

**`ctx.dryRun`/`--dry-run` contract class (B1-D1's and B3-D1's pattern):** grepped fleet-wide (`dryRun|dry_run|dry-run` across `providers/*.mjs`) — **0 instances**, and structurally so: no provider in the fleet performs a write at all (`fetch()` is read-only by contract — it returns `Job[]`, the caller persists). This class has no surface in `providers/`; the write side (where B1-D1 and B3-D1 actually live) is `merge-tracker.mjs` and the plugin engine, both already covered in batches 1 and 3.

**New class found instead — missing SSRF redirect hardening:** not one of the two flagged classes, but the same discovery method (grep the established convention across the fleet, diff against who's missing it) surfaced a real, confirmed 4-instance class. `tests/providers/ats-ssrf-hardening.test.mjs` (added under `#1440`) already existed for exactly this defect shape but only ever covered `lever.mjs`/`ashby.mjs` — it was never generalized, so nothing caught the drift when `radancy.mjs`/`deutschebahn.mjs`/`rheinmetall.mjs`/`hecklerkoch.mjs` were added without it. Fixed both the 4 provider files and generalized the existing test file (same location, not a new file) to cover all 4.

**Not exhaustively swept:** the remaining ~55 providers not individually read this batch were NOT each opened — per plan §4 this batch's completeness claim is over defect classes examined (redirect hardening, dry-run contract, boundary arithmetic), not over every provider instance. The redirect-hardening grep itself (`ctx\.fetchJson\(|ctx\.fetchText\(` vs `redirect:\s*['"](?:error|manual)['"]` counts, diffed) *did* cover the full 69-file fleet mechanically, so that specific class's coverage is closer to exhaustive than the others — see below.

### Coverage & residual risk (Batch 5)

**Surface audited:** 9 providers read in full (`greenhouse.mjs`, `lever.mjs`, `ashby.mjs`, `workday.mjs`, `successfactors.mjs`, `dassault.mjs`, `radancy.mjs`, `deutschebahn.mjs`/`rheinmetall.mjs`/`hecklerkoch.mjs` as one family, `arbetsformedlingen.mjs`, `apec.mjs`, `eures.mjs`) plus a fleet-wide mechanical grep (fetch-call-site count vs. redirect-guard count, diffed per file) across all 69 non-`_` files in `providers/` for the SSRF-redirect class, and a second fleet-wide grep for each of the two plan-flagged classes.

**Surface NOT audited:**
- ~55 providers not individually opened this batch (their `fetch()`/`detect()` logic, parsing correctness, pagination edge cases were not read) — only mechanically grepped for the one redirect-hardening pattern, which cannot catch logic bugs, only the specific missing-option shape.
- No live end-to-end run of any provider against a real or mocked ATS server in this batch (existing `tests/providers/*.test.mjs` fixtures were run as part of the full suite, not independently re-derived).
- `providers/_config-utils.mjs`'s `intInRange` and `providers/_profile-keywords.mjs`'s `resolveProfileKeywords` — used by several providers this batch (`arbetsformedlingen`, `apec`, `eures`) but not independently re-audited; both were already read in full in batch 4.

**Defect classes covered:** trust boundary / SSRF via server-side redirect — 4 confirmed instances, all fixed, all regression-tested (including a revert-and-confirm-red step per guardrail #5). `?? x) || x` boundary arithmetic — grepped fleet-wide, 0 instances. `ctx.dryRun` contract — grepped fleet-wide, 0 instances (no write surface exists in `providers/`).

**Confirmed defects:** CRITICAL 0 / HIGH 1 (B5-D1..D4, counted as one class — a compromised or misconfigured company career-site server could redirect the crawler to an internal address reachable from wherever Jobber runs; MEDIUM-in-isolation per instance, HIGH as a class given 4 live instances and an existing test file that was supposed to prevent exactly this) / MEDIUM 0 / LOW 0.
**Cleared (innocent):** 0 individual candidates this batch (the 9 representative providers yielded no C-rows — clean on full read, not merely untested).
**Residual SUSPECTED:** 0.
**Residual UNKNOWN:** 0 for the classes examined; the ~55 unread providers are UNKNOWN for any class other than SSRF-redirect-hardening.

**Clean-claim, scoped:** One representative per structural family (JSON-ATS ×3, complex-paginated ×2, regex-HTML-scraper ×2, newest-zero-key-gov ×3) was read in full with no defect beyond the one class found. The SSRF-redirect-hardening class was checked mechanically across the *entire* fleet (69 files), not just the samples — this is the one claim in this batch that approaches exhaustive. This is NOT a claim that the ~55 unread providers are free of parsing bugs, pagination edge cases, or any defect class other than missing redirect hardening.

**Highest-value next hunt:** the ~55 providers never individually opened across batches 1-5 are the largest unaudited surface left in the entire plan. If a future batch revisits `providers/`, prioritize the ones sharing `radancy.mjs`'s "modeled on an older sibling, later copy dropped a hardening line" shape — i.e. diff each provider against the sibling its own header comment cites as its pattern origin, the same method that found B5-D1..D4.

---

## Batch 6 — Scanners & liveness — 2026-09-02 — PARTIAL

Baseline: 3525 passed / 0 failed / 1 warning on clean `main` (same baseline as batches 1-5 — none merged yet). Post-fix full run: 3527 passed / 0 failed / 1 warning (+2, one new structural assertion each in `tests/browser-extract.test.mjs` and the new `tests/check-liveness.test.mjs`).
Budget: 2 confirmed / 12 allocated. Time-boxed close.

| ID | Location | Class | Property violated | Trigger | Innocence | Status | Fix |
|----|----------|-------|-------------------|---------|-----------|--------|-----|
| B6-D1 | `browser-extract.mjs`, `context.route('**/*', ...)` guard | trust boundary / SSRF via DNS rebinding (T4) | Every request the headless browser makes must be blocked if it targets a private/internal address — `rejectPrivateOrInvalid()` only pattern-matches the literal hostname string, not the address it resolves to; sibling `liveness-browser.mjs`'s `checkUrlLiveness()` route handler additionally calls `validateUrlSecurity()` (DNS-resolves the hostname, blocks on a private resolved IP) for the identical threat, but `browser-extract.mjs` never called (or could call — `validateUrlSecurity` wasn't even exported) anything equivalent | FIRED — real Chromium launched with `--host-resolver-rules=MAP evil.test 127.0.0.1` (a Chromium-internal override, no system DNS/hosts change) navigated to `http://evil.test:{port}/admin-secret` through browser-extract.mjs's exact route-guard logic; the guard let it through and the browser read the "internal" server's response body verbatim | NO-DEFENSE — unconditional `route.continue()` once the literal-pattern check passes, reachable on every navigation and sub-request | **VERIFIED DEFECT** | this batch's branch (`hunt/batch-6-scanners-liveness`); `validateUrlSecurity` exported from `liveness-browser.mjs` and called (with the same abort-on-throw shape) from `browser-extract.mjs`'s route handler |
| B6-D2 | `check-liveness.mjs` `main()` — browser/headed-page lifecycle | resource lifecycle (T7) | A thrown error between `ensureBrowser()`'s `chromium.launch()` and its `newLivenessPage()` (e.g. the browser crashing mid-flight — a real, observable Playwright failure mode) must not leak the already-launched Chromium process; the close calls (`if (headed) await headed.close(); if (browser) await browser.close();`) sat as plain post-loop statements with no `try/finally`, unlike the identical pattern already done correctly in `scan.mjs`'s `verifyOffers()` and in `scan-interamt.mjs`/`browser-extract.mjs` | FIRED — launched a real browser, closed it out from under `ensureBrowser()` to force the real `newLivenessPage()` (imported, unmodified) to throw exactly as a mid-flight crash would, and confirmed the file's actual control-flow shape (loop with no surrounding try/finally) has no path back to `browser.close()` on that throw | NO-DEFENSE — the only cleanup path was falling out of the loop normally; any exception mid-loop skips it entirely | **VERIFIED DEFECT** | this batch's branch; the URL loop wrapped in `try { ... } finally { if (headed) await headed.close(); if (browser) await browser.close(); }` |

### Coverage & residual risk (Batch 6)

**Surface audited (full read):** `liveness-browser.mjs`, `browser-extract.mjs`, `scan-interamt.mjs`, `check-liveness.mjs`, `liveness-api.mjs`. `scan.mjs`'s `verifyOffers()` (the `--verify` Playwright path) was read in full and traced against the same T7 resource-lifecycle question that found B6-D2 — already correct (proper `try/finally`), used as the positive control confirming B6-D2 is a real regression relative to an established sibling pattern, not a stylistic choice.

**Surface NOT audited:** the bulk of `scan.mjs` (2639 lines total — only `verifyOffers()` and its immediate helpers were read), `scan-ats-full.mjs` (997 lines, parallel-worker reverse-ATS sweep — T7 concurrency/resource-lifecycle questions under its parallelism model are unexamined), `discover-ats.mjs` (902 lines), `verify-portals.mjs` (549 lines), `validate-portals.mjs` (310 lines), `provider-health.mjs` (206 lines), `liveness-core.mjs` (176 lines — `classifyLiveness`'s pure classification logic itself, as opposed to its callers, wasn't independently re-derived this batch).

**Defect classes covered:** trust boundary / SSRF (T4) — one confirmed instance, found by the same method as B5-D1..D4 (diff a file against the sibling that implements the same guard correctly). Resource lifecycle (T7) — one confirmed instance, same diffing method, with `scan.mjs`'s correct implementation serving as direct proof of the regression rather than a hypothesis.

**Confirmed defects:** CRITICAL 0 / HIGH 1 (B6-D1 — a job-posting or listing URL fed to `browser-extract.mjs`, whose host resolves to an internal address, is read and returned to the caller as page content; this is a live SSRF read primitive reachable from ordinary JD-extraction on attacker-influenced input) / MEDIUM 1 (B6-D2 — resource exhaustion / orphaned Chromium processes on repeated failures, not a data-confidentiality issue) / LOW 0.
**Cleared (innocent):** 0 individual candidates this batch — every file opened yielded either a confirmed defect or a clean full read (`scan-interamt.mjs`, `liveness-api.mjs`, `scan.mjs`'s `verifyOffers()`).
**Residual SUSPECTED:** 0.
**Residual UNKNOWN:** the ~5,300 unread lines across `scan.mjs` (bulk), `scan-ats-full.mjs`, `discover-ats.mjs`, `verify-portals.mjs`, `validate-portals.mjs`, `provider-health.mjs` — largest unaudited fraction of any batch's scope so far by line count.

**Clean-claim, scoped:** The two files most exposed to T4 (arbitrary/attacker-influenced URLs reaching a real browser: `browser-extract.mjs`, `liveness-browser.mjs`) and the two most exposed to T7 in the same surface (`check-liveness.mjs`, `scan-interamt.mjs`) were read in full, plus `scan.mjs`'s one Playwright-touching function. Both defects found were the same "sibling got it right, this file dropped the safeguard" shape already established in batch 5 — this method (diff a file against its own codebase's sibling implementing the identical guard) is now 2-for-2 across batches 5 and 6 and is the highest-confidence technique left in this plan. This is NOT a claim that `scan-ats-full.mjs`'s parallel-worker model, `discover-ats.mjs`, `verify-portals.mjs`, `validate-portals.mjs`, or `provider-health.mjs` are defect-free — none were opened this batch.

**Highest-value next hunt:** `scan-ats-full.mjs` (997 lines, parallel-worker sweep over a full public ATS dataset) is the largest unread file with the most direct T7 exposure (concurrent workers, each presumably opening its own resources) left in the entire plan — a future batch revisiting this scope should start there, then continue the sibling-diffing method into `verify-portals.mjs`/`validate-portals.mjs` (both likely share logic with the now-audited `check-liveness.mjs`/`liveness-api.mjs`).

---

## Seeds (pre-existing, recorded before batch 1 — see docs/DEFECT-HUNT-PLAN.md §6)

| ID | Location | Status | Note |
|----|----------|--------|------|
| SEED-A | `lib/robots.mjs` `gate()` cache | VERIFIED, FIXED (batch 4, B4-D1) | Origin-keyed cache conflated per-path verdicts — now caches the parsed rule groups per origin and re-evaluates the path-specific verdict on every call. Still zero production callers (`update-system.mjs:147` is a SYSTEM_PATHS manifest entry, not an import) — wiring `gate()` into `providers/_http.mjs`'s escalation path remains a separate follow-up. |
| SEED-B | `.github/workflows/test.yml` shallow checkout | VERIFIED, FIXED (`b74af31`, pre-dates this plan) | `git log -1 -- <file>` staleness checks broke under depth-1 checkout. Batch 2 checked `check-translation-freshness.mjs` for a second instance of the class (B2-C2) — none found; no other `git log`/`git rev-list`-dependent module encountered in batches 1-2. |
