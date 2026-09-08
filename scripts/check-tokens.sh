#!/usr/bin/env bash
# Fails when component source carries a raw design value instead of a token.
set -uo pipefail
STATUS=0

# ── Self-test: each pattern below must fail on a fixture built to trip it, or the
# pattern is not a gate (plan §5 item 8: "proven against a one-line fixture that must
# fail"). Runs before the real scan, on every invocation — cheap, and it is the only way
# a silently-broken regex would ever be noticed.
SELFTEST_DIR="$(mktemp -d)"
trap 'rm -rf "$SELFTEST_DIR"' EXIT
printf '.a { color: #fff; }\n'                        > "$SELFTEST_DIR/hex.css"
printf '.a { background: rgba(0,0,0,.5); }\n'          > "$SELFTEST_DIR/rgba.css"
printf '.a { box-shadow: 0 1px 2px black; }\n'         > "$SELFTEST_DIR/shadow.css"
printf '.a { border-radius: 4px; }\n'                  > "$SELFTEST_DIR/radius.css"
printf '.a { transition: opacity .1s cubic-bezier(.2,0,0,1); }\n' > "$SELFTEST_DIR/bezier.css"
printf '.a { transition-duration: 150ms; }\n'          > "$SELFTEST_DIR/ms.css"
# A clean fixture, entirely token-driven — must NOT be flagged by any pattern, or a
# pattern is too broad and would fail every real component file.
printf '.a { color: var(--color-text); box-shadow: var(--elevation-1); border-radius: var(--shape-md); transition: opacity var(--duration-short-2) var(--ease-standard); }\n' > "$SELFTEST_DIR/clean.css"

scan_file() {
  # $1 = file to scan. Echoes any hits; caller decides pass/fail.
  # The ms/duration pattern anchors on a preceding ":\s*" (an actual declaration, e.g.
  # "transition-duration: 150ms") rather than a bare "[0-9]+ms\b" — the latter also
  # matched this script's own doc comments ("...at medium-4 (400ms)"). A raw ms value
  # buried mid-shorthand after other tokens, not right after the colon, still evades
  # this — same limitation as any static pattern list (AGENTS.md "Writing Assertions").
  grep -nE \
    '(^|[^&])#[0-9a-fA-F]{3,8}\b|rgba?\(|box-shadow:\s*[0-9a-zA-Z]|border-radius:\s*[0-9]|cubic-bezier\(|:\s*[0-9][0-9.]*ms\b' \
    "$1" | grep -v 'var(--' || true
}

for pair in hex rgba shadow radius bezier ms; do
  HITS="$(scan_file "$SELFTEST_DIR/$pair.css")"
  if [ -z "$HITS" ]; then
    echo "check-tokens SELF-TEST FAILED: $pair.css fixture was not flagged — a pattern is broken."
    exit 1
  fi
done
CLEAN_HITS="$(scan_file "$SELFTEST_DIR/clean.css")"
if [ -n "$CLEAN_HITS" ]; then
  echo "check-tokens SELF-TEST FAILED: an all-token fixture was flagged — a pattern is too broad."
  echo "$CLEAN_HITS"
  exit 1
fi

# ── Real scan ─────────────────────────────────────────────────────────────────
# .html is in the list because this project's components ARE .html; without it a raw
# hex colour in a page file shipped undetected (see spec/qa-report.md C2).
FILES="$(find src app components -type f \( -name '*.css' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.astro' -o -name '*.vue' -o -name '*.svelte' -o -name '*.html' \) 2>/dev/null | grep -v 'tokens.css' || true)"
[ -z "$FILES" ] && { echo "check-tokens: no source files yet"; exit 0; }
for f in $FILES; do
  # The leading (^|[^&]) keeps numeric HTML entities out of the results: &#305; in
  # "kıdem tazminatı" matched the bare hex pattern and reported clean markup as drift.
  HITS="$(scan_file "$f")"
  if [ -n "$HITS" ]; then echo "TOKEN DRIFT $f"; echo "$HITS"; STATUS=1; fi
done
exit $STATUS
