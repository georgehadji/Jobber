#!/usr/bin/env bash
# Fails when component source carries raw design values instead of tokens.
set -uo pipefail
STATUS=0
# .html is in the list because this project's components ARE .html; without it a raw
# hex colour in a page file shipped undetected (see spec/qa-report.md C2).
FILES="$(find src app components -type f \( -name '*.css' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.astro' -o -name '*.vue' -o -name '*.svelte' -o -name '*.html' \) 2>/dev/null | grep -v 'tokens.css' || true)"
[ -z "$FILES" ] && { echo "check-tokens: no source files yet"; exit 0; }
for f in $FILES; do
  # The leading (^|[^&]) keeps numeric HTML entities out of the results: &#305; in
  # "kıdem tazminatı" matched the bare hex pattern and reported clean markup as drift.
  HITS="$(grep -nE '(^|[^&])#[0-9a-fA-F]{3,8}\b|rgba?\(' "$f" | grep -v 'var(--' || true)"
  if [ -n "$HITS" ]; then echo "TOKEN DRIFT $f"; echo "$HITS"; STATUS=1; fi
done
exit $STATUS
