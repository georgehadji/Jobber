---
description: Write page copy into copy/<page>.md, constrained by the brief, message map, IA and query map. Use after architecture, before or alongside build.
argument-hint: [page-slug | all]
---

## Binding constraints
```!
cat "${CLAUDE_PROJECT_DIR}/spec/banlist.md" 2>/dev/null || true
```

Read all upstream artifacts. Write `copy/<page>.md` for: $ARGUMENTS

Per page, in this order:
- `<title>` (≤60 chars) and meta description (≤155), written as a promise not a summary.
- H1, then the answer block from `spec/query-map.md` §8.
- Section-by-section copy keyed to the message hierarchy. For each section state which
  belief it installs and which objection it kills. A section doing neither is cut.
- Every CTA: the label (a verb naming exactly what happens next), the friction-removing
  micro-copy under it, and what the visitor sees immediately after clicking.
- Alt text for every image slot, written for a screen reader user, not for keywords.
- Form fields, error, empty, success and confirmation states.

Rules: one idea per sentence; concrete nouns over category nouns; active voice; the button
that says "Publish" produces a toast that says "Published"; errors explain what happened
and how to fix it and do not apologise; specific beats clever. State the target reading
level at the top of each file.

Test every headline by swapping in a competitor's name. If it still reads true, rewrite it.

For the primary page produce two materially different directions (different lead,
different belief order) so they can be A/B tested, and say which you expect to win and on
what mechanism.
