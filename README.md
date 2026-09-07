# Web studio site template

Stage-gated website production for Claude Code. `CLAUDE.md` holds the rules,
`.claude/skills/` holds the eight pipeline stages, `.claude/hooks/` enforces the two
rules that must not be negotiable, and `spec/` is the memory that keeps every page
consistent with every other page.

## Start a project
1. Create a repo from this template.
2. Drop 3–5 design references into `spec/references/`.
3. `claude`
4. `/intake` with the raw client material, then walk the pipeline in order.
   The SessionStart hook tells you which stage is next.

## The gates
- `stage-guard.sh` blocks writes to `src/` until the visual system is locked.
- `token-guard.sh` reports raw colour and spacing values back to Claude on every edit.
- CI fails on token drift, accessibility violations, performance budgets, and missing JSON-LD.

Instructions in `CLAUDE.md` are followed most of the time. Hooks and CI are followed
every time. Anything that must not happen belongs in the second category.
