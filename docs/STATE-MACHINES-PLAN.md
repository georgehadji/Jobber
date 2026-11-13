# State Machines Plan — find every implicit state machine, then make each one explicit

**Date:** 2026-11-11 · **Status:** draft for review · **Scope:** whole repo (Node scripts, `lib/`, `batch/`, `web/`, `dashboard/`, `modes/`, `templates/`)

**Goal.** Find every implicit state machine in Jobber. Then turn each one into a declared, enforced and testable machine. Each change must improve all three experiences, and nothing may break:

- **UX (user experience):** the person never sees a false "done", a silent failure, or a choice that will be refused.
- **DX (developer experience):** each state list lives in one place, every write goes through one gate, and a test catches drift.
- **AX (agent experience):** an agent reads one authoritative description of each machine and gets precise, actionable errors.

---

## 0. How to read the evidence labels

| Label | Meaning |
|---|---|
| **VERIFIED** | Checked by hand against the code while writing this plan (file:line given). |
| **REPORTED** | Found by a recon subagent that read the code. Not re-checked by hand. Phase 0 re-verifies it before anyone acts on it. |
| **INFERRED** | Reasoning from code structure, not observed behaviour. Must be reproduced before fixing. |
| **DECISION** | A product choice the owner must make. The plan does not choose silently. |

Three read-only scouts did the reconnaissance: Sonnet on the core scripts, Sonnet on the web app and dashboard, and Haiku on the `modes/` instruction files.

They did **not** cover:
- the non-underscore `providers/*.mjs` files
- `plugins/<id>/`
- `scaffolder/`
- `evals/`
- `.github/workflows/`
- the language mode folders (`modes/de`, `modes/es` …)
- most of `tests/`

Phase 0 closes that gap.

---

## 1. Guiding constraints (non-negotiable)

