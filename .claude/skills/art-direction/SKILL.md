---
description: Lock the visual system into spec/art-direction.md and src/styles/tokens.css. Use before any component or page is built. This is the stage that decides whether the site reads as machine-generated.
model: inherit
effort: high
---

## Binding constraints
```!
cat "${CLAUDE_PROJECT_DIR}/spec/banlist.md" 2>/dev/null || true
```

## References supplied for this project
```!
ls -1 "${CLAUDE_PROJECT_DIR}/spec/references" 2>/dev/null || true
```

If the references directory holds nothing but the README, say so and ask for 3–5
references before proposing anything. Do not substitute adjectives for references.

## Task
Read `spec/brief.md` and `spec/message-map.md`. Work in two passes and show me both.

**Pass 1 — three materially different directions.** Not three palettes of one idea:
three different arguments about what this business is. Each direction gives:
- Thesis in one sentence, traced to something concrete in brief §5 SUBJECT MATERIAL.
- Palette: 5–6 named values in OKLCH, with the reasoning for the hue family and a stated
  contrast strategy. No gradient as the primary identity device.
- Typography: named real typefaces for display / body / utility, with licence status and
  self-hosted file sizes. Type scale with an explicit ratio, and where it breaks on purpose.
- Layout system: grid, asymmetry rule, density rule, ASCII wireframe of the hero and one
  interior section.
- SIGNATURE: the single element this site is remembered by. One only.
- The one real aesthetic risk taken, and the argument for it.

**Pass 2 — self-critique before I choose.** For each direction answer honestly: if this
brief went to ten other studios using AI tools, how many arrive here? Anything above
2/10 gets revised, and you state what changed and why.

## Output
- `spec/art-direction.md` — the chosen direction, in full, including the rejected two and
  why they lost.
- `src/styles/tokens.css` — CSS custom properties only: colour, type scale, spacing scale,
  radius, shadow, motion duration and easing, container widths, breakpoints. Every later
  stage consumes these and may not introduce a raw value.

ultrathink
