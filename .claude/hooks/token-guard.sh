#!/usr/bin/env bash
# PostToolUse on Write|Edit. Observability only: stderr is shown to Claude, which will fix.
# Flags raw design values that bypassed tokens.css.
set -uo pipefail
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

[ -f "$FILE" ] || exit 0
case "$FILE" in
  *tokens.css) exit 0 ;;
  *.css|*.tsx|*.jsx|*.astro|*.vue|*.svelte) ;;
  *) exit 0 ;;
esac

HITS="$(grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|[0-9]+px' "$FILE" | grep -vE '1px|0px|var\(--' | head -20 || true)"
if [ -n "$HITS" ]; then
  {
    echo "TOKEN DRIFT in $FILE — raw design values found. Replace with var(--…) from src/styles/tokens.css:"
    echo "$HITS"
  } >&2
fi
exit 0