1. **Behaviour-preserving by default.** Before refactoring a machine, write characterization tests that capture what it does today. The refactor must keep them green. Any behaviour change is a separate, named change with its own test and its own changelog line.
2. **Respect the data contract.** Never rewrite user-layer files in bulk: `data/*`, `reports/*`, `cv.md`, `config/profile.yml`, `portals.yml` and the rest. Format changes use a *tolerant reader*: read the old and new formats, write only the new one. No migration runs without the user's explicit consent and a backup.
3. **Aliases are a superset, never an intersection.** Real trackers contain Spanish, Portuguese and Turkish labels and old free-text values. Merging alias maps may *add* recognised spellings and must never stop recognising one that works today. The only exception is a real conflict, which is a DECISION (§6).
4. **New guards ship as warn first, enforce second.** A new transition check first logs `WARN illegal transition …` and records it in `status-log.tsv`. It refuses only one release later, after the warnings have been reviewed. `--force` always remains the explicit override.
5. **No new production dependencies.** The README states "four production dependencies by design". The Go dashboard must not gain a YAML library just for this work (§4.4).
6. **Follow the test rules in `AGENTS.md`** (*Writing Assertions*): run the control case, assert identity rather than count, never assert a reachable runtime guard by matching source text, and keep fixture-setup failures separate from the property under test.
7. **Baseline (measured 2026-11-11 on `main`, Windows):** `node test-all.mjs --quick` reports **5466 passed, 2 failed, 5 warnings**. The 2 failures are pre-existing and unrelated: a `SYSTEM_PATHS` coverage gap (the tracked `CVs/` files from commit b14d354 are in neither `SYSTEM_PATHS` nor `USER_PATHS`) and an `analyze()` appDateSource end-to-end check that dies with `EPERM` creating a symlink on Windows. The earlier figure of 5473 / 3 (DNS SSRF check, provider-health `--ci`, stale translations) did not reproduce on this machine. Every phase must end at **≥ baseline passes with the same or fewer failures**. Go is not installed on this machine, so `go test ./...` cannot run here (see D8). GitHub Actions on this repo currently cannot start jobs because of an account billing issue (see PR #85), so local runs are the gate until that is fixed.

---

## 2. What we found — the machine catalogue

Risk combines likelihood of data loss or corruption, user-visible lies, and drift surface.

### 2.1 Critical / high

**M1 — Application status lifecycle** (`data/applications.md` + `data/status-log.tsv`; declared in `templates/states.yml`). Risk: **critical.**

- **VERIFIED** — `set-status.mjs:386-404` gates only exits *from terminal states*. Forward edges in the `transitions:` table are documentation, not enforcement. The `states.yml` comment says this on purpose: live states are free-form so that corrections stay possible.
- **REPRODUCED (Phase 0.3, executed)** — `set-status.mjs:371,386-390`: `oldId` is looked up by exact label. If the existing cell is non-canonical (e.g. `Evaluada`, `Applied 2026-01-05`), `oldId` is `undefined`. Then `transitions[undefined] ?? []` is empty, so the row is treated as **terminal** and the change is refused without `--force`: `Evaluada is a terminal state … Legal moves from Evaluada: .` Controls pass (`Evaluated`→Applied works; `Rejected`→Interview is still refused). Test: `tests/repro-set-status-noncanonical.test.mjs` (run with `JOBBER_REPRO=1`; kept red until Phase 3.2).
- **VERIFIED** — `tracker-utils.mjs:357` exports `canTransition()`, but nothing outside that file calls it.
- **VERIFIED** — the `states.yml` comment says *"The dashboard reads this table too."* This is false: no Go file parses YAML (`dashboard/go.mod` has no YAML dependency), and none references `transitions`.
- **VERIFIED (Phase 0.2, by reading)** — the canonical list is hard-coded in **≥14 full copies plus several subsets and maps** (`company-history`, `funnel-velocity` hold stage subsets; `outcome.mjs` is an outcome→state map; `reply-matcher` emits classifier outputs; `lib/sunset-policy.mjs:13` is only a comment; `dedup-tracker` and the `*-eval.mjs` prompts are UNCLEAR). Candidate sites, original list:
  - **root scripts:** `merge-tracker.mjs:163,193-208`, `normalize-statuses.mjs:69-90`, `verify-pipeline.mjs:47` (declares `STATES_FILE` but uses its own list), `followup-cadence.mjs:~80,100`, `analyze-patterns.mjs:~85,113,118,122`, `stats.mjs:37,43,48`, `dedup-tracker.mjs`, `lib/sunset-policy.mjs:16`, `outcome.mjs:53`, `reply-matcher.mjs:392-414`, `company-history.mjs:68`, `funnel-velocity.mjs:63`, and the `*-eval.mjs` prompts
  - **web:** `lib/format.ts:41-51`, `app/actions/registry.ts:18`, `components/pipeline-view.tsx:15-26`, `app/analytics/page.tsx:7-16` (**omits SKIP**, uses substring matching), `api/assistant/route.ts:27`
  - **Go:** `career.go:508,872,903`, `pipeline.go:128-154,203-213,252`
  - **VERIFIED** — parity tests (`test-all.mjs` 55.3/55.3b) cover **only the web lists**.
- **REPORTED** — alias drift:
  - **VERIFIED:** `condicional|hold|evaluar|verificar|geo blocker` are accepted by **five** root scripts (`analyze-patterns`, `followup-cadence`, `verify-pipeline`, `merge-tracker`, `normalize-statuses`) but are not in `states.yml`, so strict `set-status` rejects them (`invalid-state`). Web has the first three; Go has all five.
  - **VERIFIED:** `monitor` is `skip` in YAML, `merge-tracker`, `normalize-statuses`, `verify-pipeline`, `stats` and web, but `evaluated` in Go (`career.go:536`): a **real conflict**, and Go is the lone outlier (alias corpus, Phase 0.4).
  - **VERIFIED:** Go adds Turkish aliases that YAML lacks (`career.go:521,536`).
  - **VERIFIED (corpus):** `-` and the empty string map to `discarded` in `normalize-statuses` and web, but are unknown in `merge-tracker`, `verify-pipeline`, `stats` and Go. Date suffixes are accepted unevenly (`Hired (2026-01-05)` only by `merge-tracker`; `Rechazado 2026-02-01` by everything except web).
- **VERIFIED** — unknown status is handled six different ways (a seventh: `tracker.mjs:396` rejects unknown input on its set path):
  - mapped to `Evaluated` with a warning (`merge-tracker`)
  - mapped to `Evaluated` with a `[sync: …]` note (`tracker.mjs`)
  - flagged and left alone (`normalize-statuses`)
  - an error (`verify-pipeline`)
  - counted as `Unknown` (`stats`)
  - `—` mapped to `Discarded` (`normalize-statuses`)
- **VERIFIED** — writers that bypass the gate:
  - `reply-watch.mjs:170-221` has no terminal-state guard, so it can move Hired/Rejected → Responded/Interview. It does run under the tracker lock and **does** append to `status-log.tsv` (`source=manual`, `:207-213`). Its only guards are "row unchanged since review" and operator approval
  - `normalize-statuses.mjs:176-181` writes directly under the tracker lock with a `.bak`; no gate, no log. A spelling fix is not a lifecycle move, so whether it should log is a DECISION, not a bug
  - **VERIFIED** — the **Go TUI** writes `applications.md` directly (`career.go:671,684`). It never calls `set-status.mjs` and never appends to `status-log.tsv` (only `web/src/app/api/status/route.ts` and Node scripts reference the log). So the TUI can do Rejected → Interview, and `funnel-velocity` loses those events.
  - The good paths: `outcome.mjs` and `sunset.mjs --apply` delegate to `set-status`.
- **VERIFIED** — `modes/tracker.md:21` lists the lifecycle **without `Hired`**.

**M2 — Web status-write UX** (`web/src/components/*`, `/api/status`). Risk: **high (the UI misleads the user).**

- **VERIFIED** — `home/decision-card.tsx:23-24` calls `fetch('/api/status')` and then `setDone(status)` without checking `res.ok`. A 409/404/423 still makes the card disappear as if the change succeeded.
- **VERIFIED (Phase 0.2):**
  - `assistant-console.tsx:252-263` ignores the response; the "Marked #n" text is returned synchronously by `registry.ts:268` right after a fire-and-forget write, so it cannot reflect the outcome.
  - `status-select.tsx:23-37,50-54` offers all 9 states regardless of the current one. On a 409 it reverts silently and drops the message `api/status/route.ts:52-60` builds.
  - `registry.ts:18` (list) and `:259` (check) validate again against a hard-coded list; the route validates a third time (`route.ts:28`).
  - **Phase 2.1 done on branch `fix/web-status-write-honest`** (see §5).

**M3 — Dashboard TUI pipeline screen** (`dashboard/internal/ui/screens/pipeline.go`). Risk: **high.** All items REPORTED:
- Overlay state is independent flags (`statusPicker`, `discardPicker`, `pdfPicker`, `searchInput`, `colPicker`, `hiredStep`) with priority dispatch (`pipeline.go:447-465`). No single enum. VERIFIED that no path opens two at once (openers clear the previous flag, `:800`), so this is a representability problem, not a live bug.
- The "hired" celebration runs even if the write failed, on the pipeline status-picker path only (`pipeline.go:804-813`); the report-viewer path checks the error first (`main.go:130-136`). Write errors on both paths go only to stderr behind the TUI (`main.go:86,95,133,151`).
- There are no `Offer`/`Hired` tabs, although the web app has them.
- `Esc` in the discard picker commits the status without a reason (documented behaviour).

**M4 — Web agent-run lifecycle** (`api/run/route.ts`, `components/jobs/job-store.tsx`, `lib/core/run-registry.ts`). Risk: **high (false "done").** REPORTED:
- VERIFIED: the client marks a job `done` whenever the stream closes cleanly, even with no `done` event. The server always sends `done` or `error` first, so this fires only on abrupt truncation: a latent hole, not a common one.
- VERIFIED: on an early `finish('error')` the reader is not cancelled, so the server child keeps holding the tracker-write token. The trigger is a mid-run stderr line matching `/error|denied|fatal|auth|login|…/` (`route.ts:216-224`), which a benign warning can satisfy. The run can still finish and write a report while the UI says "error".
- INFERRED + new detail: the "honesty gate" compares report counts, so concurrent runs can satisfy each other's check. `countReports` also counts `NNN-RESERVED.md` sentinels (`route.ts:134`), so a reserved-but-unwritten run can pass.
- VERIFIED: a timeout shows a generic error.
- VERIFIED: `run-registry.ts` is only an in-memory write-token `Set`, not a run registry; job state lives in client React state and is lost on reload.
- **Phase 2.2 done on branch `fix/web-job-done-explicit`.** Behaviour change to note: the early-error path now cancels the reader, which kills the child, so a benign stderr line stops a run that would previously have finished.

**M5 — Report-number reservation** (`reserve-report-num.mjs`, `reports/NNN-RESERVED.md`). Risk: **high (two reports can get the same number).** REPORTED:
- VERIFIED: two garbage-collection (GC) implementations: a locked one in `reserve-report-num.mjs:246-284` (`gcStaleReportReservations`, checks the owner PID) and an **unlocked, age-only** one in `tracker-utils.mjs:403-422` (`gcStaleSentinels`), which `merge-tracker.mjs:143` and `verify-pipeline.mjs:230` call. The 4h constant is duplicated (`reserve-report-num.mjs:34`, `tracker-utils.mjs:393`). The comment at `tracker-utils.mjs:389-391` says "one shared implementation" but covers only those two callers.
- **REPRODUCED (Phase 0.3):** a 5h-old sentinel whose owner PID is alive is reclaimed by `verify-pipeline`'s GC, and `reserve-report-num.mjs` then issues the same number (`001`). The locked GC keeps it, so the two implementations disagree. Test: `tests/repro-sentinel-gc.test.mjs` (`JOBBER_REPRO=1`). The batch-row (`processing`) half is not built.
- A PID check alone will **not** protect batch workers: `batch-runner.sh:471` reserves through a short-lived `node reserve-report-num.mjs` process, so the stored PID is dead within milliseconds. The batch-row `processing` check is the load-bearing part (INFERRED). `docs/DEFECT-HUNT-LEDGER.md` already lists the missing PID check as SUSPECTED "B1-C2".
- No test covers `gcStaleReportReservations` or the live-owner case (a `>4h` test for `gcStaleSentinels` exists).

### 2.2 Medium

| ID | Machine | Where | Key problems (all REPORTED unless marked) |
|---|---|---|---|
| M6 | Batch job state | `batch/batch-runner.sh`, `batch/batch-state.tsv` | 7 states inlined in ≥3 places (one summary function lumps `rate_limited` into pending); `update_state` accepts any string; a crashed `processing` row re-runs with a **new** report number, leaving an orphan sentinel; retries don't count `processing`/`rate_limited`; a silent lock-free fallback if `mkdir` of the lock fails (`:236`) |
| M7 | `pipeline.md` URL inbox | `scan.mjs`, `reconcile-pipeline.mjs`, `openrouter-runner.mjs`, `archive-posting.mjs` | Two incompatible `[x]` encodings (one moves the row to Processed, one flips it in place); `reconcile-pipeline` and `openrouter-runner` write **without** `pipeline-lock`, so they can lose scanner appends; `[!]` error state is documented but never written; errored URLs stay pending forever |
| M8 | Plugin integrity | `plugins/_engine.mjs:547-586`, `plugins/_lock.mjs:96-141`, `plugins.mjs:254-286` | **Security (VERIFIED, narrower than first reported):** the `lockGate` `default` is `{load:true}` but is **unreachable today** (`diffPlugin` returns 5 statuses, all handled); a lock read error fails closed (`:553`). Real holes: (1) `writeLockEntry`/`removeLockEntry` read with the lenient `readLock`, so a corrupt `plugins.lock` followed by `plugins.mjs trust X` overwrites it with one entry and drops every other pin, after which those plugins read as `unpinned`; (2) `unpinned` loads and silently re-pins whenever *this plugin's* entry is missing, even if the lock file exists (`:570`), contradicting `docs/AUDIT-FIX-PLAN.md:313`; (3) writes are unlocked, truncating in place; (4) `repin()` swallows write errors (`:566`); (5) stale comment at `:547` says "fail-open" against `:553`. Also bundled plugins with changed files and no version bump are re-pinned and loaded (`:579`, see M29) |
| M9 | Apply/prefill flow | `web/src/components/apply/apply-provider.tsx`, `lib/apply/*` | `status` plus a separate `error` string that can coexist; no in-flight guard in callbacks (only buttons are disabled); abandoned server sessions with headed Chrome live until the next `open`. The never-auto-submit guard (`submit-guard.ts`) is sound: **keep it unchanged** |
| M10 | Explore scan phases | `web/src/components/explore/explore-provider.tsx` | 11-phase union, but bare 850 ms `setTimeout`s are never cleared, so a late `results` can overwrite a newer run (INFERRED race); `runningRef` duplicates `phase` |
| M11 | Update system | `update-system.mjs` | **VERIFIED:** `dismiss` prints *"Run check … to re-enable"* (`:1434`), but `check` returns `dismissed` while the flag file exists (`:894`), so the advice is wrong. **REPORTED:** `.update-lock` has no stale recovery, so after a SIGKILL `apply` refuses forever |
| M12 | Portal health | `scan.mjs:1809-1900`, `stats.mjs:295`, `verify-portals.mjs`, `provider-health.mjs`, `discover-ats.mjs` | The failure classification is duplicated 3×; 4 different status vocabularies for the same idea; unknown strings count as failures; the log grows without bound |
| M13 | Liveness → scan history | `liveness-*.mjs`, `scan.mjs:1987-2030`, `data/scan-history.tsv` | A false `expired` becomes permanent (dedup never rechecks unless `recheckAfterDays` is set); `skipped_*` strings are inline, with no enum |
| M15 | Reply-watch candidates | `reply-watch.mjs`, `paste-reply.mjs`, `data/reply-candidates.json` | No consumed/seen state, no `message_id` dedupe, the whole file is re-classified on every run; tracker writes bypass the gate (see M1) |
| M21 | Prose-only machines (agent instructions) | `modes/*.md` | Interview-round vocabularies disagree (`debrief.md:206`/`practice.md:144` vs `interview-prep.md:133-149`); "cold" follow-up isn't a declared state; `patterns.md:258` treats `SKIP` and `NO APLICAR` as two states; triage verdicts, legitimacy tiers, red-flag levels and the apply gate (`filled→submitted`) exist only in prose |

### 2.3 Low

| ID | Machine | Note |
|---|---|---|
| M14 | Follow-up cadence | Urgency is *computed*, not stored (good). It has its own alias copy and its own lock implementation (`followup-seed.mjs:~79`) |
| M16 | Agent inbox | No lock, no atomic write; `resolve N` uses a positional index that can shift between `list` and `resolve` |
| M17 | PDF flag `✅/❌/—` | One-way; `sync-pdf-flags` upgrades `—` while `merge-tracker` upgrades only `❌` |
| M18 | Web onboarding banner | `/api/doctor` errors are swallowed, so the banner hides with no retry |
| M19 | Inbox/Today triage | localStorage-backed; undo is lost on reload; acceptable |
| M22 | Locks (cross-cutting) | Five lock implementations: `lib/file-lock.mjs`, the `followup-seed` copy, bash in `batch-runner`, `.update-lock`, and none for `plugins.lock` |

### 2.3b Added by Phase 0.1 (areas the first scouts missed)

Labels: VERIFIED = lines read by the scout; "grep" = a grep negative or pattern match only. Rows are **not yet independently re-checked** by a second reader.

| ID | Machine / drift | Where | Key problems | Risk |
|---|---|---|---|---|
| M23 | Provider run outcome (ok / partial / outage), implied by counters + `errors[]` | Family A (throw only if the first request fails): `providers/meituan.mjs:123,149-151`, `tencent.mjs:106,122-124`, `alibaba.mjs:136,164-166`. Family B (throw only if all keywords fail): `eures`, `freehire`, `apec`, `arbetsformedlingen`, `jobs-ac-uk`, `trudvsem`, `vdab`, `arbeitsagentur` (4 of these by grep only) | Two undocumented outcome semantics copied about 11 times. Family A returns from inside the keyword loop on a mid-run error, so remaining keywords never run and the caller sees success. Family B drops partial failures silently | med-high |
| M24 | Pagination stop reason, carried as a tag on the returned array | `providers/workday.mjs:256-340`, `icims.mjs:117-134`; silent caps in `justjoin.mjs:12,113-125`, `eightfold.mjs:156` | Tags (`workdayTruncated`, `icimsTruncated`) are consumed only by `scan-ats-full.mjs:760-765,814`; plain `scan.mjs` has no consumer. justjoin and eightfold cap with no tag | med |
| M25 | Retry / backoff policy (per call) | `workday.mjs:84-110` and `oraclecloud.mjs:91-110` (near-verbatim copies), `ashby.mjs:178-190`, `eightfold.mjs:128-135`, `freehire.mjs:410-421`, `meituan.mjs:130-160` | Retryable set differs per provider; "no HTTP status" is treated as retryable | low |
| M26 | Avature pagination-key self-heal latch | `providers/avature.mjs:180-212` | One-way latch; `fresh === 0` stands for repeat, empty and end-of-board | low |
| M27 | Gmail processed-id cursor | `plugins/gmail/index.mjs:53-67,99,123,139,144` | A corrupt file loads as an empty `Set` (`:57-58`) and is then overwritten, so every old lead is re-ingested; save failure only warns; no lock, no atomic write; the set grows without bound | med |
| M28 | Apify run lifecycle | `plugins/apify/_apify.mjs:26,144-170,200-214` | A 4xx during polling throws without aborting, so the remote run keeps running and billing; abort is fire-and-forget | low-med |
| M29 | Plugin trust gate, bundled drift (extends M8) | `plugins/_engine.mjs:575,579`, `plugins/_registry.mjs:82` | Bundled plugins with changed files and no version bump are silently re-pinned and loaded ("reviewed-by-construction" is an assumption); two taxonomies (5 lock statuses, 4 source badges) | med (security) — **DECISION D9** |
| M30 | Notion status canonicalisation (third canonical loader) | `plugins/notion/_notion.mjs:22-45`, `index.mjs:78-79` | Unknown status returns null and the row is pushed with no Status and no warning; upsert takes `dupes[0]` with no lock | low-med |
| M31 | Status vocabulary in language-mode READMEs | `modes/de/README.md:69`, `es:59`, `fr:59`, `pt:69`, `tr:75` | Each lists 5 of 9 states (no Responded, Discarded, SKIP, Hired), so an agent in a language mode never offers them | med |
| M32 | Legitimacy tier labels (extends M21) | Translated in `modes/{tr,ua,zh-TW,zh,ar}/_shared.md`; English hard-coded in `modes/tr/is-ilani.md:250`; writers `openrouter-runner.mjs:670-671`, `eval-runner.mjs:52,67`; reader `lib/report-schema.mjs:101-102`; `analyze-patterns.mjs:292,302` | No enum anywhere. Four vocabularies (English tier, translated tier, `unknown`/`unconfirmed`, snake_case). Grouping by tier splits across languages | med-high for analytics |
| M33 | Archetype names in language tables | canonical `modes/_shared.md:153-160`; translated variants in about 15 `_shared.md`; consumer `eval-golden.mjs:263` (exact match), `lib/score-summary.mjs:39` | A model that emits a translated archetype scores a MISS and breaks grouping silently (gate effect INFERRED from code) | med |
| M34 | Interview round enum (extends M21) | audience set `modes/interview-prep.md:122-127,144`; round set `modes/interview/debrief.md:206`, `practice.md:144`; mapping `debrief.md:223`, `practice.md:161`; mirrored in de, es, pt, zh, fr | `peer-tech` and `panel-mixed` map to nothing; `recruiter-screen` maps only to `screen`. No code consumer (grep). Written into `round:` frontmatter | low-med |
| M35 | Round-outcome vocabulary in debriefs | `modes/interview/debrief.md:19` and de, es, pt copies | `moved forward / rejected / pending`, translated, no canonical target and no link to tracker status | low-med |
| M36 | Localised pipeline section headers | `modes/{de,es,fr,pt,tr}/pipeline.md:9-15` vs `modes/pipeline.md:31-38` | No code matches the literals, so section moves are agent prose only; overlaps M7 | low |
| M37 | Language folders lack triage and Block G | no `modes/<lang>/triage.md`; no Block G in `de/angebot`, `es/oferta`, `fr/offre`, `pt/oferta` | A language-mode report has no legitimacy tier, so it falls back to `unconfirmed`/`unknown` | med |
| M38 | Ledger-bot signature flow | `.github/workflows/ledger-bot.yml:11-314` | `human-review` and `queued-manual` have no persisted label and the trigger does not subscribe to edits, so they can be stuck unseen; a no-token PR is left open with no feedback | low-med |
| M39 | Issue label flows | `.github/workflows/stale.yml:27-34`, `auto-triage-scan-output.yml:19,81,86` | Two writers of issue state with no shared vocabulary; exempt lists differ | low |
| M40 | Eval golden set | `evals/golden/*.json`, `eval-golden.mjs` | Legitimacy is never checked; one golden archetype label is outside the canonical six | low-med |

**Checked, no machine found:** `scaffolder/` (linear init script), circuit-breaker / cooldown / quarantine in providers or plugins (none), persisted rate-limit state (none). **Not covered:** `ashby.mjs` after line 190, `eightfold.mjs` before 128, the plugin install path, `plugins/_template`, and the workflows `test`, `web-ci`, `release`, `sbom`, `codeql`, `welcome`, `dependency-review`, `plugin-registry-validate`, `gh-events-feed` (grep only).

### 2.4 Reference design — copy this one

**M20 — `scan-ats-full` checkpoint** (`scan-ats-full.mjs:72-135`): atomic tmp+rename writes, shape validation, a compatibility check on resume, a dataset hash check that aborts on mismatch, and deletion on completion. It already has the properties the other machines should have.

---

## 3. Approaches considered

| | Approach | Assumptions | UX | DX | AX | Risk / cost | Verdict |
|---|---|---|---|---|---|---|---|
| **A** | **Declare once, derive everywhere.** A YAML registry per machine (schema extends `states.yml`), one small runtime in `lib/state-machine.mjs`, generated Go/TS/Markdown artifacts, parity tests, and a ratchet validator | Machines are small (≤12 states) and data-driven; most bugs are drift and bypass, not missing modelling power | ✅ UI shows only legal moves, with real error messages | ✅ one place to change; tests catch drift | ✅ one `describe` command plus generated blocks in modes | Medium effort, incremental, no new deps | **Recommended** |
| B | Adopt a statechart library (XState) | Rich behaviour (parallel/hierarchical states) is the main problem | ✅ web only | ⚠️ helps TS only; bash, Go and Markdown are untouched | ❌ agents still read prose | New dependency against the "four deps" rule; doesn't reach the bash/Go/Markdown machines, which are the worst offenders | Rejected. Revisit for M9/M10 only if their reducers grow |
| C | Parity tests only (no refactor) | Drift is the only problem | ❌ silent-failure bugs stay | ⚠️ drift caught, duplication stays | ❌ | Lowest risk | Insufficient alone. **Used as Phase 1 of A**, giving tests before refactors |
| D | Event-sourced status: `status-log.tsv` is the truth and the tracker is a projection | Full history matters more than simplicity | ✅ audit/undo | ❌ every writer and reader changes | ⚠️ | High risk and touches the user-layer format | Rejected for now; A keeps D possible later |

**Why A beats the alternatives.** The dominant failures found are:
- the same list in ~20 places, which a single source of truth fixes
- writers that bypass the gate, which one write path fixes
- UI paths that report success they didn't get, which honest result handling fixes

None of these needs a statechart engine. All of them need **one declaration and one gate**. A also covers the four runtimes we actually have (Node, bash, Go, Markdown read by agents), which B does not.

---

## 4. Target design

### 4.1 Registry (DX + AX)

- Keep `templates/states.yml` exactly where it is. It is referenced widely, and moving it would break user forks. Extend it *additively*.
- Add `templates/machines/<id>.yml` for the other machines, using the same schema:

```yaml
id: application-status          # stable id used by code, tests, docs
persisted_in: data/applications.md (Status column) + data/status-log.tsv
initial: evaluated
states:
  - id: applied
    label: Applied
    aliases: [aplicado, enviada, sent]
    terminal: false
    description: Application sent
transitions:                    # forward edges (unchanged table)
  applied: [responded, interview, rejected, discarded, skip]
policy:
  backward_between_live: correction   # DECISION D1: correction | forbidden
  unknown_input: reject                # DECISION D4: reject | flag | map:<id>
  exit_terminal: force                 # requires --force (today's behaviour)
writers: [set-status.mjs]       # the ONLY scripts allowed to write this state (validator-enforced)
```

### 4.2 Runtime: `lib/state-machine.mjs` (zero dependencies beyond `js-yaml`, which is already present)

- `loadMachine(id)` — cached; validates the schema.
- `canonicalize(machine, raw, {strict})` → `{id, label, matchedAlias}` or a typed `UnknownState` error. Non-strict mode keeps today's per-call-site fallback until DECISION D4.
- `check(machine, from, to)` → `{ok, kind: 'forward'|'correction'|'terminal-exit'|'illegal', legal: [...]}`. This **fixes the `oldId === undefined` bug** by canonicalizing `from` through aliases first. If `from` is still unknown, the result is `kind: 'unknown-from'`, which is allowed with a warning, never treated as terminal.
- `describe(machine)` → JSON (states, aliases, transitions, policy, writers) for agents and the UI.
- `toMermaid(machine)` → a diagram for the docs.

`tracker-utils.mjs` keeps its exports (`loadCanonicalStates`, `resolveCanonicalState`, `canTransition`, …) as thin wrappers, so no importer breaks.

### 4.3 One write path per machine (UX + DX)

- **Application status:** every writer goes through `set-status.mjs`, or through a shared `applyStatusChange()` that `set-status` itself uses. That function runs the gate, appends to `status-log.tsv`, and honours locks.
  - Migrate `reply-watch` and `normalize-statuses`, warn mode first.
  - `merge-tracker` keeps inserting new rows, but resolves statuses through `canonicalize`.
- **Batch:** `update_state` validates against `templates/machines/batch-job.yml`. Bash calls `node lib/state-machine.mjs assert batch-job <state>`, or reads a generated `batch/states.sh`.
- **pipeline.md:** one writer helper under `pipeline-lock`. It reads both `[x]` encodings and writes one.

### 4.4 Cross-runtime derivation

- **Web (TS):** the existing `web/src/lib/core/states.ts` reader becomes the only source.
  - `format.ts`, `registry.ts`, `pipeline-view.tsx`, `analytics/page.tsx` and the assistant prompt import from it.
  - A new `GET /api/machines/application-status` returns `describe()`, so `StatusSelect` can show **legal moves first** and put "correction…" behind a confirm.
- **Go (dashboard):** two options, DECISION D3.
  - **Recommended:** writes shell out to `node set-status.mjs <n> <state> --json`. That gives one gate, the status-log append, and the same error texts. Node is always present wherever Jobber runs.
  - Reads use a **generated** `dashboard/internal/data/states_gen.go`, produced by `node scripts/gen-states.mjs` from `states.yml`. A parity test fails if it is stale. No new Go dependency.
- **Markdown (modes, for agents):** replace hand-restated lists with **generated blocks**:
  a `machine:application-status` begin/end comment pair (the marker syntax is described in `lib/machine-blocks.mjs`; it is not written out here because the block scanner would read it)
  The generator rewrites only the content between the markers, and a test fails if a block is stale. Agents keep reading the list inline (no extra tool call, same token cost), and drift becomes impossible.

### 4.5 Honest UI (UX)

- Every status write checks `res.ok`, shows the server's message (e.g. *"Rejected is terminal — use correction to change it"*), and never claims success it didn't get. This covers M2 and M3.
- **Runs (M4):** `done` only on an explicit `done` event. A clean close without one becomes `error: "Run ended unexpectedly"`. Timeouts get their own message. An early client error cancels the reader.
- **TUI (M3):** one `overlay` enum replaces the boolean flags. The hired celebration runs only after a confirmed write. Write errors show as a flash message, not stderr.
- **Explore and apply (M9/M10):** each gets one reducer with an explicit union. Timers are cleared on reset and unmount. Callbacks get an in-flight guard. Neither adds a dependency.

### 4.6 Agent experience (AX)

- `node machines.mjs list | describe <id> [--json|--mermaid] | check <id> <from> <to>` — one place for an agent to ask "what are the states, and is this move legal?"
- Every refusal states the reason and the legal moves, and is machine-readable under `--json`. `set-status` already does this for terminal exits; extend it to all kinds.
- `AGENTS.md` gets a three-line pointer: *"State lists live in `templates/states.yml` and `templates/machines/`. Never restate them; use `node machines.mjs describe`."*
- **Generated reference:** `docs/STATE-MACHINES.md`, with one Mermaid diagram, state table and writer list per machine, regenerated by script and checked by a test.

### 4.7 Ratchet (keeps it from rotting)

`validate-state-machines.mjs`, wired into `test-all.mjs`, fails if any of these happen:

1. A file outside the registry, the generated artifacts, or an **allowlist** contains three or more canonical state labels in one array or `switch`. The allowlist starts with today's ~20 sites and may only shrink.
2. A file not listed in a machine's `writers:` writes that machine's persisted file.
3. A generated block (Go, Markdown, bash) is stale.
4. A web, Go or root-script list disagrees with the registry. This extends today's 55.3b to every runtime.

Per `AGENTS.md`, this is an *absence* check, so a static scan is acceptable. Its comment must say that a determined rewrite can still evade it.

---

## 5. Phased execution

Each phase is a small PR. **Subagent models:** Haiku 5.5 for the easiest, mechanical tasks; Sonnet 5.5 for everything that needs judgement. The main session (Opus) only orchestrates, reviews every diff, runs the gates, and keeps the DECISIONs with the owner. Parallel code-changing subagents run in **isolated git worktrees**.

### Phase 0 — Complete and confirm the inventory (read-only)

| # | Task | Model | Output |
|---|---|---|---|
| 0.1 | Sweep the unscanned areas: `providers/*.mjs` (pagination, retry and rate-limit states), `plugins/<id>/`, `scaffolder/`, `evals/`, `.github/workflows/` (ledger-bot, stale, provider-health), `modes/<lang>/` (diff their state lists against `modes/*.md`) | Haiku ×2 (split the dirs) | Rows appended to the §2 catalogue |
| 0.2 | Re-verify every **REPORTED** item in §2.1 and every M8 claim at file:line; downgrade or drop what doesn't hold | Sonnet | Each row marked VERIFIED or dropped |
| 0.3 | **Reproduce** the `set-status` non-canonical `oldId` bug and the M5 sentinel-GC collision in temp fixtures (`seed-fixture.mjs`). Reproduce first, fix later | Sonnet | Two failing tests (kept red until Phase 3) |
| 0.4 | Build an alias corpus: every status spelling accepted anywhere today (root scripts, web, Go), with the canonical result each one maps to. Mark conflicts | Haiku | `tests/fixtures/status-alias-corpus.tsv` |

**Exit:** the catalogue is complete, every row is VERIFIED or dropped, the corpus exists, and the owner has received the DECISION list (§6).

### Phase 1 — Characterization and parity tests (no behaviour change)

| # | Task | Model |
|---|---|---|
| 1.1 | Golden tests: run each normalizer (`merge-tracker`, `normalize-statuses`, `verify-pipeline`, `stats`, `followup-cadence`, `analyze-patterns`, `dedup-tracker`, Go `NormalizeStatus`) over the corpus and snapshot today's output | Sonnet |
| 1.2 | Extend parity test 55.3b to the root scripts and Go, with an **allowlist of known differences** so it is green today and can only shrink | Haiku |
| 1.3 | Transition-matrix test for `set-status` (every from × to × `--force`) recording today's behaviour, including the M1 bug, marked as a known failure | Sonnet |

**Exit:** test-all is at baseline plus the new tests green, apart from the two intentionally red repro tests from 0.3.

### Phase 2 — Quick wins: honest UX, no architectural change (each item is independent; run in parallel)

| # | Fix | Model |
|---|---|---|
| 2.1 | `decision-card.tsx` and `assistant-console.tsx` check `res.ok` and show the server error; `status-select.tsx` shows the 409 message | Sonnet |
| 2.2 | `job-store.tsx`: `done` only on an explicit `done` event; cancel the reader on early error; timeout-specific message | Sonnet |
| 2.3 | `update-system.mjs`: fix the `dismiss` message (VERIFIED wrong); add stale recovery to `.update-lock` (PID + age, same protocol as `lib/file-lock.mjs`) | Sonnet |
| 2.4 | `modes/tracker.md:21`: add `Hired` (VERIFIED missing) | Haiku |
| 2.5 | `explore-provider.tsx`: keep and clear the 850 ms timers on reset/unmount/new run | Sonnet |
| 2.6 | `states.yml` comment: correct the false "dashboard reads this table" line (or make it true in Phase 4) | Haiku |

Each item needs a test that fails before the fix and passes after it (control case included).

### Phase 3 — The registry and the gate

| # | Task | Model |
|---|---|---|
| 3.1 | `lib/state-machine.mjs` + schema validation + `machines.mjs` CLI; `tracker-utils` exports become wrappers | Sonnet |
| 3.2 | Fix `set-status` by canonicalizing `from` through `check()`; the 0.3 repro test turns green; the matrix test from 1.3 is updated for exactly this one change | Sonnet |
| 3.3 | Move root scripts to `canonicalize()`, one script per commit, golden tests green after each: `verify-pipeline`, `stats`, `analyze-patterns`, `followup-cadence`, `dedup-tracker`, `normalize-statuses`, `merge-tracker` | Sonnet (Haiku may do the simpler swaps such as `stats` and `analyze-patterns` once the pattern exists) |
| 3.4 | Route `reply-watch` and `normalize-statuses` writes through `applyStatusChange()`, **warn mode** | Sonnet |
| 3.5 | Unify sentinel GC into one locked implementation that is batch-aware first (never reclaim a sentinel whose batch row is `processing`) and PID-aware second (PID alone does not cover CLI-reserved batch numbers); the M5 repro turns green | Sonnet |
| 3.6 | `pipeline.md`: one locked writer; tolerant reader for both `[x]` encodings; actually write `[!]` for errors | Sonnet |
| 3.7 | Plugin lock (security): `writeLockEntry`/`removeLockEntry` use `readLockStrict` and refuse on a corrupt lock; atomic, locked lock-file writes; non-bundled `unpinned` requires consent instead of silent re-pin (reconcile with `docs/AUDIT-FIX-PLAN.md:313`); `repin()` failure is reported; the `default` branch fails closed as defensive hardening only. Bundled-drift re-pin is DECISION D9 | Sonnet |

### Phase 4 — Derive every runtime from the registry

| # | Task | Model |
|---|---|---|
| 4.1 | Web: one source (`states.ts`); delete the hard-coded copies; `/api/machines/:id`; `StatusSelect` shows legal moves first and puts correction behind a confirm | Sonnet |
| 4.2 | Go: `gen-states.mjs` → `states_gen.go` plus a staleness test; TUI writes shell out to `set-status.mjs --json` (if D3 = recommended); one `overlay` enum; celebration only after a confirmed write; errors shown as a flash | Sonnet |
| 4.3 | Batch: `templates/machines/batch-job.yml`; validate `update_state`; give the single summary function every state; a crashed `processing` row reuses its reserved number | Sonnet |
| 4.4 | Markdown: add generated blocks to `AGENTS.md`, `modes/tracker.md`, `modes/patterns.md`, `modes/outcome.md`, `modes/followup.md`, `modes/reply-watch.md`, and the `modes/<lang>/` equivalents | Haiku (mechanical once the generator exists; Sonnet writes the generator) |
| 4.5 | Declare the remaining machines in `templates/machines/` (portal health, liveness/scan-history, reply candidate, agent inbox, PDF flag, apply gate, interview round, triage verdict, legitimacy tier, red-flag level) and point their code at the registry. **Declaring is behaviour-neutral; enforcing follows each one's own warn → enforce cycle** | Sonnet for code-backed machines; Haiku for prose-only declarations |

### Phase 5 — Enforce and ratchet

| # | Task | Model |
|---|---|---|
| 5.1 | `validate-state-machines.mjs` wired into `test-all.mjs` (§4.7) | Sonnet |
| 5.2 | Generated `docs/STATE-MACHINES.md` with Mermaid diagrams plus a staleness test | Haiku |
| 5.3 | After one release of warn mode with the warnings reviewed, flip the Phase 3.4 guards to enforce (if the owner agrees) | Sonnet |
| 5.4 | Consolidate locks onto `lib/file-lock.mjs` (`followup-seed`, `agent-inbox`, `plugins.lock`); bash keeps its own lock but adopts the same stale-recovery rules | Sonnet |

---

### Progress log (2026-11-11)

Phase 0 and Phase 2 were run by parallel subagents; each branch was reviewed by the main session and merged into a throwaway `integration/phase-0-2` worktree. Nothing is on `main`, nothing is pushed.

| Item | Branch | State |
|---|---|---|
| 0.1 | — | done: §2.3b |
| 0.2 | — | done: corrections applied above; M8 narrowed, M1/M2/M3/M4/M5 line numbers fixed |
| 0.3 | `test/repro-m1-m5-known-red` | both bugs **reproduced**; tests gated by `JOBBER_REPRO=1`; 3 of 9 assertions red (2 M1, 1 M5) |
| 0.4 | `test/status-alias-corpus-phase-0-4` | 371 rows; one conflict (`monitor`); Go column is a hand port (see D8) |
| 2.1 | `fix/web-status-write-honest` | done; component edits covered by `tsc` and review only (no DOM test tooling) |
| 2.2 | `fix/web-job-done-explicit` | done; small server change (`timedOut` flag) |
| 2.3 | `fix/update-dismiss-lock-recovery` | done; no real `apply` or SIGKILL run |
| 2.4 + 2.6 | `docs/tracker-hired-states` | done |
| 2.5 | `fix/explore-phase-timers` | race reproduced and fixed |

**Phase 0 + 2 are merged into `main` (fast-forward, 2026-11-11, not pushed).**

**Phase 1 (characterization, no behaviour change)** — three branches, merged into `integration/phase-1`, gate `test-all --quick` **5532 passed / 2 failed** (same two pre-existing failures; +58 passes). Not yet on `main`.

| Item | Branch | What it pins |
|---|---|---|
| 1.1 | `test/status-normalizers-golden` | real `resolveCanonicalState`, `computeTrackerStats`, followup-cadence, merge-tracker, normalize-statuses, verify-pipeline and web `canonStatus` over all 371 corpus rows + a `zzz-not-a-status` probe. **Skipped:** analyze-patterns (private function, script runs on import, hard-coded `data/applications.md`), dedup-tracker (no status table), Go (not installed) |
| 1.2 | `test/status-list-parity-phase-1-2` | each hard-coded list in six root scripts and the Go sources vs `states.yml`, with a 79-entry allowlist that fails on a new difference and on a stale entry |
| 1.3 | `test/set-status-transition-matrix` | all 162 (from, to, `--force`) cells of `set-status` plus status-log content; `M1_FIXED = false` pins the non-canonical bug and is flipped in Phase 3.2 |

New facts from Phase 1: (a) **`SKIP` is not terminal** — only Rejected, Discarded and Hired refuse without `--force`; the `transitions:` table is documentation, so Interview→Hired and Offer→Evaluated succeed unforced. (b) A forced terminal exit writes the same `status-log.tsv` row as any change, so overrides are invisible to `funnel-velocity`. (c) `stats.mjs` and `followup-cadence.mjs` lack the `hired` aliases that `states.yml` has (`accept`, `accepted`, `contratado`, `contratada`). (d) `merge-tracker`'s CLI treats `DUP`, `—`, `-`, `N/A` in the status column as score sentinels and skips the whole row (`tracker-parse` `looksLikeScoreCell`), so the corpus's per-spelling cells for those three are wrong. (e) 42 corpus cells for whitespace/bold-wrapped spellings were wrong: real `resolveCanonicalState` trims and strips `**`.

**Phase 1 is merged into `main` (fast-forward, not pushed).**

**Phase 3 (registry and gate), partly done** — six branches merged into `integration/phase-3`, gate `test-all --quick` **5684 passed / 2 failed** (same two pre-existing failures). Not yet on `main`. Plus one fix commit on the integration branch: `lib/status-gate.mjs` was missing from `SYSTEM_PATHS`, so `update-system` would not have shipped it and `set-status` would crash after an update.

| Item | Branch | State |
|---|---|---|
| 3.1 | `feat/state-machine-runtime` | done: `lib/state-machine.mjs`, `machines.mjs` (`list`/`describe`/`check`), `tracker-utils` wrappers, AGENTS.md pointer |
| 3.2 + 3.4 | `feat/set-status-gate` | done: `set-status` decides through `check()`; M1 bug fixed; dated terminals (`Rejected 2026-02-01`) stay refused; `reply-watch` in warn mode (applies the move, logs `WARN illegal transition`); repro tests became regression tests; `M1_FIXED = true` |
| 3.3 | `refactor/scripts-use-state-registry` | **partial**: `analyze-patterns`, `merge-tracker`, `verify-pipeline` use the registry plus `lib/status-extra-aliases.mjs`. **Blocked:** `stats`, `followup-cadence`, `normalize-statuses`, because deriving from the registry gains spellings the golden test pins as unknown (`contratado`, `contratada`, `accept`, `accepted` in stats/followup-cadence; `rechazado` in normalize-statuses). Needs a named behaviour change (D10) |
| 3.5 | `fix/sentinel-gc-unified` | done: one locked GC; keeps a sentinel on live PID or a `processing` batch row; repro green and un-gated. `gcStaleSentinels` is now async |
| 3.6 | `fix/pipeline-inbox-single-writer` | done: `lib/pipeline-inbox.mjs`, all pipeline.md writers locked and atomic; OpenRouter rows now move to Processed; `[!]` written only on an OpenRouter evaluation error. Not wired: `cmdEvaluate` null results, non-English/Spanish section headers (D11) |
| 3.7 | `fix/plugin-lock-hardening` | done: corrupt `plugins.lock` refused, atomic locked writes, `repin()` failures reported, `default` fails closed. `unpinned` auto-pin and bundled drift untouched (D9). New `acquireLockSync` in `lib/file-lock.mjs` |

New decisions: **D10** may `stats`, `followup-cadence` and `normalize-statuses` gain the spellings `states.yml` already accepts (a named behaviour change with updated golden pins)? Recommendation: yes. **D11** should a failed `cmdEvaluate` mark `[!]`, and should code learn the other localized pipeline headers? Open flake to watch: one `--quick` run on 3.5 showed 3 failures that never reproduced (provider-health `--ci` cached run; passes alone).

**Phase 3 is merged into `main` (not pushed).**

**Phase 4 (consumers), partly done** — `integration/phase-4` holds three branches. Gate: `web` `npm test` 118/118, `tsc --noEmit` clean, `next build` OK, `test-all --quick` **5745 passed / 2 failed** (same two pre-existing failures). Not yet on `main`.

| Item | Branch | State |
|---|---|---|
| 4.1 | `feat/web-state-registry` | done: `state-model.ts` (pure), `states.ts` reads `states.yml`, `MachineProvider`, `GET /api/machines/application-status`, `StatusSelect` shows legal moves first; a terminal cell is disabled with a CLI hint (corrections only offered for live states, because the server refuses terminal exits with 409) |
| 4.2 | `feat/go-state-registry` | **done** (see the 4.2 note below); D8 closed, D3 and D5 taken as recommended |
| 4.3 | `feat/batch-state-machine` | done: `templates/machines/batch-job.yml`, generated block in `batch-runner.sh` via `batch/gen-states.mjs`, `tests/batch-state-machine.test.mjs` |
| 4.4 | `feat/machine-doc-blocks` | done: `gen-machine-docs.mjs` (`--check`), `lib/machine-blocks.mjs`, generated blocks in AGENTS.md and `modes/{tracker,patterns,outcome,followup,reply-watch}.md`; translated modes not yet covered |
| 4.5 | 4 branches on `integration/phase-4-5` | **done (declarations only, no code swaps, nothing enforced)**: `portal-health`, `scan-history`, `reply-candidate`, `agent-inbox`, `pdf-flag`, `apply-gate`, `triage-verdict`, `red-flag-level`, `legitimacy-tier`, `interview-round`, `interview-round-outcome` — 11 machines, 13 total with `application-status` and `batch-job`. Gate `test-all --quick` **6058 passed / 2 failed** (same two pre-existing). Not yet on `main` |

**Phase 4.5 is merged into `main` (not pushed).**

**Phase 5 (enforce and ratchet), partly done** — three branches plus one integration fix on `integration/phase-5`. Gate `test-all --quick` **6117 passed / 2 failed** (same two pre-existing); `validate-state-machines` and `gen-machine-docs --check` pass. Not yet on `main`.

| Item | Branch | State |
|---|---|---|
| 5.1 | `feat/validate-state-machines` | done: `validate-state-machines.mjs` (registered in `SYSTEM_PATHS`) wired into `test-all`; rule 1 (49 allowlisted hard-coded state lists in 29 files, shrink-only, stale entries also fail), rule 2 (writers), rule 3 (generated blocks, calls the existing `--check`s), rule 4 left to the existing parity tests (they execute on import, nothing callable). Known blind spots (wrappers, object-field paths, regex literals with quotes) are in its header |
| 5.2 | `feat/state-machines-doc` | done: generated `docs/STATE-MACHINES.md` (13 machines, Mermaid), `gen-machine-docs --check` verifies it, LF-normalised so CRLF checkouts are not stale |
| 5.3 | `feat/reply-watch-enforce`, `feat/normalize-statuses-gate` | done at the owner's instruction, without a release of warn evidence (D7 per guard): `reply-watch` and `normalize-statuses` now enforce by default, `JOBBER_REPLY_WATCH_GATE=warn` / `JOBBER_NORMALIZE_GATE=warn` restore warn mode; `set-status` has enforced since 3.2. No guard remains in warn mode. Merged into `main` and pushed. |
| 5.4 | `feat/lock-consolidation` | done: `followup-seed` onto `lib/file-lock.mjs` (owner key `startedAt` → `started_at`); `agent-inbox` add/resolve now locked and atomic (positional `resolve N` unchanged); `plugins.lock` and `.update-lock` already on the shared lock; `batch-runner.sh` state lock adopts the same stale rules (dead pid recovers, live pid never, ownerless recovers by age, guard dir serialises reclaim). The M6 "silent lock-free fallback" no longer exists: the code already warns loudly (plan note was stale); parallel mode errors out when the lock is unavailable |

**Phase 5 is merged into `main` (not pushed).** The plan file itself is committed (a literal block marker in it had to be reworded because the scanner read it as malformed).

**3.3 remainder, done on `refactor/scripts-registry-d10` (D10 taken as recommended: yes).** `followup-cadence`, `stats` and `normalize-statuses` now resolve statuses through the registry. Named behaviour change: `stats` and `followup-cadence` gain `contratado`, `contratada`, `accept`, `accepted` (unknown → hired, 16 spellings incl. case and wrapped variants); `normalize-statuses` gains `rechazado` (unknown → Rejected, 6 spellings). No other golden cell changed. Parity allowlist 79 → 71. Side effect: input like `constructor` is now unknown instead of resolving to an object-prototype function (old `ALIASES[clean]` bug). `stats` keeps its own bucket display order, because registry order would move Hired. `rate_limited` in `stats` untouched (D12). Gate `test-all --quick` **6117 passed / 2 failed** (same two).

**Phase 5.3 is merged into `main` and pushed.**

**Phase 4.2 (Go dashboard), done on `integration/phase-4-2`.** Go 1.27.4 was installed with winget at the owner's request (**D8 closed**). D3 taken as recommended (writes shell out to `set-status.mjs --json`), D5 taken as recommended (Offer and Hired tabs). Real Go `NormalizeStatus` matches the hand-ported corpus column in all 371 rows (0 wrong cells); `TestNormalizeStatusMatchesCorpus` now gates the Go column. Stages: (1) `gen-go-states.mjs` (registered in `SYSTEM_PATHS`) generates `dashboard/internal/data/states_gen.go`, `tests/go-states.test.mjs` fails when stale; 7 hard-coded Go state-list sites removed from the validator allowlist, the rest (NormalizeStatus matcher with substring and Turkish matching, priority order, colours, i18n) stay hand-written and are pinned to the registry by Go tests; (2) `setstatus.go` runs `node set-status.mjs <sel> <State> --json`, never `--force`, typed `SetStatusError`, `node-missing` handled; (3) one `overlay` enum (28 golden `View()` cases captured from the old code, byte-identical after), hired celebration only after a confirmed write, write errors shown in the TUI, Offer and Hired tabs. Gate: `go vet` clean, `go test ./...` 223 passed, `test-all --quick` 6136 passed / 2 failed (same two), `go.mod` and `go.sum` unchanged.

Behaviour changes in 4.2 to name: (1) TUI status writes go through the gate, so leaving Hired/Rejected/Discarded is refused with set-status's text, and that text ends in a `--force` hint the TUI cannot act on; (2) every write adds a `status-log.tsv` row, takes the shared tracker lock and canonicalises the label (the picker's "Skip" is written `SKIP`); (3) a discard or skip note is joined with `; ` and is idempotent (was space-joined); (4) writes run asynchronously and need `node` on PATH; (5) the report viewer updates its shown status only on success (before: also on failure); (6) no hired celebration on a failed write or a no-op re-select; (7) Hired gets a proper status label instead of raw `hired`; (8) the tab row now has 11 tabs and shows a window with ‹ › markers when it does not fit.

