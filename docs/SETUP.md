# Setup Guide

## Prerequisites

- An AI coding CLI — [Claude Code](https://claude.ai/code), Gemini CLI, Codex, Qwen Code, OpenCode, GitHub Copilot CLI, Antigravity CLI, or Grok Build CLI (see [Supported CLIs](SUPPORTED_CLIS.md))
- [Node.js](https://nodejs.org) 18+ and `git` (`npx` ships with Node — the installer refuses to run without them) — note: the Gemini CLI integration requires Node.js 20+
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start

### Recommended — one command

```bash
npx @santifer/jobber init
```

`npx` ships with Node.js — it runs the installer once without installing anything globally. This clones the latest release into `./jobber` and installs dependencies. Then move into the workspace and open your AI CLI:

```bash
cd Jobber
claude   # or codex / qwen / opencode / agy / grok
```

**On first launch, Jobber walks you through setup by chatting** — it asks for your CV, your details (name, target roles, salary), and sets up the job scanner with pre-configured companies. Nothing to edit by hand: just answer its questions. Then paste a job offer URL or description and it evaluates it, writes a report, generates a tailored PDF, and tracks it.

If you are using Codex, start the interactive session with `codex`. Slash commands are not guaranteed in Codex, so use the same mode names in a prompt if `/jobber` is unavailable:

```text
Evaluate this JD with Jobber auto-pipeline: https://company.com/jobs/123
Run the Jobber scan mode.
Run the Jobber pipeline mode.
Run the Jobber pdf mode.
Run the Jobber email mode for the latest evaluated role. Draft only; never sends, submits, or clicks.
Run the Jobber tracker mode.
```

For one-shot workers or batch tasks in Codex, use `codex exec`. See [docs/CODEX.md](CODEX.md) for the full guide.

```bash
codex exec "Evaluate this JD with Jobber auto-pipeline: https://company.com/jobs/123"
codex exec "Run Jobber scan mode in this repo."
codex exec "Run Jobber pipeline mode for data/pipeline.md."
codex exec "Run Jobber pdf mode for the latest evaluated role."
codex exec "Run Jobber email mode for the latest evaluated role. Draft only; do not send, submit, or click anything."
codex exec "Run Jobber tracker mode and summarize the current statuses."
```

### Advanced — clone manually

<details>
<summary>Prefer to clone the repo yourself?</summary>

```bash
git clone https://github.com/santifer/jobber.git
cd Jobber
npm install
```

Then open your AI CLI in the folder — the same first-run onboarding applies. Use this path if you want to track a specific branch, contribute, or audit the code before installing dependencies.

</details>

### PDF rendering (one-time)

PDFs are rendered with a headless Chromium. Install it once per machine:

```bash
npx playwright install chromium
```

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/jobber scan` or ask the agent to run `scan` |
| Process pending URLs | `/jobber pipeline` or ask the agent to run `pipeline` |
| Generate a PDF | `/jobber pdf` or ask the agent to run `pdf` |
| Draft application email | `/jobber email` or ask the agent to run `email`; draft-only, never sends, submits, or clicks |
| Batch evaluate | `/jobber batch` or use `codex exec "Run Jobber batch mode ..."` |
| Check tracker status | `/jobber tracker` or ask the agent to run `tracker` |
| Fill application form | `/jobber apply` or ask the agent to run `apply` |

## Verify Setup

```bash
node cv-sync-check.mjs      # Check configuration
node verify-pipeline.mjs     # Check pipeline integrity
```

## Build Dashboard (Optional)

```bash
npm run serve:dashboard     # Opens TUI pipeline viewer
npm run build:dashboard     # Optional: build the standalone binary
```
