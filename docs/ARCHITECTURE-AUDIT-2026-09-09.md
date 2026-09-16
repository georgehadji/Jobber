# Architecture Audit — Jobber

**Date:** 2026-09-09 · **Commit:** 85696f7 (`docs/website-plan`) · **Protocol:** ARCH-AUDIT-V2 / EGFV

Every non-trivial claim carries `[VERIFIED]` (read in this checkout, file:line cited), `[HYPOTHESIS]` (inferred from structure), `[UNKNOWN]` (insufficient evidence), or `[FALSE]` (contradicted by evidence).

---

## Step 0 — Input Gate

| Input | Status |
|---|---|
| Full codebase | ✅ present |
| Primary entry points | ✅ identified (Phase 1 §2) |
| ADRs | ⚠️ none as ADRs; `docs/HOSTED-APP-PLAN.md` and `docs/ARCHITECTURE.md` serve the role informally |
| README / design docs | ✅ `AGENTS.md`, `DATA_CONTRACT.md`, `docs/*` |
| Dependency manifests | ✅ root `package.json`, `web/package.json`, `scaffolder/package.json` |
| Deployment manifests | ⚠️ partial — root `Dockerfile` + `docker-compose.yml` cover the **CLI only**; nothing deploys `web/` |
| CI/CD configs | ✅ `.github/workflows/` incl. `web-ci.yml` (marked non-required) |

Gap markers applied below: `[UNKNOWN — no deployment manifest for web/]` on every hosted-tier topology finding.

---

## Phase 1 — Architectural Fingerprinting

### DETECTED ARCHITECTURE: **script-per-stage CLI monolith with a shared-library floor, plus a subprocess-coupled web tier**

Not layered, not hexagonal, not microservices. The organising principle is *one executable script per pipeline stage*, sharing a thin utility floor, with all state in flat files.

Supporting evidence:

1. **124 root-level `.mjs` files, 103 with `#!/usr/bin/env node`** [VERIFIED] — the unit of architecture is the executable script (`scan.mjs`, `merge-tracker.mjs`, `set-status.mjs`, `generate-pdf.mjs`), not a module or a service.
2. **`lib/` is a genuine utility floor with a documented one-way rule** [VERIFIED] — `lib/file-lock.mjs:33-35` states it explicitly: *"Entrypoints (root \*.mjs) call acquireLock/withLock at the shell edge."*
3. **`providers/` (77 files) is the one place with a mechanically enforced interface** [VERIFIED] — contract at `providers/_types.js:145-158`, enforced at load time by `providers/_registry.mjs:40` (`typeof p.fetch !== 'function' || !p.id`).
4. **`modes/` contains zero `.mjs`** [VERIFIED] — it is prompt/instruction data read by the host AI CLI, not code. The "business logic" of evaluation lives in Markdown, executed by an LLM, not by this codebase.
5. **`web/` is a separate Next.js deployable** [VERIFIED] — own `package.json` (`@jobber/web`, next@16.2.12), own `node_modules/`, own `tsconfig.json`.
6. **Zero queue, broker, or job system** [VERIFIED] — grep for redis/rabbitmq/kafka/bullmq/amqp returns only incidental variable names. All coordination is filesystem locks (`lib/file-lock.mjs`) over flat files.

**Data flow topology:** synchronous, single-process, file-based read-modify-write per invocation [VERIFIED]. Concurrency is handled by `mkdir`-based advisory locks with PID-liveness staleness detection and owner tokens (`lib/file-lock.mjs:18-30`) — three consumers: `pipeline-lock.mjs` (30s stale window), `portal-health-lock.mjs` (30s), `tracker-utils.mjs:174-246` (600s, because tracker rewrites are slower — `tracker-utils.mjs:187`).

