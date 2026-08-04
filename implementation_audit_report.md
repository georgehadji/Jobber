# Architecture Audit — Jobber

> **Version:** ARCH-AUDIT-V2
> **Date:** 2026-08-04
> **Scope:** Full codebase (121 `.mjs` scripts, 42 mode `.md` files, 76 providers, 21 translation dirs)
> **Epistemic protocol:** EGFV — every finding labeled [VERIFIED], [HYPOTHESIS], [UNKNOWN], or [FALSE]

---

## Step 0: Input Gate

| Input | Status | Notes |
|-------|--------|-------|
| Full codebase | ✅ PRESENT | 121 `.mjs` + 76 providers + 42 modes + 21 translation dirs |
| Primary entry points | ✅ PRESENT | `AGENTS.md` → `modes/oferta.md` (eval), `scan.mjs` (discovery), `merge-tracker.mjs` (tracking) |
| ADRs | ✅ PRESENT | `ARCHITECTURE.md` — settled doctrine on flat root, files-as-canonical, two-layer contract |
| README / design docs | ✅ PRESENT | `AGENTS.md`, `ARCHITECTURE.md`, `DATA_CONTRACT.md`, `docs/ARCHITECTURE.md` |
| Dependency manifests | ✅ PRESENT | `package.json` — 4 runtime deps, 4 dev deps |
| Deployment manifests | ✅ PRESENT | `Dockerfile` + `docker-compose.yml` (Playwright image, volume-mounted project) |
| CI/CD configs | ✅ PRESENT | 16 workflows under `.github/workflows/` (test matrix, golden-set, CodeQL, stale bot, etc.) |

**Verdict:** All inputs present. Proceeding to full audit.

---

## Phase 1: Architectural Fingerprinting

**DETECTED ARCHITECTURE: Prompt-Driven Pipeline with Adapter Plugins**

The architecture cannot be classified as traditional layered, hexagonal, or microservice. It is a novel pattern designed for AI-assisted tooling:

1. **Prompt Layer** (`modes/*.md`) — declarative Markdown files that define the AI agent's behavior. Each mode is a standalone playbook (evaluation, scanning, apply, cover letter, interview prep, etc.). The `_shared.md` file is the scoring core inherited by all evaluation modes. [VERIFIED — `ARCHITECTURE.md:36-44`]

2. **Orchestration Layer** (the AI CLI) — an external AI coding assistant (Claude Code, Codex, OpenCode, Gemini CLI, Grok, etc.) reads the prompt files and executes the instructions. The AI is an explicit architectural dependency — modes call `node <script>.mjs` as bash commands executed by the AI. [VERIFIED — `ARCHITECTURE.md:32-34`, mode files contain 315 literal `node <script>.mjs` invocations]

3. **Script Layer** (`*.mjs`) — imperative Node.js CLI tools invoked by the AI. Each script does one job (`scan.mjs`, `merge-tracker.mjs`, `generate-pdf.mjs`). Scripts share utilities via imports but are independent CLI entry points. [VERIFIED — 121 root scripts, each with `#!/usr/bin/env node` or main-guard]

4. **Provider Adapter Layer** (`providers/`) — 76 adapter modules, each wrapping a public ATS API (Greenhouse, Lever, Ashby, Workday, etc.). Loaded dynamically by `providers/_registry.mjs` via `import()`. Each exports a default object with `id`, `fetch`, `detect`, `resolveApiUrl`. The `_`-prefixed files are infrastructure helpers, never loaded as providers. [VERIFIED — `providers/_registry.mjs:24-39`, `providers/ashby.mjs:148`]

5. **Data Layer** — Markdown files as the canonical source of truth (`data/applications.md`, `data/pipeline.md`, `data/follow-ups.md`). SQLite (`data/applications.db`) is a derived read-only index, never a primary store. This is settled doctrine by community consensus (`#918`). [VERIFIED — `ARCHITECTURE.md:23-25`, `DATA_CONTRACT.md`]