**Follow-up done (`chore/remove-go-writers`):** the deprecated direct Go writers are deleted (`UpdateApplicationStatus`, `UpdateApplicationStatusAndNotes` and their helpers `appendNotesInLine`, `replaceStatusInLine`, `statusCellIndex`, `isCanonicalStatusValue`, `spliceCellValue`), together with the Go tracker lock and atomic-replace code that only they used (`tracker_lock.go`, `tracker_replace_*.go`, `tracker_process_*.go`) and their six tests plus `tracker_lock_test.go`. The dashboard no longer writes `applications.md` at all; `career.go` was removed from the `application-status` `writers`. Still open from the original list: Follow-ups left:  a force-confirm UI for the refusal hint; remove the dead `pdfPicker` overlay (no key opens it); the `monitor` conflict (Go `evaluated` vs JS `skip`) is still D2.

**5.3 (enforce flip), done on `feat/reply-watch-enforce` at the owner's instruction, WITHOUT the planned release of warn-mode evidence.** The only guard still in warn mode was `reply-watch` (`set-status` has enforced since 3.2). `data/status-log.tsv` held 3 rows and no `WARN illegal transition` note, so there were no warnings to review; the flip rests on the owner's go-ahead and on D1(a) (live-to-live backward moves stay free, only leaving Hired/Rejected/Discarded is refused). Behaviour change: when an operator-approved reply classification would leave a terminal state (e.g. a later "interview" email on a Rejected row), `reply-watch` now REFUSES it, leaves the row and ledger untouched and prints `Refused #N: illegal transition X -> Y ... node set-status.mjs N <State> --force`. Before, it applied the move and logged a WARN. Escape hatch: `JOBBER_REPLY_WATCH_GATE=warn` restores the 3.4 behaviour. Test `tests/reply-watch-warn.test.mjs` became `tests/reply-watch-gate.test.mjs` and pins both modes (7 enforce cells, 7 warn cells). Gate `test-all --quick` **6124 passed / 2 failed** (same two). Not yet on `main`. Not covered: `normalize-statuses` was meant to route through the gate in 3.4 but never did (it is a bulk normaliser with its own D4 flag-and-keep rule); `modes/reply-watch.md` and its translations do not yet mention the refusal.