**Config/secrets:** LLM keys centralised in one table (`lib/llm-providers.mjs:47-95`, read via `apiKeyFor()` at `:254-257`) [VERIFIED]. Profile config is **not** centralised — the path constant is re-derived per consumer (`scan.mjs:66`, `providers/_profile-keywords.mjs:25`), with ~55 files referencing `profile.yml` and no shared loader [VERIFIED].

---

## Phase 2 — Compliance Matrix

| Module | Detected Pattern | Intended Pattern | Drift | Violations | Severity | Evidence |
|---|---|---|---|---|---|---|
| `web/src/app/api/run/route.ts` (PDF path) | Blocking sync subprocess inside async request handler | Async, non-blocking per-request | **Total** | 3× `execFileSync` (300s+300s+60s timeouts) inside `ReadableStream.start()` on the shared event loop | **CRITICAL** | `route.ts:43,56,65`; correct async pattern already used at `:256-261` for the evaluate path [VERIFIED] |
| `web/src/lib/jobber.ts` + `provision-workspace.mjs` | Tenancy primitive built, tested, never wired | Per-tenant workspace per request | **Total** | `withWorkspaceRoot()` has zero callers; `provisionWorkspace()` referenced only by itself and its test | **CRITICAL** | `jobber.ts:16` (def), only 2 other matches are its own comments; `provisionWorkspace` grep → `provision-workspace.mjs` + `tests/provision-workspace.test.mjs` only [VERIFIED] |
| LLM call layer (5 scripts) | Ad-hoc per-script call + fallback | Single provider abstraction | High | No shared call signature; fallback reimplemented 3 different ways, absent in 2 more | **HIGH** | `openrouter-runner.mjs:198-346`, `agent-runner.mjs:182-264`, `openai-eval.mjs:344-390`, `gemini-eval.mjs:317-336`, `ollama-eval.mjs:267-310` [VERIFIED] |
| `web/src/lib/core/run-registry.ts` | Module-level in-memory mutex | Multi-instance-safe coordination | High | `let seq`/`Set<number>` at module scope; correctness assumes exactly one process | **HIGH** | `run-registry.ts:12-14`, self-documented at `:2-3` [VERIFIED] |
| `lib/hosted-capabilities.mjs` | lib importing a root entrypoint | lib is imported *by* roots, never imports them | Localised | `import { USER_PATHS } from '../update-system.mjs'` | **MEDIUM** | `lib/hosted-capabilities.mjs:17` vs rule at `lib/file-lock.mjs:33-35`; exactly one such edge repo-wide [VERIFIED] |
| `test-all.mjs` | God module | Test orchestrator | High | 4,277 lines in one file | **MEDIUM** | `wc -l` [VERIFIED] |
| `scan.mjs` | God module | Portal scanner | High | 2,639 lines; also imported as a library by 4 other roots | **MEDIUM** | `wc -l`; importers `scan-interamt.mjs:23`, `scan-ats-full.mjs:46`, `plugins.mjs:31`, `test-salary-filter.mjs:13` [VERIFIED] |
| Profile config loading | Copy-pasted path constant | Single loader | Moderate | ~55 files reference `profile.yml`; no `readProfile()` helper exists | **MEDIUM** | `scan.mjs:66`, `providers/_profile-keywords.mjs:25` [VERIFIED] |
| `docs/HOSTED-APP-PLAN.md:191` vs `openai-eval.mjs` | Documented behaviour absent from code | Doc matches code | — | Plan describes "one application-level retry if `---SCORE_SUMMARY---` cannot be parsed"; no retry loop exists in the file | **MEDIUM** | `openai-eval.mjs` has `SCORE_SUMMARY` only at `:294` (prompt) and `:436` (stripping); single `fetch`, `process.exit(1)` on failure at `:370` [VERIFIED] |
| `providers/*` (job boards) | Registry + enforced interface | Same | **None** | — | ✅ compliant | `providers/_registry.mjs:40` [VERIFIED] |
| `web/` → root boundary | Subprocess shim, zero imports | CLI-shim convention | **None** | — | ✅ compliant | Two greps for `../` escapes from `web/src` → zero matches; 15 files use spawn/execFile instead [VERIFIED] |
| Lock layer | One shared primitive, 3 consumers | Same | **None** | — | ✅ compliant | `lib/file-lock.mjs` [VERIFIED] |

