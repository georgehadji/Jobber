<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="Jobber" width="250" height="56"></picture></p>

<p align="center">
  <strong>An AI job-search command center that runs inside your AI coding CLI.</strong><br>
  Evaluate offers against your real CV, generate ATS-tailored PDFs, scan portals, and track every application — locally, with you making the final call.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white" alt="Node.js >= 18">
  <img src="https://img.shields.io/badge/version-1.24.0-2ea44f" alt="Version 1.24.0">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Jobber demo" width="800">
</p>

---

## What it is

Jobber turns any agent-skill-compatible AI coding CLI into a job-search pipeline. Instead of tracking applications in a spreadsheet and rewriting your CV by hand, you get:

- **Structured evaluation** — every offer scored across weighted dimensions (blocks A–F), plus an independent **Block G posting-legitimacy check** that flags scams and ghost jobs without touching the 1–5 fit score.
- **Tailored CV and cover-letter PDFs** — ATS-oriented documents generated per job description from your own `cv.md`.
- **Zero-token portal scanning** — Greenhouse, Ashby, Lever, Workday, iCIMS and 70+ provider modules queried through public APIs and feeds, no LLM cost.
- **Batch processing** — evaluate many offers in parallel using headless CLI workers.
- **A single source of truth** — one Markdown tracker with automated merge, dedup, status normalization, and integrity checks.
- **Research, not just applications** — company deep-dives, contact discovery, and draft outreach.

> **This is a filter, not a spray-and-pray applier.** Jobber exists to find the few roles worth your time out of hundreds. It recommends against applying below 4.0/5, and it **never** submits, sends, or clicks anything — you always review and decide.

> **The first evaluations will be mediocre, and that's expected.** The system doesn't know you yet. Feed it your CV, your proof points, your preferences, what you want to avoid. Quality compounds as you give it context.

## Requirements

