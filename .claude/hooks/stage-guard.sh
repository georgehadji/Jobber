#!/usr/bin/env bash
# PreToolUse on Write|Edit. Exit 2 blocks the call and shows stderr to Claude.
# Enforces: no source code before the visual system is locked.
set -uo pipefail
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

case "$FILE" in
  */src/*|*/app/*|*/components/*)
    if [ ! -s "spec/art-direction.md" ] \
       || grep -q 'Not written yet' "spec/art-direction.md" 2>/dev/null \
       || ! grep -q '[^[:space:]]' "src/styles/tokens.css" 2>/dev/null; then
      echo "BLOCKED: spec/art-direction.md and src/styles/tokens.css must exist and be non-empty before writing $FILE. Run /art-direction first." >&2
      exit 2
    fi
    ;;
esac
exit 0