---

## Phase 3 — Dependency and Coupling Analysis

**Circular dependencies:** none found [VERIFIED] among the 20 most-central modules. `tracker-parse.mjs`, `role-matcher.mjs`, `verify-cv-facts.mjs`, `eval-runner.mjs` are all leaves (stdlib-only imports); `merge-tracker.mjs`/`outcome.mjs` import `find.mjs`, which imports neither back. `[UNKNOWN]` for the 77 `providers/*.mjs` — sampled, not exhaustively traced.

**Layer leaks:**
- `lib/hosted-capabilities.mjs:17` → `../update-system.mjs` [VERIFIED]. One-directional (no reverse edge), so not a cycle — but it inverts the stated layering, and `USER_PATHS` is a plain root-level `const` (`update-system.mjs:402`), not an exported contract. Fix: move `SYSTEM_PATHS`/`USER_PATHS` into `lib/`.
- Root scripts importing each other directly is **pervasive and unenforced** [VERIFIED]: `scan-interamt.mjs:23`, `scan-ats-full.mjs:46`, `plugins.mjs:31` → `scan.mjs`; `merge-tracker.mjs:23`, `outcome.mjs:28` → `find.mjs`; `provision-workspace.mjs:44` → `update-system.mjs`; `salary-import.mjs:59` → `salary-gap.mjs`; `doctor.mjs:14` → `browser-extract.mjs`. There is no "roots must go through lib/" rule, only the lib-side one — so this is design-as-built, not drift [HYPOTHESIS: intentional, given the volume and consistency].

**Shared mutable state risks:**
1. `web/src/lib/core/run-registry.ts:12-14` — module-scope `Set`, global (not tenant-scoped), single-process-only by its own admission [VERIFIED].
2. `openrouter-runner.mjs:75-76` — `let freeModels = null; let modelIndex = 0;` module-scope, mutated by `callOpenRouter()` [VERIFIED]. Safe today only because the file is CLI-invoked (guarded at `:792-794`); one `import` away from a concurrency bug.
3. **The whole filesystem, in hosted mode** — because `jobberRoot()` is unscoped (Phase 2), every concurrent hosted request reads/writes the same `cv.md`, `reports/`, `data/applications.md` [VERIFIED].

**Coupling hotspots (high afferent):** `tracker-parse.mjs` — 17+ importers [VERIFIED]. Acceptable: it is a stdlib-only leaf, so afferent coupling here is fan-in on a stable parser, not a hub with its own dependencies.

**Boundary violations, cross-domain direct access:** none between `web/` and root [VERIFIED — the shim holds]. The real boundary problem is the opposite: the boundary is enforced *mechanically* but not *semantically* — `web/` reaches root state by spawning scripts that mutate shared files, so process isolation buys nothing while `jobberRoot()` is shared [VERIFIED].

---

## Phase 4 — AI Orchestrator Review

**Naming collision, flagged first:** `providers/*.mjs` (77 files) are job-board scrapers with zero LLM involvement; the LLM providers live in `lib/llm-providers.mjs` [VERIFIED]. Two subsystems, one word. This costs real comprehension time and belongs in the roadmap.

**Orchestration model.** Facts centralised, control flow not [VERIFIED]. `lib/llm-providers.mjs` is a genuine single source of truth for model IDs, key env vars, base URLs, context windows, pricing (`:47-95`), and every consumer imports from it rather than hardcoding. But the HTTP call + fallback loop is reimplemented per script — five call sites, five shapes.

