# Hosted app plan — Workler

**Status:** plan of record, 2026-09-08, phases 0–2 built the same day (§9). Model routing (`HOSTED_ROUTES`), the runner (`agent-runner.mjs`), and tenancy (`provision-workspace.mjs`, hosted `/api/run`) are in code. Still unbuilt: upload+chat+skin (§3–4), account/pass (§7), hosted apply (phase 5), launch gate (phase 6).
**Labels:** VERIFIED (checked in this checkout or a public API) · INFERENCE · DECISION · UNKNOWN (founder).
**Companion documents:** `docs/WEBSITE-PLAN.md` (the site), `../workler-site/spec/brief.md` (business facts: 90-day pass at €79, seeker pays and nobody else, launch only when purchase works), `DATA_CONTRACT.md` (the tenancy boundary, see §2), `docs/ARCHITECTURE.md`, `docs/RUNNING_ON_A_BUDGET.md`.

---

## 0. The one-paragraph version

The hosted product already exists as software; what does not exist is the hosting. `web/` is a Next.js app that orchestrates the real Jobber engine by spawning the user's own AI coding CLI headless and parsing its stream. It has a chat assistant with a gated action registry, a CV ingest flow that proposes and never writes without confirmation, evaluation and PDF workers, an apply flow whose never-submit rule is enforced in code, and a cost badge. **The hosted tier replaces one thing: the process on the other end of `spawn()`.** A small Node script, `agent-runner.mjs`, talks to OpenRouter with a tool-use loop and emits the same stream format Claude Code emits, so the four routes that parse that stream keep working unchanged. Multi-tenancy comes from the data contract the project already has: the system layer is shared and read-only, the user layer is a directory per customer. Evaluation and tailoring do not need an agent at all — `openai-eval.mjs` and `openai-tailor.mjs` already do the whole job in one cached call each and persist canonically. That is the plan: an adapter, a provisioner, a login, and a skin.

---

## 1. What exists — the reuse inventory (VERIFIED, this checkout)

| Need | Already here | Where | What changes for hosted |
|---|---|---|---|
| Chat with an agent that acts | Assistant console + action envelopes `<<act:ID {json}>>` parsed client-side, validated by ONE registry shared with the UI buttons; confirm cards gate writes; `AUTO_FIRE_MAX = 3`, `BATCH_CAP = 12` | `web/src/components/assistant-console.tsx`, `web/src/app/actions/registry.ts`, `web/src/app/api/assistant/route.ts` | The CLI behind the route. Nothing in the protocol. |
| CV upload → structured CV | Drop zone + paste; server extracts, LLM **proposes** markdown between `<<cv:start>>`/`<<cv:end>>` plus a `<<cv:seed>>` line; user reviews; `POST /api/cv` writes atomically with a `.bak` | `web/src/components/cv/cv-ingest.tsx`, `web/src/app/api/cv/ingest/route.ts`, `web/src/app/api/cv/route.ts`, `lib/pdf-text.mjs` | Extract text server-side for every format instead of handing a file path to a CLI. Add `.docx`. |
| Evaluation, persisted canonically | Reserve number → report → tracker TSV → `merge-tracker.mjs`, in one script with a cached 12K-token prefix | `openai-eval.mjs` (+ `eval-runner.mjs`, `lib/context-budget.mjs`) | Nothing. Call it with the hosted key and a chain. |
| Tailored CV → PDF | HTML tailoring, then Playwright render | `openai-tailor.mjs`, `generate-pdf.mjs` | Nothing. |
| Workers with live cards, cost | `POST /api/run` streams NDJSON; worker cards render inline in chat; `cost-badge.tsx` | `web/src/app/api/run/route.ts`, `web/src/components/jobs/*`, `web/src/components/cost/` | Route `evaluate`/`pdf` kinds to the two scripts above instead of an agent with Bash. |
| Never submits | Action vocabulary has no "submit"; `isSubmitLabel()` refuses submit-like controls at click time; tested | `web/src/lib/apply/drive.ts`, `submit-guard.ts`, `web/test-submit-guard.mjs` | Nothing. Keep the tests in CI for the hosted build. |
| Durable memory about the user | Managed block in `modes/_profile.md` (single source of truth, the CLI sees it too) | `web/src/lib/jobber.ts` `rememberFact()` | Nothing; it is a user-layer file. |
| Model facts in one place | Every id, key env, base URL, price | `lib/llm-providers.mjs`, drift-guarded by `tests/llm-providers.test.mjs` | `HOSTED_ROUTES` added (this change). |
| Free/paid boundary | The whole judgment in the CLI (MIT) | brief §1 | The hosted tier sells the running, not a better verdict. The code above is the proof. |