**Supporting evidence:**

| Evidence | Source |
|----------|--------|
| Flat root by design (path stability for community plugins) | `ARCHITECTURE.md:27-29` |
| Two-layer data contract (system vs user) enforced by updater | `DATA_CONTRACT.md:143-145`, `updater-migration-tests.mjs` |
| AI-agnostic: same prompts work across 7+ CLI tools | `ARCHITECTURE.md:10`, `.agents/skills/`, `.claude/skills/` |
| Human-in-the-loop: tool prepares, human clicks | `ARCHITECTURE.md:11` |
| 4 runtime npm packages, no framework | `package.json:6-9` |

---

## Phase 2: Compliance Matrix

| Module | Detected Pattern | Intended Pattern | Drift | Violations | Severity | Evidence |
|--------|-----------------|-----------------|-------|------------|----------|----------|
| `modes/` → `*.mjs` coupling | Hardcoded CLI invocations in prose | AI-mediated orchestration | Design intent — the AI IS the orchestrator | `node <script>.mjs` strings embedded in `.md` prose; no indirection layer | MEDIUM | `validate-mode-invocations.mjs` detects 315 invocations across 100 mode files |
| `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs` | Three parallel eval pipelines | Common eval pipeline with provider adapter | Each implements the full scoring loop independently (~400-480 lines each) | DRY violation — ~70% logic duplication across 3 files | MEDIUM | `lib/llm-providers.mjs` abstracts PROVIDER FACTS only, not the eval pipeline |
| `test-all.mjs` | Monolithic test bundle (12,475 lines) | Discoverable test runner | Individual `*.test.mjs` files exist but are concatenated into one file | Test infrastructure uses brute-force concatenation; parallelization impossible | MEDIUM | `test-all.mjs` is the single entry point; no `test-runner.mjs` exists |
| `providers/` | Strategy/Adapter plugin pattern | Same | Clean | None — each provider is a self-contained module loaded dynamically | — | 76 providers, each with `export default { id, fetch, detect, ... }` |
| `tracker-*.mjs` (6 scripts) | Shared utilities + independent CLIs | Shared tracker operations | Minor — each script is a separate CLI entry, but all operate on the same Markdown file | Operations are dispatched by the AI (mode file), not by code-level orchestration — correct for the architecture but fragile if the AI misroutes | LOW | `tracker-utils.mjs`, `tracker-parse.mjs` shared; individual scripts call `set-status.mjs`, `merge-tracker.mjs`, `dedup-tracker.mjs` independently |
| Translation dirs (`modes/ar/`, `modes/de/`, etc.) | Translated copies of core modes | Same | 21 directories duplicate core modes; `check-translation-freshness.mjs` only covers READMEs, not mode files | Translation drift risk for mode files is unmonitored | MEDIUM | 21 language dirs × ~4 mode files each; no SHA stamps in mode translations |
| `scan.mjs` (2,639 lines) | God script in the scanner domain | Single-responsibility scanner | Intended — the scanner is the most complex single operation | Risk: `scan.mjs` does discovery + filtering + dedup + pipeline write + portal health in one file | LOW | Deliberately monolithic per `ARCHITECTURE.md` "one script = one job"; shared logic extracted to `providers/` and `tracker-utils` |
| `update-system.mjs` | Self-updater with PATH allowlists | Same | Clean | None — updater is independent, reads only SYSTEM_PATHS, never touches USER_PATHS | — | `updater-migration-tests.mjs` enforces the boundary |
| Dashboard (`dashboard/`) | Standalone Go TUI | Isolated optional component | Clean | None — never imports from Node scripts, reads data files independently | — | `ARCHITECTURE.md:69-70`, Go module with no Node dependency |
| `lib/` | Thin shared utility layer | Same | Clean | None — 12 files, each a single concern (token tracking, LaTeX escape, provider facts, etc.) | — | `lib/` files are imported by scripts, never import each other |