**Routing vs business logic: tangled** [VERIFIED]. `openai-eval.mjs:344-390` builds the request, calls, parses, then writes the report, writes a tracker TSV row, and shells out to `merge-tracker.mjs` (`:411-481`) in one linear script scope. `gemini-eval.mjs` interleaves SDK call (`:318`), domain validation (`validateEvaluationShape`, `:177-216`), and persistence (`:364-440`). Partial mitigation: `eval-runner.mjs:33-142` factors out the pure helpers three evaluators share, and states at `:12-18` that provider call paths stay per-script *deliberately*.

**Provider abstraction: none for LLMs** [VERIFIED]. Three entry points, three signatures: `callOpenRouter(systemPrompt, userMessage) → {content, usage}` (`openrouter-runner.mjs:198,244`); no function at all in `gemini-eval.mjs` (SDK object constructed inline at `:307-318`); `runAgentLoop(opts) → void`, streaming via an injected `emit()` callback (`agent-runner.mjs:182-272`). `openai-tailor.mjs:262-277` and `openai-eval.mjs:344-359` inline `fetch` in top-level script scope. `PROVIDERS` is a data table with per-provider optional fields (`free`, `pricingOnly`, `dataPolicyEnv`), not an interface.

**Async and concurrency.** LLM calls are deliberately serialized, never concurrent — `openrouter-runner.mjs:699-723` loops with `await` plus an explicit `RATE_LIMIT_DELAY_MS` sleep [VERIFIED]. Where `Promise.all` appears it is bounded and unrelated to LLM calls (`provider-health.mjs:152` over 5 fixed canaries; `scan-ats-full.mjs:536` and `discover-ats.mjs:573` use explicit worker pools) [VERIFIED]. Backpressure: **not implemented anywhere** [VERIFIED] — the CLI does not need it; the hosted tier will.

**Blocking calls in async paths — the critical finding** [VERIFIED]:
- `agent-runner.mjs:148` — `execFileSync` (5-min timeout, `:151`) inside `executeTool()`, awaited from the async turn loop at `:258`.
- `web/src/app/api/run/route.ts:43,56,65` — three sequential `execFileSync` calls inside `ReadableStream.start()`, on the Next.js server's single event loop. Combined worst case ≈ 11 minutes of total process freeze, blocking *every* concurrent user.
- `web/src/lib/hosted-run.ts:27,67` — `execFileSync` (10s, 30s) in the `POST` path before streaming begins.

`readFileSync` in the evaluators (`ollama-eval.mjs:25`, `openai-eval.mjs:30`, `gemini-eval.mjs:34`) is benign — one-shot CLI processes, nothing else to starve [VERIFIED].

**Failure semantics: three incompatible implementations plus two absences** [VERIFIED].

| Script | Mechanism | Failure detection |
|---|---|---|
| `openrouter-runner.mjs:198-346` | Rotate free models, persist blacklist to `data/model-blacklist.json` | HTTP-status string matching (`:321-323`); 403/timeout → permanent blacklist; 429 → blacklist after 3 |
| `agent-runner.mjs:204-264` | Hardcoded chain from `HOSTED_ROUTES`, retried **per turn** | `!res.ok` only — no distinction between auth failure, rate limit, context overflow |
| `openai-eval.mjs` / `openai-tailor.mjs` | Delegated to OpenRouter's own `models` array (`routingFields`, `lib/llm-providers.mjs:185-194`) | None in-process; single `fetch`, `process.exit(1)` |
| `gemini-eval.mjs` | None | Validates shape post-hoc (`:177-216`), exits on failure |
| `ollama-eval.mjs` | None | Exits on error |

Plus the doc-vs-code gap already tabled: the plan's promised parse-failure retry does not exist in the code [VERIFIED].