**5.3 for `normalize-statuses`, done on `feat/normalize-statuses-gate`.** The bulk normaliser now routes every status rewrite through `applyStatusChange` (shared gate), ENFORCE by default; `JOBBER_NORMALIZE_GATE=warn` applies the change with a WARN instead. A refused row is kept as it was and listed under `kept (change would leave a final state)` with the `node set-status.mjs N <State> --force` override. `unknown-from` warnings are suppressed (junk cells are what this tool fixes). Honest limit: with today's alias data no real cell both resolves to a final state and normalizes to a different state, so the refusal branch is a seatbelt that input cannot reach yet; the decision logic is covered by the status-gate library tests. `tests/normalize-statuses-gate.test.mjs` (spawned, enforce + warn) pins that spelling fixes still land, final and unknown rows stay untouched and the gate adds no output. Gate `test-all --quick` 6138 passed / 2 failed (same two). Not yet on `main`.

**M30 (Notion status canonicalisation), done on `fix/notion-status-canon`.** The Notion plugin no longer keeps its own copy of the state list: `canonicalStatus` resolves through the registry (`resolveStatusCell` for exact, **bold** and dated cells, then the shared extra spellings), so `Rejected 2026-02-01`, `condicional`, `hold` and `geo blocker` now reach Notion as `Rejected`, `Evaluated` and `SKIP` instead of being dropped. A status that still resolves to nothing is not sent (Notion would mint a stray select option); the row is pushed without a Status, `ctx.log` names the row and the value, and `export` returns `unknownStatuses`. Plugin version 1.0.0 -> 1.0.1 (bundled, so no registry pin). Not fixed: the upsert still takes `dupes[0]` with no lock (the other half of M30). `tests/notion-status.test.mjs` (13 spellings plus an export against a mock Notion, no network). Gate `test-all --quick` 6141 passed / 2 failed (same two). Not yet on `main`.

