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
7. **Baseline:** `node test-all.mjs --quick` currently reports 5473 passed and 3 failed. The 3 failures are pre-existing and unrelated: a DNS-dependent SSRF check, the provider-health `--ci` cached run, and stale translations. Every phase must end at **≥ baseline passes with the same or fewer failures**. GitHub Actions on this repo currently cannot start jobs because of an account billing issue (see PR #85), so local runs are the gate until that is fixed.

---

## 2. What we found — the machine catalogue

Risk combines likelihood of data loss or corruption, user-visible lies, and drift surface.

### 2.1 Critical / high

**M1 — Application status lifecycle** (`data/applications.md` + `data/status-log.tsv`; declared in `templates/states.yml`). Risk: **critical.**

- **VERIFIED** — `set-status.mjs:386-404` gates only exits *from terminal states*. Forward edges in the `transitions:` table are documentation, not enforcement. The `states.yml` comment says this on purpose: live states are free-form so that corrections stay possible.
- **VERIFIED by reading, not yet executed** — `set-status.mjs:387,390`: `oldId` is looked up by exact label. If the existing cell is non-canonical (e.g. `Evaluada`, `Applied 2026-01-05`), `oldId` is `undefined`. Then `transitions[undefined] ?? []` is empty, so the row is treated as **terminal** and the change is refused without `--force`. A live row looks frozen.
- **VERIFIED** — `tracker-utils.mjs:357` exports `canTransition()`, but nothing outside that file calls it.
- **VERIFIED** — the `states.yml` comment says *"The dashboard reads this table too."* This is false: no Go file parses YAML (`dashboard/go.mod` has no YAML dependency), and none references `transitions`.
- **REPORTED** — the canonical list is hard-coded **≈20 times**:
  - **root scripts:** `merge-tracker.mjs:163,193-208`, `normalize-statuses.mjs:69-90`, `verify-pipeline.mjs:47` (declares `STATES_FILE` but uses its own list), `followup-cadence.mjs:~80,100`, `analyze-patterns.mjs:~85,113,118,122`, `stats.mjs:37,43,48`, `dedup-tracker.mjs`, `lib/sunset-policy.mjs:16`, `outcome.mjs:53`, `reply-matcher.mjs:392-414`, `company-history.mjs:68`, `funnel-velocity.mjs:63`, and the `*-eval.mjs` prompts
  - **web:** `lib/format.ts:41-51`, `app/actions/registry.ts:18`, `components/pipeline-view.tsx:15-26`, `app/analytics/page.tsx:7-16` (**omits SKIP**, uses substring matching), `api/assistant/route.ts:27`
  - **Go:** `career.go:508,872,903`, `pipeline.go:128-154,203-213,252`
  - **VERIFIED** — parity tests (`test-all.mjs` 55.3/55.3b) cover **only the web lists**.
- **REPORTED** — alias drift:
  - `condicional|hold|evaluar|verificar|geo blocker` are accepted by four root scripts but are not in `states.yml`, so strict `set-status` rejects them.
  - `monitor` is `skip` in YAML but `evaluated` in Go: a **real conflict**.
  - Go adds Turkish aliases that YAML lacks.
- **REPORTED** — unknown status is handled six different ways:
  - mapped to `Evaluated` with a warning (`merge-tracker`)
  - mapped to `Evaluated` with a `[sync: …]` note (`tracker.mjs`)
  - flagged and left alone (`normalize-statuses`)
  - an error (`verify-pipeline`)
  - counted as `Unknown` (`stats`)
  - `—` mapped to `Discarded` (`normalize-statuses`)
- **REPORTED** — writers that bypass the gate:
  - `reply-watch.mjs:170-215` can move Hired/Rejected → Responded/Interview
  - `normalize-statuses` writes directly
  - **VERIFIED** — the **Go TUI** writes `applications.md` directly (`career.go:671,684`). It never calls `set-status.mjs` and never appends to `status-log.tsv` (only `web/src/app/api/status/route.ts` and Node scripts reference the log). So the TUI can do Rejected → Interview, and `funnel-velocity` loses those events.
  - The good paths: `outcome.mjs` and `sunset.mjs --apply` delegate to `set-status`.
- **VERIFIED** — `modes/tracker.md:21` lists the lifecycle **without `Hired`**.

**M2 — Web status-write UX** (`web/src/components/*`, `/api/status`). Risk: **high (the UI misleads the user).**

- **VERIFIED** — `home/decision-card.tsx:23-24` calls `fetch('/api/status')` and then `setDone(status)` without checking `res.ok`. A 409/404/423 still makes the card disappear as if the change succeeded.
- **REPORTED:**
  - `assistant-console.tsx:252-262` ignores the response and says "Marked #n" even when the write failed.
  - `status-select.tsx:28-39` offers all 9 states regardless of the current one. On a 409 it reverts silently and drops the server's explanation.
  - `registry.ts:262` validates again against its own hard-coded list.

**M3 — Dashboard TUI pipeline screen** (`dashboard/internal/ui/screens/pipeline.go`). Risk: **high.** All items REPORTED:
- Overlay mode is a set of booleans plus `hiredStep`, with no single enum, so two overlays can be open at once.
- The "hired" celebration runs even if the write failed; write errors only go to stderr behind the TUI.
- There are no `Offer`/`Hired` tabs, although the web app has them.
- `Esc` in the discard picker commits the status without a reason (documented behaviour).

**M4 — Web agent-run lifecycle** (`api/run/route.ts`, `components/jobs/job-store.tsx`, `lib/core/run-registry.ts`). Risk: **high (false "done").** REPORTED:
- The client marks a job `done` whenever the stream closes cleanly, even with no `done` event.
- On an early `finish('error')` the reader is not cancelled, so the server child keeps holding the tracker-write token.
- The "honesty gate" compares report counts, so concurrent runs can satisfy each other's check (INFERRED).
- A timeout shows a generic error.
- The run registry lives only in memory and is lost on server restart.

**M5 — Report-number reservation** (`reserve-report-num.mjs`, `reports/NNN-RESERVED.md`). Risk: **high (two reports can get the same number).** REPORTED:
- There are two garbage-collection (GC) implementations: a locked one in `reserve-report-num.mjs:~250-281` and an **unlocked** one in `tracker-utils.mjs:403`, which `merge-tracker` and `verify-pipeline` call. The 4h constant is duplicated, and a comment claims there is "one shared implementation", which is false.
- GC uses age only and ignores the stored PID. A batch worker running longer than 4h, or one paused by rate limits, can lose its number, which is then issued again.
- No test exists by name.

### 2.2 Medium

| ID | Machine | Where | Key problems (all REPORTED unless marked) |
|---|---|---|---|
| M6 | Batch job state | `batch/batch-runner.sh`, `batch/batch-state.tsv` | 7 states inlined in ≥3 places (one summary function lumps `rate_limited` into pending); `update_state` accepts any string; a crashed `processing` row re-runs with a **new** report number, leaving an orphan sentinel; retries don't count `processing`/`rate_limited`; a silent lock-free fallback if `mkdir` of the lock fails (`:236`) |
| M7 | `pipeline.md` URL inbox | `scan.mjs`, `reconcile-pipeline.mjs`, `openrouter-runner.mjs`, `archive-posting.mjs` | Two incompatible `[x]` encodings (one moves the row to Processed, one flips it in place); `reconcile-pipeline` and `openrouter-runner` write **without** `pipeline-lock`, so they can lose scanner appends; `[!]` error state is documented but never written; errored URLs stay pending forever |
| M8 | Plugin integrity | `plugins/_engine.mjs:570-585`, `plugins/_lock.mjs:97-115` | **Security:** the `lockGate` switch's `default` is `{load:true}`, so an unknown integrity status fails **open**; lock-file writes are unlocked and non-atomic; first use is trusted silently |
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
  `<!-- machine:application-status:begin --> … <!-- machine:application-status:end -->`
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

**Phase 2 status (2026-11-12): 2.1–2.6 done.** Follow-ups found while doing it (not yet fixed):
- *Run stream, pre-existing:* `/api/run` emits an `error` event for **any** stderr line matching words such as `error|auth|login`. The client stops at the first one and shows an error while the CLI keeps running and may finish successfully. Fix this with Phase 4: distinguish warnings from fatal errors on the server, so the client can keep reading until the real terminal event. The client deliberately does **not** cancel the stream on that event: cancelling would SIGTERM a CLI that may be writing a report or the tracker.
- *Assistant confirm card:* it still shows "✓ started" as soon as the user confirms a status change; a refusal arrives afterwards as a note. A real fix needs `writeStatus` in `web/src/app/actions/registry.ts` to become async and return the result (the `DoneInfo` contract).
- *Explore:* `setMode()` clears `runningRef` mid-stream without cancelling the stream, and a stale stream can still make direct `setPhase` calls after `reset()` (only the delayed transition is guarded). Fold this into the M10 reducer work in Phase 4.

### Phase 3 — The registry and the gate

| # | Task | Model |
|---|---|---|
| 3.1 | `lib/state-machine.mjs` + schema validation + `machines.mjs` CLI; `tracker-utils` exports become wrappers | Sonnet |
| 3.2 | Fix `set-status` by canonicalizing `from` through `check()`; the 0.3 repro test turns green; the matrix test from 1.3 is updated for exactly this one change | Sonnet |
| 3.3 | Move root scripts to `canonicalize()`, one script per commit, golden tests green after each: `verify-pipeline`, `stats`, `analyze-patterns`, `followup-cadence`, `dedup-tracker`, `normalize-statuses`, `merge-tracker` | Sonnet (Haiku may do the simpler swaps such as `stats` and `analyze-patterns` once the pattern exists) |
| 3.4 | Route `reply-watch` and `normalize-statuses` writes through `applyStatusChange()`, **warn mode** | Sonnet |
| 3.5 | Unify sentinel GC into one locked implementation that is PID- and batch-aware (never reclaim a sentinel whose batch row is `processing`); the M5 repro turns green | Sonnet |
| 3.6 | `pipeline.md`: one locked writer; tolerant reader for both `[x]` encodings; actually write `[!]` for errors | Sonnet |
| 3.7 | Plugin `lockGate`: an unknown status **fails closed** with a clear message; atomic, locked lock-file writes (security; treat as a must-fix once 0.2 confirms it) | Sonnet |

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

## 6. Decisions the owner must make (the plan will not guess)

| # | Question | Options | Recommendation and why |
|---|---|---|---|
| **D1** | Should backward moves between live states (e.g. Interview → Applied) stay free? | (a) Free, logged as a correction (today) · (b) Allowed only with `--correction`, refused otherwise | **(a) for the CLI, plus a confirm in the UIs.** Fixing a mistaken status is common, and blocking it pushes people to hand-edit the table, which is worse for data integrity. The UI confirm is enough of a speed bump |
| **D2** | `monitor` means `skip` (YAML) or `evaluated` (Go)? Should `condicional`, `hold`, `evaluar`, `verificar`, `geo blocker` become official aliases, and of which state? | per alias | The corpus from 0.4 will show how often each appears in real trackers. Choose **only after seeing it**. Until then each call site keeps today's behaviour |
| **D3** | How should the Go TUI write statuses? | (a) Shell out to `set-status.mjs` · (b) Port the gate and log append to Go | **(a):** one gate, one log format, identical error text, no drift. The cost is a ~50 ms process start per write, which is unnoticeable in a TUI |
| **D4** | What happens to an unknown status string on write? | reject · flag and keep · map to Evaluated with a note | **reject on interactive writes, flag-and-keep on bulk tools (merge, normalize).** Never silently map: silent mapping is how real statuses get lost |
| **D5** | Should the TUI get `Offer` and `Hired` tabs? | yes · no | **Yes**, for parity with the web app; it's cheap |
| **D6** | One interview-round vocabulary? | the debrief/practice set · the interview-prep set · a merged set | **Merged set with aliases** (e.g. `recruiter-screen` ≈ `screen`), so existing prep files remain valid |
| **D7** | Should old warn-mode guards become enforcing (Phase 5.3)? | after one release · never · per guard | **Per guard, after reviewing the warning log** |

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