**State and context.** No shared in-memory context object — each evaluator is a fresh OS process that re-reads `modes/_shared.md`, `modes/oferta.md`, `cv.md`, `config/profile.yml` from disk via `readContextFile()` (`eval-runner.mjs:33`) [VERIFIED]. Context propagation is therefore explicit and file-mediated, which is *correct* for a CLI and *wasteful but harmless* per-invocation. The one cache is filesystem-level and shared across all tenants: `.workler/jd-cache/{slug}.txt` (`hosted-run.ts:56-74`) [VERIFIED] — benign, since a public JD is the same text for everyone.

**Tool execution: the security boundary is genuinely well-built** [VERIFIED]. Every crossing uses `execFileSync`/`spawn` with an argv array and `process.execPath` — never a shell string, never `shell: true` — so shell metacharacters in a user-supplied URL cannot escape their argument position. The URL then passes `assertFetchable()` (https-only, private-host regex, own-origin block — `lib/hosted-capabilities.mjs:113-131`) **and** `assertResolvesPublic()` (actual DNS resolution, rejects private/loopback/link-local — `:187-200`), with redirects re-validated per hop (`redirect: 'manual'`, `:245-266`). The file's own `ponytail:` comment at `:141-149` honestly names the residual gap (DNS rebinding via TTL=0) rather than hiding it. JD text is handled as data, never as instruction (`:232-234`). **No injection vector found.**

One brittleness, not a vulnerability: `route.ts:51` regex-parses `openai-tailor.mjs`'s stdout to extract the next command's arguments, then feeds the captured groups into the next `execFileSync` argv (`:56`) [VERIFIED]. Still argv-array, so not injectable — but a format change in the upstream script silently breaks the chain (fails closed with a thrown message at `:52`).

**Scalability bottleneck at 10×, ranked:**
1. `execFileSync` in the PDF route — blocks the entire process, surfaces at a handful of concurrent requests, not at 10× [VERIFIED]. Fixable in isolation; the correct async pattern already exists 200 lines away.
2. The tracker/report filesystem lock, made global by the unwired tenancy — every hosted user contends for one lock, one `reports/` dir, one `applications.md`. `reserveReportNumbers` retries 50× before giving up (`reserve-report-num.mjs:35,178`) [VERIFIED].
3. `run-registry.ts` module state — silently stops guaranteeing anything the moment a second instance exists [VERIFIED].
4. One OS process spawned per request — a cost multiplier, not a correctness break [VERIFIED].

**Stack-specific:** FastAPI/Redis — `[N/A — neither present]` [VERIFIED]. Docker — service boundaries are **not** reflected in container boundaries: the only Dockerfile builds the CLI (Playwright + LaTeX base, bind-mounted source, `tail -f /dev/null` as the compose command), with no Next.js process, no port mapping, no `web/` build step [VERIFIED]. `[UNKNOWN — no deployment manifest for web/]` for actual hosted topology.

---

## Phase 5 — Anti-Pattern Detection

| Anti-pattern | Detected | Evidence | Severity |
|---|---|---|---|
| **God module** | ✅ | `test-all.mjs` 4,277 lines; `scan.mjs` 2,639 lines and simultaneously a library for 4 other roots | MEDIUM |
| **Orchestrator bottleneck** | ✅ | Every hosted request funnels through `route.ts`'s single handler, which blocks the shared loop (`:43,56,65`) | CRITICAL |
| **Shared database coupling** | ✅ (filesystem variant) | No DB; `data/applications.md` + `reports/` are the shared store, written by ~15 root scripts and by `web/` via spawn | HIGH |
| **Temporal coupling** | ✅ | `merge-tracker.mjs` must run after evaluations (`AGENTS.md` states it as a RULE, not a code guarantee); `route.ts:43→56→65` chains three scripts by parsing each one's stdout | MEDIUM |
| **Infrastructure leakage into domain** | ✅ | Evaluators mix HTTP call, response validation, and file persistence in one scope (`gemini-eval.mjs:318→177-216→364-440`) | HIGH |
| **Premature abstraction** | ❌ | `withWorkspaceRoot()` is unused, but it is *unfinished wiring* with a dated plan, not speculative generality | — |
| **Underengineering** | ✅ | No LLM provider interface (Phase 4); no shared profile loader (~55 call sites); no backpressure; retry logic absent in 2 of 5 LLM paths | HIGH |
| **Overengineering** | ❌ | Locking is the one elaborate subsystem and every part earns itself (owner tokens, PID liveness, nested recovery lock) — `lib/file-lock.mjs:18-30` replaced four buggy copy-pasted implementations | — |
| **Anemic domain model** | `[N/A]` | No OO domain layer — the "domain" is Markdown prompts in `modes/`, executed by an LLM | — |
| **Hidden monolith** | ❌ | `web/` is not presented as a microservice; the plan is explicit that it spawns local subprocesses | — |