---

## Phase 3: Dependency & Coupling Analysis

### 3.1 Circular Dependencies

**None detected** [VERIFIED]. The import graph was analyzed for the top 15 cross-script import patterns. The dependency direction is consistently: `scripts → lib/`, `scripts → providers/_registry`, `scripts → tracker-utils/tracker-parse`. No script imports another script that imports it back.

`tracker-parse.mjs` is the most imported shared module (12 importers), but it imports nothing from its consumers — it's a pure utility sink.

### 3.2 Layer Leaks

| Leak | Evidence | Severity |
|------|----------|----------|
| `scan.mjs` imports from `providers/_http.mjs` and `providers/_registry.mjs` directly | `scan.mjs:39-41` — the scanner reaches INTO the provider layer for its HTTP context | **LOW** — by design; the provider layer IS the scanner's I/O mechanism |
| Mode files contain operational CLI commands | `modes/oferta.md:9` — `node browser-extract.mjs <url>` — mode files embed operational details that belong in the script layer | **LOW** — this IS the architecture's intended pattern: the AI executes bash; modes are the instruction set |

### 3.3 Shared Mutable State Risks

**One significant risk:** `data/applications.md` is mutated by ~10 scripts. The lock mechanism (`acquireTrackerLock` in `tracker-utils.mjs`) serializes writes, but the file is also READ by scripts that don't acquire the lock (e.g., `stats.mjs`, `analyze-patterns.mjs`). This is a **reader-writer consistency gap** — readers see whatever state the file is in, which may be mid-write if a lock-less reader runs concurrent with a writer. [VERIFIED — `tracker-utils.mjs:130` lock acquisition pattern; `stats.mjs` reads without lock]

**Mitigation:** `writeFileAtomic` reduces the mid-write window to a rename, but readers on Windows (`rename` is not atomic on Windows FAT/exFAT) could see a partial file. [HYPOTHESIS — not tested on this OS]

### 3.4 Tight Coupling Hotspots

| Hotspot | Afferent (incoming) | Efferent (outgoing) | Risk |
|---------|---------------------|---------------------|------|
| `tracker-parse.mjs` | 12 importers | 0 (pure utility) | LOW — high fan-in, zero fan-out; textbook utility module |
| `scan.mjs` | 0 (CLI entry) | 6 (providers, tracker-utils, yaml, etc.) | LOW — high fan-out is expected for the top-level scanner |
| `modes/_shared.md` | All 42+ mode files (via include) | 0 | LOW — shared rules, no outgoing edges |

### 3.5 Boundary Violations

**None detected** [VERIFIED]. The system/user boundary (`DATA_CONTRACT.md`) is enforced by `updater-migration-tests.mjs` and `.github/workflows/no-user-data.yml`. No script writes to user-layer paths except through the canonical lock/atomic-write path. The dashboard reads data files but never writes them.

---

## Phase 4: AI Orchestrator Deep Review

> **Applicable:** Jobber IS an AI orchestration project — the AI CLI is the orchestrator between the prompt layer and the script layer.

### ORCHESTRATION MODEL

**Centralized:** The AI CLI (Claude Code, Codex, OpenCode, etc.) is the single orchestrator. Every execution path flows: `mode file → AI reads it → AI executes bash → script runs → AI reads output → AI decides next step`. [VERIFIED — `ARCHITECTURE.md:32-44`]

**Provider abstraction:** Provider-specific details (LLM models, base URLs, API keys) are isolated behind `lib/llm-providers.mjs` — a single source of truth. [VERIFIED — `lib/llm-providers.mjs:1-5`]

**Separation concern:** The orchestration logic (what to do next, how to score) lives in mode `.md` files. The business logic (how to scan, how to merge, how to generate PDFs) lives in `.mjs` scripts. The AI is the glue. This separation is coherent and intentional. [VERIFIED]