- **Node.js ≥ 18** ([nodejs.org](https://nodejs.org))
- **An AI coding CLI** — Claude Code, Codex, OpenCode, Antigravity, Grok, Qwen, Kimi, or Copilot. See [Supported CLIs](docs/SUPPORTED_CLIS.md).
- **Chromium via Playwright** — only for PDF generation and liveness verification.
- *Optional:* Go toolchain, to build the dashboard TUI binary.

## Quick start

```bash
git clone https://github.com/georgehadji/Jobber.git
cd Jobber
npm install
npx playwright install chromium
```

Verify prerequisites, then open your CLI in the project root:

```bash
npm run doctor
```

```bash
claude   # or: codex · opencode · agy · grok · qwen
```

On first launch Jobber detects an unconfigured install and walks you through setup conversationally — your CV, profile, and target roles. Nothing needs to be edited by hand.

<details>
<summary><b>Manual configuration</b></summary>

```bash
cp config/profile.example.yml config/profile.yml   # your profile
cp templates/portals.example.yml portals.yml       # companies + queries
# create cv.md in the project root — your CV in Markdown
```

Then ask your CLI to adapt the system to you in plain language:

```text
Change the archetypes to backend engineering roles
Add these 5 companies to portals.yml
Update my profile from the CV I'm pasting
```

</details>

## Usage

In CLIs that register slash commands:

```
/jobber                → list available commands
/jobber {paste a JD}   → full auto-pipeline (evaluate + PDF + tracker)
/jobber scan           → scan portals for new offers
/jobber pipeline       → process pending URLs
/jobber pdf            → generate an ATS-optimized CV
/jobber cover          → generate a cover letter
/jobber email          → draft a formal application email (draft-only)
/jobber batch          → batch-evaluate multiple offers
/jobber tracker        → view application status
/jobber apply          → assisted application-form filling
/jobber contacto       → find the right contact + draft outreach
/jobber deep           → structured 6-axis company research
/jobber triage         → fast first-pass filter before a full evaluation
/jobber followup       → follow-up cadence and seeded reminders
/jobber reply-watch    → classify employer replies into tracker updates
/jobber interview      → prep plans, practice sessions, and debriefs
/jobber offer-prep     → clause walk on an offer + salary-gap analysis
/jobber patterns       → rejection patterns and targeting analysis
/jobber outcome        → record an outcome and archive artifacts
```

Or paste a job URL or description directly — Jobber detects it and runs the pipeline.

**Codex** does not guarantee slash commands. Ask for modes by name instead:

```bash
codex exec "Evaluate this JD with Jobber auto-pipeline: https://company.com/jobs/123"
codex exec "Run Jobber scan mode and summarize new matches."
```

See [docs/CODEX.md](docs/CODEX.md) for the full guide.

## How it works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies the role against your target archetypes
│  detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A–G evaluation  │  Match, gaps, comp research, STAR stories, legitimacy
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf  entry
```

Evaluation is reasoning-based, not keyword matching: the agent reads your CV against the job description. **Keywords get reformulated, never fabricated** — nothing enters your CV or a cover letter that isn't backed by a file you control.

## Features

| Feature | Description |
| --- | --- |
| **Auto-pipeline** | Paste a URL → evaluation, PDF, and tracker entry in one pass |
| **A–G evaluation** | Role summary, CV match, level strategy, comp research, personalization, STAR+R interview prep, plus posting-legitimacy and work-authorization signals |
| **Portal scanner** | 100+ pre-configured companies and 45+ queries across Ashby, Greenhouse, Lever, Workday, iCIMS and more — zero LLM cost |
| **Reverse-ATS scan** | Keyword-first sweep over full public ATS datasets, no company list required, resumable via checkpoints |
| **Batch processing** | Parallel evaluation with headless CLI workers, rate-limit-aware and resumable |
| **ATS PDF generation** | Keyword-aligned CVs via HTML + Playwright; LaTeX/Overleaf path also supported |
| **Cover letters & emails** | Research-backed drafts with an approval gate — never sent automatically |
| **Interview suite** | Time-blocked prep plans, practice sessions with feedback, post-interview debriefs, and a company red-flag detector |
| **Offer stage** | Contract clause walk with a lawyer question list, plus desired/advertised/actual salary-gap analysis |
| **Follow-ups & replies** | Cadence calculator, seeded reminders, and employer-reply classification into tracker updates |
| **Pattern analysis** | Rejection patterns, per-ATS advance rates, lifetime funnel stats, repost/ghost-job detection |
| **Dashboard TUI** | Go terminal UI to browse, filter, and sort your pipeline |
| **Plugin system** | Opt-in integrations, disabled by default — see [docs/PLUGINS.md](docs/PLUGINS.md) |
| **Pipeline integrity** | Automated merge, dedup, status normalization, and health checks |
| **Human-in-the-loop** | The AI evaluates and drafts; you decide and act. It never submits |

## Scanning

```bash
npm run scan                 # zero-token discovery across configured portals
node scan.mjs --verify       # + Playwright liveness check, drops expired postings
npm run scan:full            # reverse-ATS keyword sweep, no company list needed
```

By default the scanner trusts what each ATS feed returns. Some companies leave closed roles in their public API, so `--verify` runs Playwright against new offers only (after dedup) to keep the cost bounded.

Full board coverage: [docs/SUPPORTED_JOB_BOARDS.md](docs/SUPPORTED_JOB_BOARDS.md).

## Dashboard

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional standalone binary
```

Nine filter tabs, seven sort modes, a toggleable column picker, grouped/flat views, lazy previews, and inline status changes. An experimental opt-in web UI lives in [`web/`](web/README.md) — nothing runs unless you start it.

## Project structure

```
Jobber/
├── AGENTS.md              # canonical agent instructions (all CLIs)
├── CLAUDE.md · CODEX.md   # thin per-CLI wrappers importing AGENTS.md
├── cv.md                  # your CV (you create this)
├── config/profile.yml     # your profile
├── portals.yml            # scanner configuration
├── modes/                 # skill modes — the prompt layer
│   ├── _shared.md         # shared system context
│   ├── _profile.md        # your personalization (never auto-updated)
│   └── oferta.md · pdf.md · scan.md · batch.md · ...
├── templates/             # CV templates, portals example, canonical states
├── lib/ · providers/      # shared modules and ATS provider adapters
├── batch/                 # batch worker prompt + orchestrator
├── dashboard/             # Go TUI
├── tests/                 # auto-discovered test suites
├── data/ reports/ output/ # your data (gitignored)
└── docs/                  # setup, architecture, budget, automation guides
```

### Data contract

Jobber separates two layers, and the distinction matters:

- **User layer** — `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `portals.yml`, `data/`, `reports/`, `output/`. **Never auto-updated.** Your personalization lives here.
- **System layer** — `modes/_shared.md`, `AGENTS.md`, the `.mjs` scripts, `dashboard/`, `templates/`. **Auto-updatable.** Never put personal data here.

Updates replace the system layer and leave the user layer untouched. Full rules: [DATA_CONTRACT.md](DATA_CONTRACT.md).

## Testing

```bash
npm test                      # per-file runner (serial; --parallel N for workers)
node test-all.mjs             # full canonical suite
node test-all.mjs --quick     # skip the dashboard build
node verify-pipeline.mjs      # tracker/report integrity health check
```

Test files in `tests/**/*.test.mjs` are auto-discovered — add a file, no registration needed.

## Configuration

| Want to change | Edit |
| --- | --- |
| Target roles, archetypes, narrative | `modes/_profile.md` or `config/profile.yml` |
| House rules, workflows, output preferences | `modes/_custom.md` |
| Companies and search queries | `portals.yml` |
| CV design | `templates/cv-template.html` / `.tex` |
| Output language / market vocabulary | `language.output` and `language.modes_dir` in `config/profile.yml` |

Market-specific mode sets ship for 18 job markets — Arabic, Chinese (Simplified and Traditional), Danish, Dutch, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Turkish, and Ukrainian — each with local employment vocabulary. Output language and market vocabulary are independent axes.

**The system is designed to be edited by your AI CLI itself.** Ask it to change scoring weights, add companies, or rewrite a mode — it reads the same files it runs on.

More: [docs/SETUP.md](docs/SETUP.md) · [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) · [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) · [docs/AUTOMATION.md](docs/AUTOMATION.md) · [docs/FAQ.md](docs/FAQ.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

## Tech stack

- **Runtime** — Node.js ESM (`.mjs`), four production dependencies by design
- **Browser automation** — Playwright (PDF rendering, liveness checks, extraction)
- **Dashboard** — Go + Bubble Tea + Lipgloss
- **Data** — Markdown tables, YAML config, TSV logs. No database, no server.
- **Agent layer** — Markdown modes loaded by any agent-skill-standard CLI

## Contributing

Issue first, then discussion, then a PR linked to it. CI runs the full suite on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## Disclaimer

**Jobber is a local, open-source tool, not a hosted service.** By using it you acknowledge:

1. **You control your data.** Your CV and personal information stay on your machine and go only to the AI provider you choose. Nothing is collected or transmitted to this project.
2. **You control the AI.** Default prompts instruct the agent never to auto-submit. Models can still behave unpredictably — always review generated content before sending it anywhere.
3. **You comply with third-party terms.** Use this in accordance with the ToS of every career portal you touch. Do not spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. Models can hallucinate. The authors are not liable for employment outcomes or any other consequences.

Full text: [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md).

## Credits & license

Code is licensed under the [MIT License](LICENSE). The "Jobber" name and brand are governed by the [Trademark Policy](TRADEMARK.md).