**TUI force-confirm, done on `feat/tui-force-confirm` (owner chose "add confirm step").** Named behaviour change: the Go dashboard used to print the refusal and stop; now, when `set-status` refuses a move out of Hired/Rejected/Discarded (`illegal-transition`), the flash reads `Status not changed: <first sentence> — press y to force it, any other key cancels.`. `y` re-runs the same write through `data.SetStatusForced` (`--force`) once; any other key cancels and is not also a command; a forced write that fails is not re-prompted; only a terminal refusal offers it (not-found etc. do not). Why safe: `--force` also lifts `set-status`'s report-mismatch and `--role` wrong-row guards, but the unforced attempt already passed both on the same row before the gate refused, so the forced re-run targets that row. The ordinary write path still never passes `--force`. Tests: `main_status_test.go` (y/other-key/no-loop/non-terminal), `setstatus_test.go` (flag only on the forced variant), real-script check in `setstatus_integration_test.go`. Gate `test-all --quick` 6141 passed / 2 failed (same two); `go test ./...` passes. Not yet on `main`.

**D9 (bundled plugin re-pin), done on `fix/plugin-repin-warning` (owner chose "warn", no consent prompt).** `lockGate` in `plugins/_engine.mjs` still re-pins and loads a BUNDLED plugin whose files changed without a version bump, but now prints one warning naming the plugin and up to five changed files; the re-pin makes it a one-time notice per change. Unchanged, version-bumped (`legit-update`) and already-pinned plugins stay silent; a LOCAL plugin with the same drift is still refused and not re-pinned (unchanged). Named behaviour change: users who edit or pull an un-bumped bundled plugin see one stderr line. `tests/plugin-repin-warning.test.mjs` (warn + load + re-pin, plus four controls). Gate `test-all --quick` 6150 passed / 2 failed (same two). Not yet on `main`.