What is **not** here: any notion of a second user (`jobberRoot()` is one directory per process), authentication, a payment webhook, a text extractor for `.docx`, a sandbox, and a runner that speaks OpenRouter with tools. That is the entire build list.

---

## 2. Architecture

### 2.1 The seam: the engine is a `CliSpec`

```
                       browser (chat · upload · cards · confirm)
                                     │  fetch / SSE-style streams
                                     ▼
              Next.js routes  (assistant · cv/ingest · run · explore/ai · apply/*)
                                     │  spawn(binPath, spec.args(prompt), { cwd: workspace })
                       ┌─────────────┼──────────────────────────┐
                       ▼             ▼                          ▼
         [local-first]  claude -p …  codex exec …     [hosted]  node agent-runner.mjs -p … --tools …
                                                                   │  OpenRouter chat/completions
                                                                   │  models: [primary, alt, floor]
                                                                   │  provider: { data_collection: deny }
                                                                   ▼
                                                    tool loop: Read · Glob · Grep · WebFetch
                                                               Write · Edit (workspace-confined)
                                                               RunScript (allowlisted *.mjs)
                                                                   │
                                     emits Claude-shaped stream-json NDJSON → the routes' existing parser
```

DECISION. Add one entry to `KNOWN` in `web/src/lib/clis.ts`:

```ts
{ id: "workler", name: "Workler hosted", bin: process.execPath, run: "agent-runner", url: "",
  args: (p) => [path.join(jobberRoot(), "agent-runner.mjs"), "-p", p] }
```

and have `resolveCli("workler")` succeed only when `HOSTED=1`. The assistant, ingest, run and explore routes already branch on `isClaude` to parse `stream-json`; `agent-runner.mjs` emits exactly that shape (`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"…"}}}` per chunk, one final `{"type":"result","usage":…,"model":…}` line), so the hosted engine takes the Claude branch. The `--allowedTools` / `--disallowedTools` flags those routes already pass become the runner's capability list. **Ports and adapters:** `CliSpec` is the port, the runner is the adapter, the routes are unchanged consumers.

### 2.2 Tenancy: the data contract is the boundary

`DATA_CONTRACT.md` already partitions every path into a **user layer** (`cv.md`, `config/`, `modes/_profile.md`, `modes/_custom.md`, `data/`, `reports/`, `output/`, `jds/`, `documents/`, `interview-prep/`, `writing-samples/`, `portals.yml`, …) and a **system layer** (scripts, `modes/*.md`, `templates/`, `lib/`, `providers/`, `docs/`). A workspace is that contract made physical:

```
/srv/workler/checkout/                 the fork at a pinned release, node_modules installed, read-only
/srv/workler/workspaces/{uid}/
  ├─ *.mjs, lib/, modes/*.md, templates/, providers/, batch/, fonts/   hardlinks into checkout (system layer)
  ├─ node_modules -> ../../checkout/node_modules                        symlink
  ├─ cv.md  config/  data/  reports/  output/  jds/  documents/  modes/_profile.md  modes/_custom.md  …   real files (user layer)
  └─ .workler/  transcripts/*.jsonl  usage.tsv                          hosted-only state, gitignored pattern
```

Why hardlinks and not symlinks for scripts: every script resolves its root from `import.meta.url`, and Node resolves a symlinked ESM entry to its real path — a symlinked `openai-eval.mjs` would read the *checkout's* `cv.md`, not the tenant's. A hardlink is a real path. `node_modules` can stay a symlink because package resolution walks up from the importing file's real location, which is inside the workspace. `provision-workspace.mjs` builds this from the system-layer list in `DATA_CONTRACT.md` (parse the table, do not restate it), is idempotent, and re-runs on every deploy to refresh the hardlinks.