Additional finding, unlisted in the template: **duplicate test roots** — `test/` (5 files) and `tests/` (100+) coexist with no documented rule for which is which [VERIFIED]; `[UNKNOWN]` whether intentional.

---

## Phase 6 — Executive Summary

### ARCHITECTURE SCORE: **6 / 10**

Moderate drift, two CRITICAL violations, real scalability concerns — the rubric's 6 exactly. The score is a blend of two very different halves, and averaging hides that, so both are stated:

- **CLI (root + `lib/` + `providers/`): 7/10.** Boundaries that exist are enforced mechanically (provider registry, lock primitive, the web/root shim). Drift is localised: one layering edge, two god modules, a copy-pasted config path.
- **Hosted tier (`web/` + `agent-runner.mjs`): 3/10.** The isolation guarantee its own design depends on is not wired in, and the request path blocks the shared event loop. Both are documented-as-unfinished, not concealed — which is why this is 3 and not 1.

### MATURITY LEVEL: **Early Production**

CLI is Production (740+ evaluations of real use per `AGENTS.md`, ~1,337-test suite, defect-hunt ledger). Hosted tier is Prototype. The composite is capped by the weaker half.

### PRIMARY RISKS (ranked by impact)

1. **`execFileSync` in the hosted request path freezes the whole server** — up to ~11 min per PDF request, blocking every other user. `route.ts:43,56,65` [VERIFIED].
2. **Tenancy is designed and tested but never invoked** — `withWorkspaceRoot()` and `provisionWorkspace()` have zero production callers, so all concurrent hosted users share one `cv.md`, one tracker, one `reports/` directory [VERIFIED].
3. **Five LLM call paths with three incompatible retry policies and two with none** — a provider outage degrades differently depending on which script the user happened to trigger [VERIFIED].
4. **In-memory `run-registry` is the only cross-request write guard and it assumes one process** — horizontal scaling silently removes the guarantee with no error [VERIFIED].
5. **Documented behaviour that does not exist in code** (`HOSTED-APP-PLAN.md:191` retry) — plan-as-spec drift erodes trust in the rest of the plan as a description of reality [VERIFIED].

### CRITICAL VIOLATIONS

- `web/src/app/api/run/route.ts:43,56,65` — synchronous subprocess execution inside an async request handler on a shared event loop.
- `web/src/lib/jobber.ts:16` + `provision-workspace.mjs:104` — tenancy isolation primitive with zero callers; the "a hosted run never touches another user's files" property is **[FALSE]** for the code as it stands, **[VERIFIED]** true only for the standalone primitive under test.

### REFACTOR URGENCY: **Immediate** — for the hosted tier only

The two CRITICALs are in a tier that is not yet serving real users, so nothing is on fire today. But both are cheap now and expensive later: the blocking-call fix is a mechanical swap to the async pattern already present in the same file, and wiring tenancy gets harder with every route added on top of the unscoped `jobberRoot()`. The CLI half needs nothing urgent.

---

## Phase 7 — Refactoring Roadmap

### IMMEDIATE (before the next hosted feature)