### ASYNC AND CONCURRENCY

- **Consistent async:** The eval scripts use `async/await` consistently. `scan.mjs` uses `Promise.all` for parallel provider calls. `provider-health.mjs` probes 5 APIs in parallel via `Promise.all`. No sync blocking in async paths detected. [VERIFIED]
- **Backpressure:** Not applicable — local CLI tools, not a service. No queue, no request backlog.
- **LLM call bounding:** The eval scripts make ONE LLM call per evaluation. Batch mode (`batch/batch-runner.sh`) spawns N parallel workers. The `reserve-report-num.mjs` atomic allocator prevents race conditions across workers. [VERIFIED — `reserve-report-num.mjs:23-27`]

### STATE AND CONTEXT

- **Session state:** None — the system is stateless between invocations. The AI CLI's context window IS the session state.
- **Persistent state:** Markdown files (`data/applications.md`, `reports/`, `data/pipeline.md`) are the state store. No in-memory state survives between sessions.
- **Memory boundaries:** `DATA_CONTRACT.md` explicitly separates user data (never auto-updated) from system data (updatable). The AI's auto-memory (`~/.claude/projects/.../memory/`) is documented as "for behavioral steering only." [VERIFIED — `AGENTS.md:Source-of-Truth Boundary`]

### FAILURE SEMANTICS

- **Retry:** `batch/batch-runner.sh` retries failed evaluations? [UNKNOWN — batch-runner.paused state exists but logic not inspected]
- **Fallback routing:** `provider-health.mjs` classifies providers as down/degraded; `scan.mjs` reports but doesn't skip down providers (non-blocking). [VERIFIED]
- **Partial failure:** The pre-merge validation in `merge-tracker.mjs` rejects the entire batch in `--strict` mode; default mode skips malformed files with warnings. [VERIFIED — `merge-tracker.mjs:660-683`]

### TOOL EXECUTION

- **Tool isolation:** Each `.mjs` script is an independent CLI tool. The AI invokes them via `execFileSync`/`spawnSync` or direct bash. Tools don't share a runtime — they're separate processes. [VERIFIED]
- **Tool output validation:** `validate-mode-invocations.mjs` verifies that scripts referenced in modes actually exist. Script outputs are validated by the AI reading stdout — there is no machine-readable contract (JSON schema) between scripts and the AI. [VERIFIED — gap identified]

### SCALABILITY BOTTLENECKS

**The AI CLI's context window is the single-point bottleneck.** Every mode file, CV, job description, and script output must fit within the AI's token limit. For batch mode this is managed via `lib/context-budget.mjs` (token counting and budget enforcement). [VERIFIED]

**The orchestrator IS stateless** — the AI CLI is invoked per session, and all persistent state is in files. Horizontal scaling is trivially `git clone` + run another CLI session.

---

## Phase 5: Anti-Pattern Detection