`jobberRoot()` becomes per-request: an `AsyncLocalStorage` set by middleware from the session cookie, falling back to `JOBBER_ROOT` for local-first. One function changes; every caller inherits it.

`// ponytail: hardlinks need one filesystem and a re-provision per deploy; move to an overlay mount per tenant when workspaces outgrow one box.`

### 2.3 Capabilities, not shell

The CLI branch grants `Bash` to evaluation workers so they can run `reserve-report-num.mjs` and `merge-tracker.mjs`. The hosted runner has **no shell**. It has:

| Tool | Scope | Notes |
|---|---|---|
| `Read`, `Glob`, `Grep` | workspace only, `realpath` must stay under the workspace root | symlink escapes refused |
| `Write`, `Edit` | user-layer paths only (the contract's user table) | writing `modes/_shared.md` or a script is refused |
| `WebFetch` | `https:` only, blocklist of private ranges and the app's own origin, 2 MB cap, text extraction | the JD is untrusted data (AGENTS.md); it never becomes an instruction |
| `RunScript` | allowlist: `reserve-report-num`, `merge-tracker`, `set-status`, `generate-pdf`, `jd-skill-gap`, `verify-portals`, `scan`, `check-liveness`, `detect-reposts`, `stats`, `followup-cadence` | args validated per script; `cwd` = workspace; 5-minute timeout; no env passthrough except the hosted key |

And the two heavy jobs do not go through the agent at all:

- `POST /api/run` kind `evaluate` on hosted → `node openai-eval.mjs --file jds/{id}.txt --url https://openrouter.ai/api/v1 --model {HOSTED_ROUTES.evaluate}` with `OPENROUTER_DATA_COLLECTION=deny`. One call, cached prefix, canonical persistence, byte-identical to the CLI path.
- kind `pdf` → `openai-tailor.mjs` then `generate-pdf.mjs`.

This is cheaper, deterministic, and removes the largest prompt-injection surface (an agent with write access reading a hostile JD) from the most frequent operation.

### 2.4 Streaming and transcript

Wire format stays Claude `stream-json` end to end. Every chat turn is appended to `.workler/transcripts/{session}.jsonl` — `{ts, role, text, model, usage, envelopes}` — append-only, the same discipline as `data/status-log.tsv`. The UI reads back from it on reload instead of `localStorage`, so a transcript survives devices and is exportable.

---

## 3. CV upload

DECISION. Accept `.pdf`, `.docx`, `.md`, `.txt` up to 10 MB by drop, file picker, or paste. Server-side:

1. **Extract** — `.pdf` via `lib/pdf-text.mjs` (exists), `.docx` via `mammoth` (**one new dependency, justified**: it is the format segment A actually has; the CLI's "convert it to PDF first" is a developer's answer), `.md`/`.txt` raw. Scanned PDFs with no text layer return a clear "this PDF is an image; paste the text" instead of an empty proposal.
2. **Normalise** — strip control characters, cap at 24 000 characters (the existing `TEXT_SRC` cap), keep the file name out of the prompt.
3. **Propose** — the existing ingest prompt, run on `HOSTED_ROUTES.ingest`, with the existing `<<cv:start>>` … `<<cv:end>>` + `<<cv:seed>>` output contract. Temperature 0. "INVENT NOTHING" stays in the prompt and is now also checked: any date, employer or metric in the proposal that does not occur in the extracted text is flagged in the review panel.
4. **Review** — the existing review phase: side-by-side source and proposal, the readiness score (`lib/cv/quality.ts`), edit in place.
5. **Confirm → write** — `POST /api/cv`, atomic with backup. The original upload is deleted after extraction (the route already does this) unless the user ticks "keep the original in my documents folder", which places it under `documents/cv/` where `ingest-documents.mjs` expects it.

Nothing about the CV reaches a model before step 3, and step 3 runs under `data_collection: deny`. The pipeline is **pipes and filters**: extract → normalise → propose → confirm → write, each a pure function except the last.

---

## 4. Chat: doing the job by talking

### 4.1 What the agent can do, in its own words

The greeting states capability, not personality (capability transparency was the top finding in every 2026 chat-UX source): *"I can read your CV, score a posting against it, tell you not to apply, prepare a tailored CV, draft form answers, and track where things stand. I never send anything. You do."* The action list is the registry; the greeting is generated from it so the two cannot drift.

### 4.2 Protocol (unchanged, one addition)

- Envelopes `<<act:ID {json}>>` stay: vendor-neutral, parsed client-side, validated by hand in the registry, side-effects gated by confirm cards. Structured-output modes are not used for envelopes because the model must be swappable across the chain.
- **Addition:** the runner's final `result` line carries `model` and `usage`; the console shows *which model answered and what the turn cost* on every assistant message (extends `cost-badge`). A user paying €79 for ninety days sees the meter; that is the honest counterpart of a flat price.
- Spending actions (`evaluate`, `evaluateCompany`, `research`, `generatePdf`) already confirm above `AUTO_FIRE_MAX`. On hosted they also check the pass budget (§7) and refuse with the remaining figure when exhausted.

### 4.3 Model-quality gate before launch

A fixed set of 24 prompts (onboarding, "evaluate this", "make this answer shorter", a hostile JD containing instructions, a DACH posting in German) is run against each model in `HOSTED_ROUTES.chat` and scored on: envelope well-formedness, refusal to invent a URL, obeying the never-submit rule, output language. A model that scores under 22/24 is removed from the chain. This is the only model benchmark that matters for this product; the public leaderboards are the shortlist, not the decision.

### 4.4 Design

DECISION. The app is skinned with the site's tokens (`workler-site/src/styles/tokens.css`: OKLCH paper/ink, Instrument Sans + IBM Plex Mono, near-zero radius, no shadows, the 4.0 threshold rule, the colour licence: signal orange only for a score below 4.0 or a legitimacy flag). Reasons: the app is what they paid for, and a visual break at login reads as a different company. `@paper-design/shaders-react` (the hero glow) is removed. Lucide icons stay only where a control has no room for a label, always with `aria-label`.

Layout: **chat-first**. Home is the console with the drop zone inside it on first run; the pipeline table, report and CV editor open as panels from worker cards and envelopes, not as a separate app to learn. Mobile is the same page.

Chat mechanics, from the 2026 guidance and from what the console already does right:

- stream text immediately; defer code fences until the closing fence; a visible **Stop** that cancels the request (the routes already kill the child on `cancel()`);
- tool activity is a worker card, not prose ("Evaluating Acme · deepseek-v4-pro · 0.9¢"), with the report link when done;
- confirm cards for every write, with the exact diff or the exact row;
- recovery path first: every error state names the next action ("Paste the text instead", "Try again with the fallback model") — the DB checklist's *build the recovery path before the happy path*;
- messages under ~60 words unless the user asked for the long form;
- accessibility: WCAG 2.2 AA as on the site; the streaming region is `aria-live="polite"` updated at most every 500 ms; focus moves to a confirm card when it appears and back to the input when it resolves; the drop zone is a labelled button first and a drop target second; 24×24 targets minimum, 40 px on the primary controls.

---

## 5. Models — research, decision, economics

### 5.1 Method

Live OpenRouter list (`/api/v1/models`, 428 models, 2026-09-08) filtered to tool-calling models with structured output; per-model endpoint pools (`/models/{id}/endpoints`) for provider breadth and uptime; the three published comparisons found (Lushbinary May 2026, Interconnects #21, Spheron's BFCL/τ-bench guide); and the project's own `docs/RUNNING_ON_A_BUDGET.md` recommendations. Public leaderboards shortlist; §4.3 decides.

### 5.2 The candidates (VERIFIED, OpenRouter list price per 1M tokens)

| Model | In | Out | Cache read | Ctx | Endpoints | Notes |
|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash | 0.03 | 0.13 | 0.006 | 1M | 1 (Alibaba) | cheapest viable; single provider — no failover under it |
| deepseek/deepseek-v4-flash | 0.089 | 0.177 | 0.018 | 1M | 15 | "cheapest viable agentic" in two sources; 0.1× cache reads |
| z-ai/glm-5.3-flash | 0.075 | 0.25 | 0.015 | 1.3M | 25 | widest provider pool of any candidate; GLM lineage led BFCL v3 (77.8 %) |
| qwen/qwen3.8-flash | 0.15 | 0.47 | 0.016 | 1M | 1 (Alibaba) | single provider |
| qwen/qwen3.7-plus | 0.32 | 1.28 | 0.064 | 1M | 1 (Alibaba) | best first-attempt tool-format rate in the one head-to-head found (94 % vs 87 % DeepSeek V4 Pro, 91 % GLM 5.1) |
| google/gemini-3.8-flash | 0.75 | 3.75 | 0.075 | 1M | 2 (Google) | boring, 99.5–99.9 % uptime; the floor |
| deepseek/deepseek-v4-pro | 0.955 | 1.911 | 0.08 | 1M | 16 | cheapest pro-class model on the list by a wide margin; MCPMark 32.1, SWE-Pro ~52 % |
| moonshotai/kimi-k2.6 | 0.95 | 4.00 | 0.16 | 262K | 21 | strongest writer of the open set (SWE-Pro 58.6 %, MCPMark 34.5); expensive output |
| z-ai/glm-5.3 | 1.40 | 4.40 | 0.26 | 1.3M | — | pro-class alternative; pricier than V4 Pro everywhere |
| anthropic/claude-haiku-4.5 | 1.00 | 5.00 | 0.10 | 200K | — | 10× the input price of V4 Flash for the same class |
| anthropic/claude-sonnet-5 | 2.00 | 10.00 | 0.20 | 1M | — | quality ceiling; 2× V4 Pro in, 5× out |

Not chosen and why: **GPT-5.6 Luna** (0.20/1.20) has no cache-read discount published on the list and a 128K output cap; **MiniMax M3** (0.30/1.20) has no comparative agentic data; **Gemini 3.5 Flash-Lite** (0.30/2.50) is pricier than V4 Flash with no quality signal above it; the `:free` variants (16) are rate-limited to 20 rpm and unsuitable for a paid product.

### 5.3 DECISION — `HOSTED_ROUTES` (applied in `lib/llm-providers.mjs`)

| Workload | Primary | Fallback 1 | Floor | Why this shape |
|---|---|---|---|---|
| `chat` | z-ai/glm-5.3-flash | deepseek/deepseek-v4-flash | google/gemini-3.8-flash | Frequent and short. GLM Flash first for the 25-provider pool (it survives `data_collection: deny` filtering with providers to spare) and the tool-calling lineage; V4 Flash is a different vendor at the same class; Gemini is the floor. |
| `ingest` | deepseek/deepseek-v4-flash | z-ai/glm-5.3-flash | google/gemini-3.8-flash | "Invent nothing" work; the cheaper output rate of V4 Flash matters because the proposal is long. |
| `evaluate` | deepseek/deepseek-v4-pro | qwen/qwen3.7-plus | google/gemini-3.8-flash | **The product.** A wrong verdict costs the user an evening; V4 Pro is the cheapest pro-class model and its 0.1× cache read makes the 12K static prefix nearly free. Qwen 3.7 Plus is a different vendor with the best measured format reliability, at a third of the price. |
| `write` | deepseek/deepseek-v4-pro | moonshotai/kimi-k2.6 | google/gemini-3.8-flash | Tailoring and cover letters need a writer; Kimi is the writing-quality alternative when V4 Pro is down. |

Three rules the chain encodes: (1) the fallback is always a different vendor, so a vendor outage is survivable; (2) the floor is boring and reliable rather than cheap; (3) a single-provider model is never a primary (Qwen sits second, where an Alibaba outage only removes the middle rung).

**Fallback mechanics.** OpenRouter's `models` array is tried in order on downtime, rate limiting, context-length errors and moderation flags; the response's `model` field names who answered and the bill follows it. `routingFields()` emits `models` only on OpenRouter and the primary alone on any other host. OpenRouter's fallback does **not** fire on a bad answer, so the app adds one application-level retry: if `openai-eval.mjs` cannot parse `---SCORE_SUMMARY---`, the run is repeated once with the chain rotated. Provider-level failover within a model is automatic and needs nothing.

**Privacy routing.** `OPENROUTER_DATA_COLLECTION=deny` is set for the hosted tier; `require_parameters: true` rides along so a provider that silently drops `tools` is never chosen. VERIFIED: the provider pools above are before that filter; the plan's first build task is a probe script that prints the post-filter pool per model, and a model whose pool drops below three providers loses its primary slot. UNKNOWN: the list of vendors that then remain, which is the processor list `/privacy` needs (brief §7 Q11, updated).

**Caching.** DeepSeek, Z.ai, Moonshot and Gemini cache automatically on OpenRouter; Qwen needs the explicit `cache_control` breakpoint that `buildSystemMessage()` in `openai-eval.mjs` already sends to every non-OpenAI host. The system prompt keeps the static prefix (shared + oferta + cv) first and the JD last, which is already how `buildBudgetedPrompt()` orders it.

### 5.4 Unit economics (INFERENCE from list prices; tokens from `docs/RUNNING_ON_A_BUDGET.md` §7)

| Operation | Tokens (in / out) | Model | Cost, cached prefix | Cost, cold |
|---|---|---|---|---|
| Evaluation | 15K (12K cached) / 2.5K | V4 Pro | ≈ $0.009 | ≈ $0.019 |
| Chat turn | 6K / 0.3K | GLM 5.3 Flash | ≈ $0.0005 | — |
| CV ingest | 8K / 2K | V4 Flash | ≈ $0.001 | — |
| CV tailoring | 15K / 4K | V4 Pro | ≈ $0.022 | — |

A heavy ninety-day user — 300 evaluations, 600 chat turns, 60 tailored CVs, a few ingests — costs **≈ $5–8 in model spend**, i.e. 6–10 % of the €79 pass. The merchant-of-record fee is another ≈ €4.50. Hosting and the Playwright box are the real fixed cost, not tokens. This is why the evaluate route can afford a pro-class model: the product is the judgment, and the judgment is cheap.

---

## 6. Security and privacy

- **The JD is data.** Every mode already says so; the runner enforces it structurally: the JD arrives as a user-turn string, never as a tool result the model could mistake for a system instruction, and the agent that reads hostile text has no write tools (§2.3). The evaluation path has no agent at all.
- **Path confinement** in `Read`/`Write`/`Edit`: `realpath` under the workspace, user-layer only for writes, a denylist for `.workler/` and `node_modules`. Tested with an escape attempt *and* a legitimate read in the same test (AGENTS.md rule 1).
- **No ambient authority.** Scripts run with a minimal env: the hosted key, `OPENROUTER_DATA_COLLECTION=deny`, `PLAYWRIGHT_BROWSERS_PATH`, nothing else. No `HOME`, no user shell.
- **Isolation, phase 1:** one OS user per workspace tree, `cwd` pinned, 5-minute script timeout, concurrent-runs cap of 2 per tenant. **Phase 2:** the network-touching scripts (`scan`, `check-liveness`, apply's Playwright session) move to a per-job container. `// ponytail: phase 1 is a process boundary, not a kernel one; upgrade before the first tenant who is not a friend.`
- **PII lifecycle.** Uploads are deleted after extraction unless kept on request. The workspace is the user's data in the exact layout the free CLI reads — **export is a zip of the workspace, and it runs offline in Workler CLI unchanged.** That portability is the strongest privacy claim the product can make, and it falls out of the architecture. Deletion: a button, no chat needed, effective immediately, workspace removed; retention after pass expiry is UNKNOWN (brief §7 Q11) and defaults to 30 days in this plan.
- **Processors** (for `/privacy`): OpenRouter (US), the model vendors behind the chain after the `deny` filter, the merchant of record, the email sender for magic links, the host. Every one must be named; brief §7 Q11 carries this.
- **Never submits** stays a code invariant (`submit-guard.ts`), and the hosted apply flow (§9 phase 4) inherits it unchanged.

---

## 7. Account, pass, budget

- **No passwords.** Merchant-of-record webhook (`order.completed`) → create user + pass (`expires_at = now + 90d`) → magic link by email. Session = signed cookie, 30 days, revocable.
- **Storage:** one `node:sqlite` file (stdlib in Node 24, `ExperimentalWarning` but stable API): `users`, `passes`, `sessions`, `usage` (tokens and cost per user per day), `events` (webhook log, append-only). No ORM. `// ponytail: node:sqlite single file; move to Postgres when there are two app boxes.`
- **Budget as an invariant.** A pass carries a token budget (DECISION default: 6M tokens ≈ $12 at pro-class rates, roughly twice the heavy-user profile in §5.4). Usage is accounted in exactly one place — the runner's final `result` line and the two scripts' `TokenAccumulator` — and enforced in one place, before spawn. At 80 % the chat says so; at 100 % spending actions refuse with the figure and the reset date. UNKNOWN: whether the founder wants a fair-use cap stated on `/pricing` (it should be; a hidden cap is the kind of surprise the site promises not to have).
- **Expiry.** At day 90 the session keeps working for reading and export; spending actions refuse and link to a new pass. No renewal, no stored card, exactly as `/pricing` says.

---

## 8. Paradigms and patterns, named and mapped

| Pattern | Where it already is | Where this plan uses it |
|---|---|---|
| **Ports and adapters** | `CliSpec` (`web/src/lib/clis.ts`) is a port with seven adapters | `agent-runner.mjs` is the eighth adapter; no route changes |
| **Single source of truth** | `lib/llm-providers.mjs`, `DATA_CONTRACT.md`, `templates/states.yml` | `HOSTED_ROUTES`; the provisioner reads the contract; the greeting reads the registry |
| **Command + registry** | `actions/registry.ts` — UI and agent dispatch the same entries | unchanged; the budget check is one more gate in `dispatch()` |
| **Propose, then confirm** | CV ingest, `setProfile`, `setStatus` | every hosted write, including the CV; no exceptions for the agent |
| **Strategy** | modes are prompt strategies selected by name | the runner loads `modes/{name}.md` the same way the CLIs do |
| **Chain of responsibility** | free-model rotation in `openrouter-runner.mjs` | `models` fallback chain; app-level retry on unparseable output |
| **Capability-based security** | `--allowedTools` / `--disallowedTools` per route | the runner's tool set is the capability list; no shell exists to escalate through |
| **Pipes and filters** | `buildBudgetedPrompt()` | CV ingest: extract → normalise → propose → confirm → write |
| **Append-only logs** | `status-log.tsv`, `salary-observations.tsv`, `.jobber-web/runs/*.md` | chat transcripts (`.jsonl`), `usage`, webhook `events` |
| **Immutable system / mutable user** | the data contract | hardlinked read-only system layer per workspace |
| **Idempotent provisioning** | `doctor.mjs` auto-copies templates | `provision-workspace.mjs` re-runs safely on every deploy |
| **One writer per file** | `merge-tracker.mjs`, `set-status.mjs`, `lib/file-lock.mjs` | unchanged; hosted concurrency cap of 2 runs per tenant keeps the lock contention trivial |

Things deliberately **not** introduced: an ORM, a queue system, a vector store, a second frontend framework, a plugin system for tools, structured-output envelopes, a microservice. Each would be a solution to a problem the first hundred users will not have.

---

## 9. Phases

Each phase ends with its tests green in `test-all.mjs` (discovered `tests/**/*.test.mjs`, house rules in `AGENTS.md` → Writing Assertions) and nothing user-facing shipped before its gate.

| # | Phase | Deliverables | Gate |
|---|---|---|---|
| 0 | **Routes in code** (done 2026-09-08) | `HOSTED_ROUTES`, `routingFields()`, `OPENROUTER_DATA_COLLECTION`, RATES, both runners honour a chain, tests | `tests/llm-providers.test.mjs` green |
| 1 | **Runner** (done 2026-09-08) | `agent-runner.mjs`: OpenRouter tool loop, Claude-shaped NDJSON out, tool set of §2.3 (`lib/hosted-capabilities.mjs`), usage accounting; `probe-providers.mjs` (raw provider pools — see its file header for what it can and can't verify about the `deny` filter) | fallback test: mocked 429 on primary → second answers, *and* 200 on primary → primary answers; path-escape refused *and* legit read succeeds; a hostile-JD prompt produces no write — all in `tests/agent-runner.test.mjs` |
| 2 | **Tenancy** (done 2026-09-08) | `provision-workspace.mjs` from the contract (`update-system.mjs`'s `SYSTEM_PATHS`/`USER_PATHS`, exported, not restated); `jobberRoot()` via `AsyncLocalStorage` (`withWorkspaceRoot()`); `KNOWN` gets `workler`, gated on `HOSTED=1`; `/api/run` hosted branch → `openai-eval.mjs` for evaluate, `openai-tailor.mjs` + `generate-pdf.mjs` + `sync-pdf-flags.mjs` for pdf | two workspaces cannot read each other's `cv.md` (positive read in own, refused read across) — `tests/provision-workspace.test.mjs`; the hosted evaluate branch spawns the identical `openai-eval.mjs` the CLI path uses with the identical routing, not a reimplementation — `web/test-hosted-run.mjs` (a live end-to-end run needs `OPENROUTER_API_KEY` and is exercised manually, not in CI) |
| 3 | **Upload + chat + skin** | `.docx` via `mammoth`; extractor before the LLM; transcript log; model + cost on each message; tokens skin; capability greeting from the registry | §4.3 model gate ≥ 22/24 for every `chat` model; axe WCAG 2.2 AA clean; the streaming live region announces without flooding |
| 4 | **Account + pass** | webhook, magic link, `node:sqlite`, budget gate, export zip, delete button, expiry behaviour | webhook replay is idempotent; budget refusal at 100 % with control at 99 %; export re-imports into a fresh CLI checkout and `doctor.mjs` reports ready |
| 5 | **Apply on hosted** | Playwright session per job in a container; the existing drive loop; screenshots streamed to the card | `web/test-submit-guard.mjs` green in the hosted build; a form with an icon-only submit is not clicked |
| 6 | **Launch gate** | processors named on `/privacy`; `/pricing` buy link live; `--strict` site build green | brief §1 launch-with-purchase; nothing here overrides the site's blockers |

Phase 5 can ship after launch: the pricing page's "does not include" list already says the product drafts and the user sends, and drafting form answers (`openrouter-runner.mjs apply`) exists without a browser.

---

## 10. Open questions for the founder (UNKNOWN)

1. Fair-use token budget per pass, and whether it is stated on `/pricing` (this plan: 6M tokens, stated).
2. Retention after expiry (this plan: 30 days) — also brief §7 Q11.
3. Whether the hosted tier keeps *recommend against below 4.0* (brief §7 Q5). This plan assumes yes; it is belief 2 on the site and the reason the evaluate route gets a pro-class model.
4. Hosting region for the app box and the Playwright box (brief §7 Q7). EU assumed.
5. Whether uploaded originals may be kept by default (this plan: no, opt-in).

---

## 11. Sources

- OpenRouter live model list and per-model endpoints, `https://openrouter.ai/api/v1/models` and `/models/{id}/endpoints`, fetched 2026-09-08.
- OpenRouter docs: [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [privacy and logging](https://openrouter.ai/docs/features/privacy-and-logging).
- Comparisons: [Lushbinary, open-source LLMs for agents, May 2026](https://lushbinary.com/blog/best-open-source-llms-ai-agents-may-2026-comparison/); [Interconnects, open artifacts #21](https://www.interconnects.ai/p/latest-open-artifacts-21-open-model); [Spheron, BFCL v4 and τ-bench guide](https://www.spheron.network/blog/tool-calling-benchmarks-bfcl-tau-bench-latency-optimization/); [CloudZero, LLM API pricing 2026](https://www.cloudzero.com/blog/llm-api-pricing-comparison/); [OpenRouter, lowest-cost inference guide](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/).
- Chat UX: [Fuselab, agent UX 2026](https://fuselabcreative.com/ui-design-for-ai-agents/); [thefrontkit, AI chat UI practices](https://thefrontkit.com/blogs/ai-chat-ui-best-practices); [Jotform, chatbot design 2026](https://www.jotform.com/ai/agents/chatbot-design/).
- This checkout: `web/README.md`, `web/src/app/api/*/route.ts`, `web/src/app/actions/registry.ts`, `openai-eval.mjs`, `openai-tailor.mjs`, `lib/llm-providers.mjs`, `DATA_CONTRACT.md`, `docs/RUNNING_ON_A_BUDGET.md`.