- **[Phase 2 / Phase 4 blocking-calls]** Replace the three `execFileSync` calls at `route.ts:43,56,65` with the async `spawn` pattern already used at `:256-261`, awaiting each child's `close` event → one slow PDF job stops blocking every other request. Add one regression test that fires two concurrent hosted PDF requests and asserts the second's first byte arrives before the first completes.
- **[Phase 2 / Risk 2]** Wire tenancy: call `provisionWorkspace(uid)` and wrap the handler in `withWorkspaceRoot()` at the entry of `/api/run` and `/api/assistant`. Until an account layer exists, a session-scoped uid is enough to make the isolation real → the property the design already claims becomes true, and the test at `tests/provision-workspace.test.mjs:119-137` starts covering the live path.
- **[Phase 2 / Risk 5]** Reconcile `HOSTED-APP-PLAN.md:191` with `openai-eval.mjs` — either implement the parse-failure retry or delete the sentence → the plan stops describing software that does not exist.

### HIGH-IMPACT (next sprint)

- **[Phase 4 / provider abstraction]** Extract one `callLlm({provider, model, messages, signal}) → {content, usage}` into `lib/`, and make the five call sites use it. Keep per-script prompt assembly; move only the HTTP + fallback loop → one retry policy instead of three, and adding a sixth provider stops meaning a sixth reimplementation.
- **[Phase 3 / layer leak]** Move `SYSTEM_PATHS`/`USER_PATHS` from `update-system.mjs:402` into `lib/paths.mjs`; update `lib/hosted-capabilities.mjs:17` and `provision-workspace.mjs:44` → the last lib→root edge disappears and the rule at `lib/file-lock.mjs:33-35` becomes true without exception.
- **[Phase 3 / config duplication]** Add `lib/profile.mjs` exporting `profilePath()` + `readProfile()`; migrate the ~55 `profile.yml` references → one place to change when the path or format moves.
- **[Phase 4 / naming collision]** Rename `lib/llm-providers.mjs`'s exported `PROVIDERS` to `LLM_PROVIDERS` (or rename `providers/` to `boards/`) → the two unrelated "provider" subsystems stop colliding in every grep and every conversation.

### LONG-TERM (architectural evolution)

**Target state:** the CLI stays exactly as it is — script-per-stage over flat files is the right shape for a tool that runs inside someone's coding assistant, and the lock layer already makes it safe. Evolution applies only to the hosted tier:

1. **Per-tenant workspace, wired** (prerequisite for everything below) — depends on nothing; do first.
2. **Move hosted write-coordination out of module memory** — replace `run-registry.ts`'s `Set` with the per-tenant filesystem lock once (1) lands, since each tenant then has its own lock file. Depends on 1. Risk: low — same primitive already trusted by the CLI.
3. **Account/pass storage** (`HOSTED-APP-PLAN.md` §7, unbuilt) — its own `ponytail:` note already calls the move: `node:sqlite` single-file, Postgres when a second app box appears. Depends on 1. Risk: medium — first real database in a codebase with none.
4. **Extract the run executor** — if per-request subprocess cost becomes the binding constraint, move spawning behind a small worker interface so it can later run out-of-process. Depends on 2. Risk: medium; do not do this before measuring, since #1 above may make it unnecessary.

### SWITCHING TRIGGERS

- **A second app instance is provisioned** → `run-registry.ts`'s single-process assumption breaks silently. Must have roadmap item 2 first.
- **Two hosted users are active concurrently** → the shared-`jobberRoot()` data corruption becomes reachable in production. Must have item 1 first.
- **Hosted PDF requests exceed ~1 concurrent** → the `execFileSync` freeze becomes user-visible. Immediate fix above.
- **A third LLM provider is added** → a fourth retry implementation is written. Do the `callLlm` extraction first.
- **`WORKLER_WORKSPACES_ROOT` needs to live on a different volume than the checkout** → hardlinks cannot cross filesystems (`provision-workspace.mjs:27-31`), so the provisioning strategy must change to copy-on-write or a container image.
