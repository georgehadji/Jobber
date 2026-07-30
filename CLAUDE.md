@AGENTS.md

<!-- Add Claude Code-specific guidance here only when it has no AGENTS.md counterpart. -->

## Developing career-ops itself

AGENTS.md above covers *using* career-ops as a job-search tool (modes, tracker, scan). This section covers *contributing to* the career-ops codebase (scripts, providers, modes-as-code).

### Commands

```bash
node doctor.mjs               # setup validation
node verify-pipeline.mjs      # tracker/data health check
node cv-sync-check.mjs        # config check

node test-all.mjs             # full suite (500+ checks) — run before every push/PR
node test-all.mjs --quick     # full suite, skips the dashboard build
node test-all.mjs --only providers/themuse   # one provider's test(s) only — dev convenience, NOT a PR gate

npm run build:dashboard       # build the Go dashboard TUI
npm run serve:dashboard       # run the dashboard TUI against the repo root
```

No linter/formatter is configured — match surrounding style by hand. There is no single-test-file runner beyond `--only`; tests live at `tests/**/*.test.mjs` and `*.test.mjs` next to the script they cover, auto-discovered by `test-all.mjs` (no registration needed for new provider tests under `tests/providers/`).

### Architecture

Full architecture map: [ARCHITECTURE.md](ARCHITECTURE.md). Key points to internalize before editing:

- **System vs. user files** ([DATA_CONTRACT.md](DATA_CONTRACT.md)) — `modes/`, `*.mjs`, `templates/` are system layer (versioned, auto-updated); `cv.md`, `config/profile.yml`, `data/`, `reports/` are user layer (never touched by the updater). Getting this wrong breaks `update-system.mjs` for every user.
- **Files are canonical, SQLite is derived** — `data/applications.md` and `reports/*.md` are the permanent source of truth; never make the SQLite index a primary store.
- **Flat root is deliberate** — ~70 scripts live at repo root, each registered in `SYSTEM_PATHS` (CI-enforced coverage guard). Don't reorganize into subdirectories.
- **The "brain" is Markdown, not code** — evaluation logic lives in `modes/_shared.md` (scoring core) and `modes/oferta.md` (A–G blocks), read by whatever AI CLI is driving, not hardcoded in a script.

See [CONTRIBUTING.md](CONTRIBUTING.md) for PR conventions, scope rules (core vs. plugin), and what's out of bounds (no auto-submit, no scraping ToS-prohibited sites, no centralized infra in core).
