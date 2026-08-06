# Jobber

One-command installer for [**Jobber**](https://github.com/santifer/jobber) — the AI-powered job search pipeline built on Claude Code.

```bash
npx @santifer/jobber init
```

This sets up a ready-to-use workspace:

1. Clones Jobber at the latest stable release
2. Installs dependencies

Then open your AI coding tool in the folder. **On first launch the agent walks you through setup — your CV, profile and target roles — just by chatting.** Nothing to configure by hand. Jobber is AI-agnostic — Claude Code, Gemini, Codex, Qwen, OpenCode, GitHub Copilot CLI, Antigravity CLI, and Grok Build CLI all work.

The installer bootstraps CLI skill entrypoints after clone, so new CLIs (e.g. Grok) work even when `npx` pulled an older release tag.

## Usage

```bash
npx @santifer/jobber init [folder]   # default folder: ./jobber
```

Prefer the manual route? `git clone` still works exactly as before — see the [setup guide](https://github.com/santifer/jobber/blob/main/docs/SETUP.md).

## Requirements

- Node.js 18+
- git

## License

MIT © [Santiago Fernández de Valderrama](https://santifer.io)
