#!/usr/bin/env bash
# SessionStart. Plain stdout is injected into context, so this is the cheapest way to
# put pipeline state in front of the model on every session.
set -uo pipefail
echo "## Pipeline state"
for f in brief message-map art-direction ia query-map qa-report growth-plan; do
  p="spec/$f.md"
  if [ -s "$p" ] && grep -q 'Not written yet' "$p" 2>/dev/null; then
    echo "- $f: NOT WRITTEN"
  elif [ -s "$p" ]; then
    echo "- $f: written ($(wc -l < "$p" | tr -d ' ') lines)"
  else
    echo "- $f: NOT WRITTEN"
  fi
done
if [ -s "src/styles/tokens.css" ]; then echo "- tokens.css: present"; else echo "- tokens.css: MISSING — src/ is write-blocked"; fi
echo "Next stage is the first NOT WRITTEN artifact in that order."