**D12 (`rate_limited` in `stats`), done on `fix/portal-health-rate-limited` (aligned with `scan.mjs`).** `stats.mjs` computePortalStats now treats `rate_limited` as the neutral class the scan uses ("throttled, not dead": it neither extends nor resets the failure streak), so `stats` no longer calls a portal persistently dead that `scan` would still probe. Named behaviour change: the "persistently dead" count in `stats` can drop for portals whose recent runs were HTTP 429s. The pinned drift in `tests/machine-portal-health.test.mjs` became a fixed-behaviour test with two controls (a 429 after a failure does not reset it, in both `stats` and `scan`); `templates/machines/portal-health.yml` and the generated `docs/STATE-MACHINES.md` no longer name the drift. Not fixed: the classification is still copy-pasted three times (a shared fold would pull scan.mjs' provider imports into stats). Not yet on `main`.

**D11 (pipeline inbox), done on `fix/pipeline-inbox-d11` (both halves, as offered).** (1) A failed evaluation in `openrouter-runner.mjs` `cmdPipeline` now marks the row `[!]`: a throw keeps its own message (as before) and a `null` report (fetch failed / provider error / no report number) now gets the reason `evaluation produced no report (see the log above); re-queue as - [ ] to retry`. Named behaviour change: such a row used to stay `- [ ]` and be re-tried on every run (including transient failures); now it needs a manual re-queue. The decision is the pure `pipelineFailureReason(report, evalError)`. (2) `lib/pipeline-inbox.mjs` now recognises the section headers of every `modes/<lang>/pipeline.md` (`SECTION_HEADERS`, 15 languages; ar/ja/zh/zh-TW keep the English ones) for parsing, `appendPending` and `markProcessed`; a Processed section the code has to create reuses the language of the Pending header. Before, a localized file got a second English `## Processed` section. Headers are matched as whole lines (`## Pending Review` is not a Pending section). `tests/pipeline-inbox-localized.test.mjs` cross-checks the table against the real mode files and covers parse, markProcessed (existing and created section), appendPending, English controls and the failure reasons. Not covered: end-to-end `cmdPipeline` with a live provider (the runner has no seam; the reason helper is tested directly). Gate `test-all --quick` 6163 passed / 2 failed (same two). Not yet on `main`.

**D6 (interview-round vocabulary), decided on `fix/interview-rounds-d6`: the merged set with aliases, as the plan recommended.** `templates/machines/interview-round.yml` (canonical ids `screen | hiring-manager | technical | system-design | behavioral | onsite | final`; aliases `recruiter-screen`/`screening` -> `screen`, `design-case-study` -> `system-design`, `peer-tech` -> `technical`, `panel-mixed` -> `onsite`) and `interview-round-outcome.yml` change from PROPOSED to DECIDED. No behaviour change: the set was already a superset, every spelling in modes/interview, modes/interview-prep and the de/es/fr/pt/zh mirrors already resolves (`tests/legitimacy-interview-machines.test.mjs`), no script reads `round:` today, and existing prep/session files stay valid. Two judgement aliases are now accepted rather than provisional: `peer-tech` -> `technical` is lossy (it also covers system design and take-home review) and `panel-mixed` -> `onsite`. Nothing in the modes was rewritten; the prep file keeps the audience spellings.

**D13 (legitimacy `unconfirmed` / `unknown`), done on `fix/legitimacy-fold-d13`: folded to `unconfirmed`.** `eval-runner.mjs` `parseScoreSummary` now returns `legitimacy: 'unconfirmed'` both when the SCORE_SUMMARY block is absent and when only the `LEGITIMACY:` line is missing (the per-key `extract` takes a `miss` default; every other key still falls back to `unknown`). `openrouter-runner.mjs` already wrote `unconfirmed`, so all writers now agree and `analyze-patterns.mjs` groups them together. Named behaviour change: a report from the Gemini/OpenAI/Ollama evaluators without a tier now carries `**Legitimacy:** unconfirmed` instead of `unknown`. `unknown` stays a declared alias in `templates/machines/legitimacy-tier.yml`, so reports written before this still resolve; they are not rewritten, so old `unknown` reports still group apart from new ones in `analyze-patterns`. `tests/legitimacy-interview-machines.test.mjs` pins the new strings plus two controls (a missing non-legitimacy key still yields `unknown`; the legacy spelling still resolves). Not changed: the `modes/interview-prep.md` template line that says `"unknown"` when no evaluation report exists (a different context, covered by the alias); the empty string from `lib/score-summary.mjs` and the rendered/substring forms stay known gaps. Gate `test-all --quick` same two failures as before.

**Notion upsert (`dupes[0]` + race), done on `fix/notion-upsert-lock`.** Two defects in `plugins/notion/index.mjs` `export`. (1) Find-then-create was not atomic: two exports at once both missed the row and created it twice. A real push now runs under the shared `lib/file-lock.mjs` advisory lock (`withLock`, a lock dir `jobber-notion-<data source id>.lock` in the OS temp dir, 120 s timeout), so the second export waits, then finds the row and updates it; a dry run writes nothing and takes no lock. (2) With several rows for one company+role only `dupes[0]` was patched, and Notion returns rows in no fixed order, so a different stale copy was left each run. Every exact (case-insensitive) match is now updated, with one warning naming the count; a near-match such as `Engineer Lead` is untouched. Named behaviour change: all duplicates are updated, none are deleted or merged. The row loop moved into `pushRows` (unchanged logic apart from the above); manifest 1.0.2 so a locally re-pinned `plugins.lock` reads as a legitimate update. `tests/notion-upsert-lock.test.mjs` (stateful mock fetch) pins both with controls (sequential exports, dry run, single row) and was confirmed to fail on the old code. Limit: the lock is per machine (an OS-temp lock dir), not a distributed lock, so two machines exporting to one DB can still race; the per-row `findRecords` still queries the whole DB each time (cost, not correctness). Gate `test-all --quick` same two failures as before.

**`cmdPipeline` end-to-end test, done on `test/cmdpipeline-seam` (closes the gap named under D11).** `openrouter-runner.mjs` `cmdPipeline` is now exported and takes an optional `{ evaluate, pipelinePath, delayMs }` (defaults `cmdEvaluate`, `data/pipeline.md`, the 2.5 s rate-limit pause); `readPipeline` and `markPipelineDone` take the file path too. Production passes nothing, so behaviour is unchanged (a missing pipeline file still reads as empty). `tests/openrouter-pipeline-e2e.test.mjs` runs the real inbox writers against a temp file with a fake evaluator and pins: every row is evaluated in order and the loop continues past a failure; a success moves to Processed with its report number; a throw becomes `[!]` with its message; a `null` report becomes `[!]` with the generic retry reason; failed rows stay in Pending. Controls: an all-success run has no `[!]`, an empty inbox calls nothing and rewrites nothing, a missing file is "nothing pending". Not covered: `cmdEvaluate` itself (fetch + provider call + report write) still has no seam. Gate `test-all --quick` same two failures as before.

Rule-2 drift found by 5.1 and fixed at integration (documentary, no behaviour): `application-status` declared no `writers`, so it now lists `set-status`, `tracker-utils`, `reply-watch`, `merge-tracker`, `dedup-tracker`, `normalize-statuses` and `career.go`; `pdf-flag` gained `generate-pdf.mjs`; `scan-history` gained `openrouter-runner.mjs`. The rule-2 allowlist is now empty.

Behaviour changes in 5.4 to name: `add` on the agent inbox waits up to 60 s for a held lock and leaves a transient `data/agent-inbox.md.lock`; an ownerless, old batch state lock is now recovered instead of timing out after 30 s; `STATE_LOCK_TIMEOUT_SECONDS` is env-overridable and `STATE_LOCK_STALE_SECONDS` is new. Known gap: bash `kill -0` treats a pid owned by another user as dead, where the Node lib treats `EPERM` as alive.

Findings from 4.5 (all pinned in tests, none changed): (1) **M13 correction:** a false `skipped_expired` is permanent *even with* `recheck_after_days` — `shouldDedupScanHistoryRow` (`scan.mjs:911-923`) returns true for every non-`added` status before it reads the recheck setting; only `added` rows are rechecked. (2) `stats.mjs:295` counts `rate_limited` as a failure while `scan.mjs` skips it as "throttled, not dead", so `stats` can call a portal dead that `scan` would still scan; the classification is copy-pasted 3×. Fixing needs a decision (**D12**). (3) pdf-flag: `merge-tracker` upgrades only `❌`, `sync-pdf-flags` upgrades anything not `✅`; a full merge hides the gap because it calls sync at the end. The PDF cell can also hold a file path. (4) legitimacy-tier: `unconfirmed` (openrouter-runner) and `unknown` (eval-runner) are distinct strings in code today and group separately in analytics; declared as one extra state `unconfirmed` (alias `unknown`), departing from "English tiers only" (**D13**: fold or keep?). zh/zh-TW label the 3rd tier "suspected fake / EXPIRED" while English means ghost indicators only; ru/de/es/fr/pt emit no tier at all (M37). Web `legitimacyTone()` matches substrings, so every translated tier label renders "muted". (5) interview-round: a third vocabulary exists (`screening / technical / design-case-study / behavioral`); `peer-tech → technical` is lossy and `panel-mixed → onsite` is a reading — **D6 still open**, yml marked "proposed, pending D6". (6) apply-gate has only `filled` and `submitted`; the plan's `not-started` and "awaiting user review" appear nowhere in the docs and were not invented. (7) reply-candidate has no lifecycle field: `pending` is "exists in the file", classification is recomputed every run, `paste-reply` synthesizes a new `message_id` per paste. (8) agent-inbox `resolve N` positional hazard pinned by a test.

Named behaviour change from 4.1: web `canonStatus` now trims whitespace and strips `**`, so wrapped spellings (`**Applied**`, ` Applied `) resolve like the CLI instead of passing through unknown. 4.1 also silently disabled the Phase 1 web golden check (`format.ts` imports `@/lib`, so the adapter warned and skipped); fixed by pointing the adapter at `state-model.ts` and pinning the 32 spellings that differ from the corpus. Lesson: a golden adapter that warns-and-skips on import failure hides regressions; consider making that a failure in Phase 5.

Gates on the Phase 0 + 2 integration branch: `web` `npm test` 93/93, `tsc --noEmit` clean, `test-all --quick` **5474 passed / 2 failed** (the same two pre-existing failures as `main`, +8 net passes from new tests). `go test` not run (Go not installed).

## 6. Decisions the owner must make (the plan will not guess)

| # | Question | Options | Recommendation and why |
|---|---|---|---|
| **D1** | Should backward moves between live states (e.g. Interview → Applied) stay free? | (a) Free, logged as a correction (today) · (b) Allowed only with `--correction`, refused otherwise | **(a) for the CLI, plus a confirm in the UIs.** Fixing a mistaken status is common, and blocking it pushes people to hand-edit the table, which is worse for data integrity. The UI confirm is enough of a speed bump |
| **D2** | `monitor` means `skip` (YAML) or `evaluated` (Go)? Should `condicional`, `hold`, `evaluar`, `verificar`, `geo blocker` become official aliases, and of which state? | per alias | The corpus from 0.4 will show how often each appears in real trackers. Choose **only after seeing it**. Until then each call site keeps today's behaviour |
| **D3** | How should the Go TUI write statuses? | (a) Shell out to `set-status.mjs` · (b) Port the gate and log append to Go | **(a):** one gate, one log format, identical error text, no drift. The cost is a ~50 ms process start per write, which is unnoticeable in a TUI |
| **D4** | What happens to an unknown status string on write? | reject · flag and keep · map to Evaluated with a note | **reject on interactive writes, flag-and-keep on bulk tools (merge, normalize).** Never silently map: silent mapping is how real statuses get lost |
| **D5** | Should the TUI get `Offer` and `Hired` tabs? | yes · no | **Yes**, for parity with the web app; it's cheap |
| **D6** | One interview-round vocabulary? | the debrief/practice set · the interview-prep set · a merged set | **Merged set with aliases** (e.g. `recruiter-screen` ≈ `screen`), so existing prep files remain valid | **DECIDED: merged set with aliases (see log).**
| **D7** | Should old warn-mode guards become enforcing (Phase 5.3)? | after one release · never · per guard | **Per guard, after reviewing the warning log** |
| **D8** | Go is not installed on the dev machine used so far, so `go test ./...` and the real `NormalizeStatus` output cannot be run. How do we close that? | install Go · run the Go gate in CI/another machine · skip Go phases | **Install Go** before Phase 1.1/4.2. The alias corpus's Go column is a hand port, not real output |
| **D9** | Bundled plugins whose files changed without a version bump are re-pinned and loaded silently (`_engine.mjs:579`). Keep that trust assumption? | keep · warn · require consent | **Warn at least**; consent is stricter than the "reviewed-by-construction" comment justifies |

---

## 7. Verification at every phase

1. `node test-all.mjs --quick`: ≥ baseline passes, no new failures; compare against the stored baseline log.
2. `cd web && npm test && npx tsc --noEmit` whenever `web/` changes.
3. `cd dashboard && go test ./...` whenever `dashboard/` changes.
4. The batch tests in `tests/batch-*.test.mjs` whenever `batch/` changes.
5. Golden tests (Phase 1) stay green unless a named, approved behaviour change says otherwise.
6. Manual smoke test in the web UI (via the `run` skill) for UX changes. Each scenario names its expected result:
   - change a status: the change succeeds
   - try a terminal-state exit: the server's message is shown
   - cut a run mid-stream: the job shows as an error, not "done"
7. The main session reviews every subagent diff before it is committed. Subagent output is a claim, not proof.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Merging alias maps changes how real statuses are read | Corpus + golden tests (Phases 0.4/1.1); aliases are a superset; conflicts are owner DECISIONs |
| New guards block legitimate work | Warn first, enforce later; `--force` always available; refusals say how to proceed |
| Go shelling out fails where `node` is missing | Jobber requires Node already (`doctor.mjs`); the TUI detects this and shows a clear message instead of failing silently |
| Generated blocks in modes confuse translators | Markers are HTML comments; `check-translation-freshness.mjs` is taught to ignore generated regions |
| CI can't run (billing) | Local gates (§7) are mandatory; re-run CI once billing is fixed before merging anything |
| Scope creep | Each phase is its own PR; Phase 2 is shippable even if the rest stops |

## 9. Definition of done

- Every machine in §2 is declared in `templates/states.yml` or `templates/machines/`.
- No canonical list is hard-coded outside the registry or generated files, and the ratchet enforces this.
- Every persisted state has exactly the writers its `writers:` lists.
- No UI reports success it didn't get, and every refusal names the legal moves.
- `node machines.mjs describe <id>` answers any agent question about states, and `docs/STATE-MACHINES.md` is generated.
- test-all is at baseline or better; web, Go and batch suites are green; owner decisions D1–D7 are recorded in this file.

## 10. Effort (rough)

| Phase | Size | Can stop after? |
|---|---|---|
| 0 Inventory | S | — |
| 1 Characterization | S–M | yes (drift is caught from here on) |
| 2 Honest UX | S | **yes — highest value per hour** |
| 3 Registry + gate | M | yes |
| 4 Derivation | M–L | yes, per runtime |
| 5 Ratchet + enforce | S–M | — |

**Recommended first step:** Phase 0 and Phase 2 in parallel. Phase 2's fixes are VERIFIED or near-certain, independent of the registry, and remove the user-visible false-success cases right away.