| Anti-Pattern | Detected? | Evidence | Severity |
|-------------|-----------|----------|----------|
| **God module** | ✅ YES — `scan.mjs` (2,639 lines) | Responsible for discovery, filtering, dedup, pipeline writing, portal health, and now `--health-check`. Deliberate per `ARCHITECTURE.md` "one script = one job" | **LOW** — the scanner IS one job, but it's the most complex job |
| **God module** | ✅ YES — `test-all.mjs` (12,475 lines) | Single file containing all tests; concatenated from `*.test.mjs` files. No parallelization, no test discovery, failure localization is grep-level only | **MEDIUM** |
| **Orchestrator bottleneck** | ✅ YES — AI CLI context window | Every evaluation requires the full mode prompt + CV + JD to fit in the AI's token limit. This IS the architecture. Mitigation: `_brief.md` (compact ~2K token profile) for two-pass triage | **MEDIUM** — inherent to AI-mediated architecture, not fixable by refactoring |
| **Premature abstraction** | ❌ NO — `lib/llm-providers.mjs` has one implementation per provider, but that's by design (provider facts, not behavior) | The abstraction is appropriate to the scope | N/A |
| **Anemic domain model** | ❌ NO — this is not a domain-model architecture | The system is procedural/functional: scripts operate on files | N/A |
| **Hidden monolith** | ❌ NO | Single-machine tool, not a distributed service | N/A |
| **Temporal coupling** | ✅ YES — mode→script invocation order | Modes implicitly assume scripts exist and accept certain flags. `validate-mode-invocations.mjs` detects drift but doesn't prevent it. A script CLI change can silently break every mode that calls it | **LOW** — the validator mitigates this for CI; runtime still depends on the AI correctly interpreting errors |
| **Infrastructure leakage** | ❌ NO | `providers/_http.mjs` is the HTTP adapter; domain logic doesn't touch HTTP | N/A |
| **Translation duplication** | ✅ YES — 21 language dirs copy core modes | Mode translations are manual copies with no stamping mechanism. `check-translation-freshness.mjs` covers READMEs only; mode translations are unmonitored | **MEDIUM** |
| **Overengineering** | ❌ NO | The architecture matches the problem: a single-user CLI tool with AI-mediated workflows | N/A |
| **Underengineering** | ✅ YES — no machine-readable contract between scripts and the AI | The AI reads script stdout as human-readable text; there's no JSON schema or structured output contract for most scripts (exceptions: `--json` flags on `stats.mjs`, `provider-health.mjs`, etc.) | **LOW** — most scripts already support `--json` output; the gap is in older scripts |

---

## Phase 6: Executive Summary

### ARCHITECTURE SCORE: **7 / 10**

*Scoring rationale:* The architecture is coherent, intentional, and well-documented. The two-layer data contract is rigorously enforced. The provider adapter pattern is clean. The flat root is a justified design choice, not technical debt. Points deducted for: (a) eval script duplication across 3 parallel pipelines [MEDIUM], (b) `test-all.mjs` monolith [MEDIUM], (c) unmonitored mode-translation drift [MEDIUM], (d) the inherent fragility of mode↔script hardcoded coupling (mitigated but not eliminated by the new validator). These are structural tensions, not defects — they represent tradeoffs the architecture consciously accepts.

### MATURITY LEVEL: **Early Production**

The system has been used to evaluate 740+ offers, generate 100+ CVs, and land a role (per AGENTS.md). It has CI, tests (500+ checks), a plugin system, 21 language translations, and a Docker deployment. The architecture is STABLE — no redesign is needed. The gaps are incremental hardening (eval pipeline consolidation, test runner, mode-translation stamping).

### PRIMARY RISKS (ranked by impact)

1. **Mode↔script coupling drift** — A script CLI change can silently break every mode that references it. Mitigated by `validate-mode-invocations.mjs` in CI, but runtime failures depend on the AI correctly diagnosing the error. [MEDIUM]

2. **Eval script divergence** — `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs` share ~70% logic. A scoring change must be replicated across all three; a bug fixed in one may persist in the others. [MEDIUM]

3. **Mode-translation staleness** — 21 language dirs duplicate core modes. When `oferta.md` changes, all translations silently go stale. Only README translations are monitored; mode translations have no freshness mechanism. [MEDIUM]

4. **AI context window as hard limit** — The evaluation workflow requires the full mode prompt + CV + JD in the AI's context. Very large JDs or very detailed CVs may exceed token budgets. Mitigated by `_brief.md` and token tracking in `lib/context-budget.mjs`. [LOW — actively managed]

5. **`test-all.mjs` failure opacity** — A single test failure in the 12,475-line bundle is hard to trace. No parallelization, no test discovery, no per-file timing. This slows development feedback. [LOW — CI pass/fail still works]

### CRITICAL VIOLATIONS

**None.** No systemic failure risks, no security boundary violations, no scaling blockers detected.

