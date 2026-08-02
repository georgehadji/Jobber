# Jobber Improvement Plan

> **Companion to [HARDENING-PLAN.md](HARDENING-PLAN.md).** That plan covers structural
> hardening (types, provider contract tests, dead code, style floor, dependency
> integrity); Phases 0–4 have landed. This plan covers what it did not touch: the
> *doctrine*, the *scoring loop*, and the *internal shape of the modules*.
>
> Baseline: v1.24.0 · 109 root scripts · 67 providers · 42 root modes ·
> `test-all.mjs` at 12,465 lines · typecheck floor at 88 files.

**v2 — after a YAGNI pass.** Roughly half of v1 was cut. Two v1 claims were wrong and
are corrected below (§ Corrections). What survives is what pays for its own diff.

---

## Guiding constraints (inherited — non-negotiable)

| Constraint | Source | Consequence |
|------------|--------|-------------|
| Files canonical, DBs derived | `ARCHITECTURE.md` (#918) | No new canonical store. New artifacts are human-readable files or deletable indexes. |
| Flat root, path stability | `ARCHITECTURE.md` (#1386) | No script moves. Extract into `lib/`; entrypoint keeps its path. |
| System / user layer split | `DATA_CONTRACT.md` | New file → classified in the same PR. |
| Human-in-the-loop | `MANIFESTO.md` #4 | Automation stops at *prepared*, never *sent*. |
| AI-agnostic | `ARCHITECTURE.md` | No model names outside the `_shared.md` routing table. |
| Local-first | `MANIFESTO.md` #5 | No telemetry, no shared corpus. |
| Bounded agents | `_shared.md` | No recursive fan-out. |

---

## Corrections to v1

**1. The CV builders are already correctly factored.** v1 proposed a `lib/cv-model.mjs`
Model/View split on the claim that `build-cv-html.mjs` and `build-cv-latex.mjs` parse
`cv.md` independently. They do not — both import `cv-sections-core.mjs`
(`stripEmptySections`) and `cv-templates.mjs` (`resolveTemplate`). Shared model, separate
renderers: that *is* the pattern, already built. **The refactor is cancelled.** Only the
missing plaintext/ATS renderer survives, and it needs no refactor.

**2. Locks: four copies, not six.** `update-system.mjs` has no lock at all;
`reserve-report-num.mjs` reuses the tracker lock (`JOBBER_TRACKER_LOCK_STALE_MS`). The
real finding is sharper than v1's: `lockCanRecover(lockDir, staleMs)` is
**copy-pasted near-verbatim** into four files —
`pipeline-lock.mjs:95`, `portal-health-lock.mjs:90`, `tracker-utils.mjs:242`,
`followup-seed.mjs:295` — same ownerless-grace comment, same `mkdirSync` +
`owner.json` + recover-guard-dir sequence, four different stale defaults
(30s / 30s / 10min / 10min). Four copies of the trickiest concurrency code in the repo.

---

## The core finding

The project is disciplined at the **boundaries** — data contract, `SYSTEM_PATHS`
allowlist, atomic writes, legitimacy tiers, the anti-fabrication rule. That work is done.

Three gaps remain:

1. **The rubric is unfalsifiable.** Six dimensions collapse to one number; only the number
   is persisted. Outcomes are recorded (`status-log.tsv`, `outcome.mjs`) and scores are
   recorded — **nothing joins them**. Nobody can answer "does 4.5 convert better than 3.8?"

2. **Signals collected, never actuated.** `portal-health.tsv` records consecutive failures;
   `scan.mjs` reads it only to print warnings, then hits the dead portal again next run.
   `states.yml` has nine states and zero legal transitions, so `Rejected → Interview`
   validates.

3. **The riskiest code is duplicated.** Four copy-pasted lock implementations; a
   12,465-line test monolith; `lib/` and `utils/` with no stated split.

---

## Paradigm

**Functional core / imperative shell.** Pure domain logic in `lib/`, all I/O and process
control at the root-script edge. It fits ~109 standalone ESM scripts better than any class
hierarchy, and it is already the style of the best modules here — `liveness-core.mjs`,
`fingerprint-core.mjs`, `tracker-parse.mjs`, `cv-sections-core.mjs`.

**The corollary, and it is the important half: most modules need no design pattern.** A
pattern earns its place by removing duplication that exists or preventing a bug that has
happened. Applied speculatively it is just indirection with a name. Part III names a
pattern only where one is earned, and says *none* where none is — which is most of them.

---

# Part I — Philosophy

Two additions. v1 proposed five; three of them governed nothing the code was going to do,
so they were documentation wearing a manifesto's clothes.

### P1 — Calibration over confidence *(practice principle)*

> **7. Calibration over confidence.** A score never checked against what happened is a
> horoscope. We record what we predicted, we record what occurred, and we let the second
> correct the first.

Authorises M1 and M3. Without it, persisting sub-scores is bookkeeping; with it, refusing
to persist them is a violation.

### P2 — The right to an ending *(right #10)*

> **10. You have the right to an ending.** A process that goes silent is over. Your tools
> should say so, and archive it, rather than let it haunt a list forever.

Authorises M5. The tracker currently grows without bound and dead rows silently distort
every funnel denominator.

**Cut from v1:** "every fact carries a date" (already enforced where it matters by
`check-table-freshness.mjs` — a convention that works needs no manifesto line);
"sustainable cadence" (belongs in `config/profile.yml` docs, not doctrine); "cheapest model
that holds the task" (already implemented as `spend_tier`; restating it changes nothing);
"right to know how you were scored" (M1 delivers this in practice; the existing right #9
already covers the principle).

**Delivery:** one PR editing `MANIFESTO.md`. **Proposed, not merged unilaterally** — the
manifesto belongs to the practice, not the repo (`MANIFESTO.md` § The name). File it after
the code makes it true, not before.

---

# Part II — Methodology

## M1 — Persist the reasoning, not just the verdict

**Now:** reports carry a global 1–5 score and a `## Machine Summary` YAML block. The six
dimensions are reasoned about in prose and discarded as data.

**Change:** extend the Machine Summary contract.

```yaml
score: 4.2
dimensions:
  cv_match:   { score: 4.5, evidence: ["cv.md:L41", "cv.md:L58"] }
  north_star: { score: 4.0, archetype: "AI Platform / LLMOps" }
  comp:       { score: 3.5, as_of: "2026-08-02", reliability: "Medium" }
  cultural:   { score: 3.0, capped: false }
  red_flags:  { score: 4.0, items: ["equity-heavy", "posting-age-47d"] }
confidence: medium
```

`evidence` anchors make the anti-fabrication rule **auditable** rather than asserted — a
claim with no anchor is a claim to challenge. `confidence` separates "this is a 3.5" from
"I have no idea, call it 3.5", which today score identically.

**Paradigm:** data, not code. It is a schema change to a file format.
**Pattern:** *Decision Record* — the report is already immutable and dated; this makes it
machine-readable.
**Work:** emit in `modes/oferta.md`; read via a parser in `lib/report-schema.mjs`; verify
in `validate-report.mjs`. Backward compatible — old reports lack `dimensions` and are
skipped with a counted, reported skip.
**Cost:** cheap now, and it is the only prerequisite for M3. Do it early even though the
payoff is months out.

## M2 — One output contract for the evaluators

**Now:** `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs` and the interactive
`modes/oferta.md` path all claim to produce the same report, held together by a
`---SCORE_SUMMARY---` string convention.

**Change:** two plain functions in `lib/score-summary.mjs` — `parse(text)` and
`serialize(obj)` — imported by all three scripts. Plus one contract test running each
evaluator against a frozen synthetic JD and asserting shape, not values.

**Pattern: none.** v1 proposed a Template Method skeleton (`lib/evaluator-core.mjs`) with
transport hooks. Three implementations do not justify inversion of control. Two exported
functions remove the actual duplication — the wire format — and leave each evaluator
readable top to bottom.

## M3 — Close the loop: calibration *(deferred, but designed)*

**Change:** a section in `analyze-patterns.mjs` (not a new script — it already loads the
data) joining predicted score to realised outcome:

- calibration curve: predicted band → realised advance rate
- per-dimension outcome correlation — which of the six carries signal
- confidence reliability — was "high confidence" right more often?

**Paradigm:** pure fold over append-only logs. Reports + `status-log.tsv` +
`data/outcomes/` are all append-only and dated; calibration is a pure function over them,
recomputable from scratch, storing nothing.

**The honest constraint, and it must be printed in the output:** a personal search yields
n≈100 applications and maybe 10 interviews. That is not enough for significance. Below a
floor (n=20 per band) the section prints counts and refuses to draw a curve. Overselling
this is the main failure mode of the idea.

**Blocked on M1 accumulating months of data.** Build it last, not first.

## M4 — Make the golden set load-bearing

`evals/` has 10 synthetic cases and a deterministic `$0` `--replay` path. CI wiring is
"deferred until the gate threshold is confirmed" — but a replay gate pinned at the
*currently measured* agreement cannot go red spuriously. Wire it now.

Then add **one** case, the highest-value one: a JD engineered to bait fabrication (names a
tool the CV lacks, in a context inviting tool-of-trade conflation). That is a regression
test for the project's central ethical claim, and once M1's `evidence` anchors exist it is
checkable mechanically: *no claim in the output lacks an anchor in the input*.

**Cut from v1:** growing to 25 cases, and self-consistency variance measurement. Both are
real but neither blocks anything; add when a routing decision actually turns on them.

**Pattern:** *Golden master*. Already the pattern; just make it binding.

## M5 — Sunset: the right to an ending

**Now:** a role applied to in February with no reply is still `Applied` in August,
inflating every funnel denominator.

**Change:** `sunset.mjs`, dry-run by default.

```
node sunset.mjs            # proposes, JSON or --summary
node sunset.mjs --apply    # writes via set-status.mjs, one row at a time
```

**Paradigm:** functional core — `lib/sunset-policy.mjs` exports
`isStale(row, ledger, cfg) → {stale, reason}`, pure, no I/O, one unit test. The script is
the shell.
**Pattern: none.** It is a predicate and a loop.
**Threshold:** one number in `config/profile.yml` (`sunset_after_days`, default 45). v1
proposed a whole `cadence:` block; ship the one key that M5 needs and add the rest when
something asks for it.

## Cut entirely

- **M6 cadence model** (weekly budget, active-process ceiling, quiet days) — speculative.
  Nothing in the system currently overwhelms the user in a way anyone has reported. One
  key (`sunset_after_days`) covers the concrete case.
- **M7 leverage mode** (BATNA sequencing) — new surface area, hardest ethical boundary,
  zero demand. If it is ever built, the boundary is the design work: it is a calendar and
  a dependency graph, never negotiation coaching.

---

# Part III — Architecture

Module by module: the problem, the paradigm, and the pattern **only where one is earned**.

## A1 — `test-all.mjs` (12,465 lines) → section registry

**Problem:** every contributor touches it; nobody reads it; concurrent PRs conflict; it
cannot run partially without hand-editing.

**Constraint:** `node test-all.mjs` must keep working at that path (doctrine).

**Pattern: *Registry*, earned — and already the house idiom.** `providers/_registry.mjs`
establishes it for 67 providers. Reuse it rather than inventing a second convention.

```
tests/sections/
  _registry.mjs        # discovers, orders
  01-scoring.mjs       # export default { id, title, run(ctx) }
  02-scan.mjs
  ...
test-all.mjs           # ~150-line orchestrator: load, run, aggregate, exit
```

**Wins:** `--section tracker` gives a 3-second inner loop; per-section timing;
conflict-free concurrent PRs.
**Migration:** one section per PR, assertion count before/after as proof of equivalence.
A single 12k-line PR is unreviewable — do not attempt it.

## A2 — Four copies of the lock → one `lib/file-lock.mjs`

**Problem (verified):** `lockCanRecover(lockDir, staleMs)` copy-pasted near-verbatim into
`pipeline-lock.mjs`, `portal-health-lock.mjs`, `tracker-utils.mjs`, `followup-seed.mjs`,
with four stale defaults and four sets of comments explaining the same ownerless-grace
subtlety. Concurrency is the one place duplication is not untidiness but a correctness
liability: a fix in one never reaches the other three.

**Paradigm:** pure function + scoped wrapper. `withLock(path, opts, fn)` — acquire,
run, release in `finally`.
**Pattern: none needed.** A closure is the whole pattern.
**Lazy migration:** extract the most-hardened copy (`tracker-utils.mjs` — longest stale
window, most tests). New code uses it. Migrate the other three opportunistically, keeping
`pipeline-lock.mjs` and `portal-health-lock.mjs` as thin facades at their existing paths.
Do **not** big-bang all four.

## A3 — `portal-health.tsv` → actually skip dead portals

**Problem (verified):** `scan.mjs` reads portal health only to emit warnings. Consecutive
failures and `slug_gone` are recorded, then the same dead portal is hit again every run.

**Change:** skip if consecutive failures exceed a threshold, retry after an exponential
window capped at a few days. ~15 lines inline in `scan.mjs`, next to where health is
already read. The run summary reports how many portals were skipped and when they reopen.

**Pattern: none.** v1 proposed a three-state Circuit Breaker module. Half-open probing is
the part of that pattern that earns its complexity under high traffic; a scan that runs a
few times a day does not have that problem. `consecutive > N → skip until T` is the whole
requirement.

```js
// ponytail: linear skip-until, no half-open probe. Add probing if a portal
// recovers and stays dark for a full backoff window.
```

**Companion, separate and worth it:** a shared per-host rate limit in
`providers/_http.mjs`. 67 providers currently share no limiter. Politeness against free
public ATS endpoints is the precondition for those endpoints staying open to this project
— that is not an optimisation, it is the terms of use.

## A4 — Tracker: transitions and a complete ledger

Two changes. The third (v1's Repository) is cut.

**(a) States without transitions.** `templates/states.yml` defines nine states, no legal
edges; `Rejected → Interview` and `Hired → Evaluated` both validate.

→ Add `transitions:` to `states.yml`, enforce in `set-status.mjs`, `--force` to override
(the flag already exists for report-link mismatches). ~30 lines. Highest payoff-per-line
in this document: it makes `status-log.tsv` a trustworthy event log, which is the
substrate for `funnel-velocity.mjs` and M3.

**Pattern: *State Machine*, earned — and data-driven.** The transition table lives in
`states.yml` beside the states, not in code. `set-status.mjs` reads it. The dashboard
(already a `states.yml` reader) gets it for free.

**(b) Ledger gaps.** Only `set-status.mjs` appends to `status-log.tsv`. Rows created by
`merge-tracker.mjs` and transitions applied by `outcome.mjs` and `reply-watch.mjs` leave
holes — `funnel-velocity.mjs` already falls back to parsing tracker notes
(`dateSource: 'tracker-notes'`).

→ Move the append into `tracker-utils.mjs` beside the write it accompanies, and call it
from every writer. ~20 lines.

**Cut: `lib/tracker-repo.mjs` (Repository pattern).** `tracker-parse.mjs` +
`tracker-utils.mjs` **are** the shared surface already. Wrapping them in a repository
object renames working code and changes nothing. The real gap was (b), and (b) is 20 lines.

## A5 — CV builders: already correct

**Cancelled** — see § Corrections. `build-cv-html.mjs` and `build-cv-latex.mjs` share
`cv-sections-core.mjs` and `cv-templates.mjs`; shared model, separate renderers is already
the shape. **Paradigm already right; leave it alone.**

The one real gap: **no plaintext renderer**, which is the genuinely ATS-safe format. ~60
lines against the existing `stripEmptySections` output. Additive, no refactor.

## A6 — Config: check the shape, not just existence

**Problem:** `validate-portals.mjs`, `validate-plugin-registry.mjs`,
`validate-system-paths-coverage.mjs`, `validate-typecheck-coverage.mjs` all exist. There is
**no profile validator.** `doctor.mjs` checks that `config/profile.yml` *exists*; nothing
checks that `spend_tier` is one of three values, that `language.modes_dir` points at a real
directory, or that `culture_screen.require` has the shape the scoring rules read. A typo
degrades every evaluation silently — the worst failure mode in the system.

**Change:** ~40 lines of explicit checks inside `doctor.mjs`, where the file is already
loaded and the user is already being told what is wrong.

**Pattern: none.** v1 proposed `config/profile.schema.yml` plus a ~120-line
`lib/schema.mjs` validator. A schema language for **one** config file is a second thing to
maintain and a second thing to get wrong. Explicit `if` statements with good messages are
shorter, and the message can name the key and the expected value.

## A7 — `lib/` vs `utils/`: pick one, write the rule

`lib/` holds four modules; `utils/` holds exactly `token-tracker.mjs`. No documented
distinction, so every contributor guesses.

**Change:** move `token-tracker.mjs` to `lib/`, leave a re-export shim at the old path for
one minor version, and put the rule in `CONTRIBUTING.md`:

> `lib/` holds pure importable modules: no side effects at import time, no `process.exit`.
> Root `.mjs` files are entrypoints — argument parsing, I/O, exit codes. No `main()` → it
> belongs in `lib/`.

This is the sentence that makes functional-core/imperative-shell enforceable instead of
aspirational, and it is mechanically checkable: one test asserting no `lib/**` module calls
`process.exit` or performs I/O at import.

## A8 — Translation drift

17 translated READMEs, 6 market mode sets, no staleness signal.

**Change:** store the source SHA at translation time, compare with
`git log -1 --format=%H README.md`, warn in CI. ~20 lines.
**Pattern: none.** Git already stores the history; the script just reads it. v1 proposed a
`check-translation-freshness.mjs` modeled on `check-table-freshness.mjs` — same idea,
without inventing a header convention or a new discovery mechanism.

## Cut from v1's architecture section

| Cut | Why |
|-----|-----|
| `lib/result.mjs` (Result/Either) | Node has exceptions. An Either type across 109 ESM scripts is ceremony, not safety. |
| `lib/log.mjs` | `console.log` plus a `--json` flag already works in every script. Nothing is broken. |
| `lib/http-cache.mjs` (ETag/content-hash) | No profiler says scan is slow. Add when one does. |
| `update-system.mjs` → migration list | The updater works: backup, re-exec with import-closure resolution, `SYSTEM_PATHS`-only checkout, rollback. Zero reported pain. Restructuring working, careful, well-tested update machinery is how you break upgrades. |
| `types/domain.d.ts` + `@ts-check` ratchet | The `.typecheck-floor` ratchet already exists and works. Let it keep ratcheting. New `lib/` modules land `@ts-check`-clean; that is enough. |
| Plugin capability manifest | `plugins.lock` already pins integrity and records consent, and `AGENTS.md` treats plugin skills as untrusted. Enforcement is the right next step *when a plugin ecosystem exists to need it*. |
| `lib/atomic-write.mjs` | Real duplication but small and correct in each copy. Fold it into A2's extraction if convenient; not worth its own PR. |

---

# Part IV — Sequencing

| # | Work | Size | Why here |
|---|------|------|----------|
| 1 | A4(a) `states.yml` transitions | ~30 lines | Best payoff-per-line; conflicts with nothing |
| 2 | A4(b) ledger append in `tracker-utils.mjs` | ~20 lines | Completes the event log |
| 3 | A6 profile validation in `doctor.mjs` | ~40 lines | Kills a silent-failure class |
| 4 | A3 skip dead portals + `_http.mjs` rate limit | ~15 + ~30 lines | Visible speed win; politeness |
| 5 | A8 translation SHA check | ~20 lines | Independent |
| 6 | A7 `lib/` rule + `token-tracker.mjs` move | small | Sets the convention before more `lib/` code lands |
| 7 | A2 `lib/file-lock.mjs` extraction | 1 PR + opportunistic | New code uses it immediately |
| 8 | M1 report `dimensions` + `validate-report.mjs` | 2 PRs | Cheap now; only prerequisite for M3 |
| 9 | M2 `lib/score-summary.mjs` | 1 PR | Catches evaluator drift |
| 10 | M4 golden set into CI + fabrication-bait case | 1 PR | Makes cheap-model routing defensible |
| 11 | A1 `test-all.mjs` → sections | ~8–12 PRs | Mechanical; start once 1–6 have landed |
| 12 | A5 plaintext CV renderer | ~60 lines | Additive |
| 13 | M5 `sunset.mjs` | 1 PR | New surface, low risk |
| 14 | M3 calibration | 1 PR | Blocked on months of M1 data |
| 15 | P1/P2 manifesto proposal | 1 proposal | After the code makes it true |

**Reordered from v1**, which put the kernel and the `test-all.mjs` split first on the
theory that they unblock everything. They mostly do not — items 1–6 are independent
~30-line changes that fix real bugs today. Ship those first; the monolith split is a
comfort improvement and can wait for a quiet week.

---

## What this plan deliberately does not do

- **Move any root script.** Path stability is doctrine (#1386).
- **Add a second canonical store.** `status-log.tsv` is an append-only ledger,
  `applications.db` stays a deletable index, calibration stores nothing.
- **Add runtime dependencies.** The 4-dependency footprint holds.
- **Touch the user layer.** New artifacts get classified in `DATA_CONTRACT.md` in the PR
  that creates them.
- **Add auto-submission or any path that contacts an employer.** Manifesto #4 is a
  boundary, not a default to relax.
- **Add telemetry.** Calibration is per-user, on disk. Aggregating across users would be a
  better product and a broken promise.
- **Rewrite the modes.** They are the accumulated judgment of a real search that worked.
  They get a stricter output contract (M1/M2), not new opinions.
- **Refactor working, well-tested machinery for elegance.** The updater and the CV builders
  are correct. Elegance is not a bug report.

---

## Appendix — paradigm and pattern by module

*"None" is the correct answer for most rows. A pattern is earned by removing duplication
that exists or preventing a bug that happened.*

| Module | Paradigm | Pattern | Earned by |
|--------|----------|---------|-----------|
| `lib/*` | Functional core | none — pure functions | — |
| `test-all.mjs` | Composition | **Registry** | 12,465 lines; already the house idiom (`providers/_registry.mjs`) |
| `providers/*` | Strategy | **Registry + Adapter** (existing) | 67 implementations of one interface |
| `set-status.mjs` + `states.yml` | Declarative | **State Machine** (data-driven) | Illegal transitions validate today |
| `lib/file-lock.mjs` | Scoped resource | none — a closure | Removes 4 copy-pasted implementations |
| `scan.mjs` | Imperative shell | none | Skip-until is a comparison, not a Circuit Breaker |
| `tracker-*.mjs` | Shell over pure core | none — already factored | Repository would rename working code |
| `*-eval.mjs` | Shared functions | none | 3 impls do not justify Template Method |
| `build-cv-*.mjs` | Model / view | already correct | shares `cv-sections-core.mjs` |
| `doctor.mjs` | Imperative | none — explicit checks | Schema DSL for one file is overhead |
| `update-system.mjs` | Command + Memento | already correct | Works; leave it |
| `modes/*.md` | Declarative | output contract via `validate-report.mjs` | 4 evaluators must agree on shape |

---

*v2, 2026-08-02, against v1.24.0. Claims marked verified were checked against the code.
Companion to `docs/HARDENING-PLAN.md`.*