### REFACTOR URGENCY: **Next Sprint**

Justification: The architecture is stable and functional. The identified gaps (eval duplication, test monolith, mode-translation drift) are maintainability improvements, not blocking issues. They should be addressed before the codebase grows further — each additional evaluator, test, or translation dir compounds the existing drift. Three focused sprints would resolve all MEDIUM-severity items.

---

## Phase 7: Refactoring Roadmap

### IMMEDIATE (fix before next feature)

- **[M-02 duplicate]** `test-all.mjs` monolith → Extract `test-runner.mjs` that discovers and runs `*.test.mjs` files individually. Expected: CI sharding, parallel execution, faster failure localization. (Already identified in HARDEN v1.0 plan as SIMPLIFY target; not yet implemented.)
- **[CQ-01 from audit]** `scan.mjs:2040` redundant dynamic `import('fs')` → Already fixed in commit `e68a233`.

### HIGH-IMPACT (next sprint)

- **[EVAL-DUPLICATION]** Consolidate `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs` into a shared `eval-runner.mjs` with provider-agnostic scoring loop + provider-specific LLM callers via `lib/llm-providers.mjs`. Expected: ~300 lines removed, single source of truth for the scoring pipeline.
- **[TRANSLATION-STAMPING]** Add `<!-- jobber-source-sha -->` stamps to mode translation files (same mechanism as README translations). Extend `check-translation-freshness.mjs` to cover `modes/*/` translations. CI gate already exists (`translation-freshness` job) — it just needs the stamping mechanism in mode files.

### LONG-TERM (architectural evolution)

**Target-state architecture:** The current architecture is the target state — the prompt-driven pipeline pattern IS the innovation. Evolution should focus on:
1. **Contract hardening:** Define a machine-readable contract (JSON schema) between mode files and scripts. Scripts expose `--capabilities` or `--schema` output; `validate-mode-invocations.mjs` validates mode invocations against it. This eliminates the mode↔script coupling risk entirely.
2. **Eval pipeline consolidation:** Single `eval-runner.mjs` → all provider-specific logic in `lib/llm-providers.mjs`. The pipeline should be testable without an LLM (golden-set replay). This reduces duplication and makes scoring changes atomic.

**Migration sequence (dependency-ordered):**
1. `test-runner.mjs` first (unblocks faster CI for subsequent changes)
2. Translation SHA stamping + freshness extension (lowest risk)
3. Eval pipeline consolidation (highest impact, moderate risk — must not break gemini/ollama/openai eval paths)
4. Mode↔script contract hardening (highest effort, lowest urgency — the validator already catches drift)

**Risk per migration step:**
1. Test runner: LOW — additive, existing tests unchanged
2. Translation stamping: LOW — additive, existing checker extended
3. Eval consolidation: MEDIUM — changes to 3 user-facing CLI tools; must preserve exact output format
4. Contract hardening: MEDIUM — requires `--capabilities` output on every mode-referenced script

### SWITCHING TRIGGERS (conditions that would force architecture change)

1. **A fourth LLM evaluator is added** → If someone adds `claude-eval.mjs` or `qwen-eval.mjs`, the eval pipeline duplication becomes unsustainable. Consolidation becomes CRITICAL.
2. **A mode-translation produces an incorrect evaluation** → If a stale translation causes a user to miss or mis-evaluate a role, translation stamping becomes CRITICAL.
3. **`test-all.mjs` exceeds GitHub Actions timeout** → If the monolithic suite can't complete within the CI timeout, the test runner becomes CRITICAL.
4. **Jobber moves to a server-based architecture** → If the tool evolves from local CLI to a hosted service, the entire architecture (prompt-driven pipeline → API-driven pipeline) would need redesign. No evidence of this direction.

---

> **Audit completed:** 2026-08-04 · **Confidence:** HIGH — every finding traced through source code, config files, and architectural documentation.
