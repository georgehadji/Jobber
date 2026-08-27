// tests/latex-escape.test.mjs — lib/latex-escape.mjs
//
// The url-mode cases are a REGRESSION test. `escapeLatex(text, 'url')` used to
// `return text` untouched. No caller in the tree passed 'url' (every URL goes
// through sanitizeUrl directly), so it was dead code — but dead code shaped
// like a safety function, which is the dangerous kind: a future caller
// reaching for the mode named "url" would reasonably assume it sanitizes URLs,
// and instead get raw text straight into a `\href{}` argument. `\write18` is
// LaTeX's shell-execution primitive.
import { pass, fail } from './helpers.mjs';
import { escapeLatex, sanitizeUrl } from '../lib/latex-escape.mjs';

console.log('\nlib/latex-escape.mjs — LaTeX escaping and URL sanitization');

// Characters that let a string break out of a `\href{}`/macro argument or
// reach a shell: backslash (macro introducer, incl. \write18 and \input),
// braces (argument delimiters), % (comment — truncates the rest of the line),
// $ (math mode), # (parameter), ~ and ^ (active/superscript).
const DANGEROUS = ['\\', '{', '}', '%', '$', '#', '~', '^'];

try {
  // 1. REGRESSION: url mode sanitizes rather than passing input through raw.
  const shellEscape = 'https://x.com/\\write18{rm -rf /}';
  const urlModeResult = escapeLatex(shellEscape, 'url');
  if (!urlModeResult.includes('\\write18{')) {
    pass('REGRESSION: url mode neutralizes a \\write18 shell-execution payload');
  } else {
    fail(`url mode passed \\write18 through raw: ${JSON.stringify(urlModeResult)}`);
  }

  // 2. url mode is exactly sanitizeUrl — one implementation, not two that can drift.
  const samples = [
    'https://x.com/\\input{/etc/passwd}',
    'https://linkedin.com/in/someone',
    'name@example.com',
    'https://x.com/a%b#c$d',
  ];
  const allMatch = samples.every((s) => escapeLatex(s, 'url') === sanitizeUrl(s));
  if (allMatch) pass('url mode delegates to sanitizeUrl (single implementation, cannot drift)');
  else fail('url mode and sanitizeUrl produced different output');

  // 3. No dangerous LaTeX metacharacter survives sanitizeUrl.
  const attack = 'https://evil.test/' + DANGEROUS.join('') + 'write18{id}';
  const sanitized = sanitizeUrl(attack);
  const survivors = DANGEROUS.filter((ch) => sanitized.includes(ch));
  if (survivors.length === 0) {
    pass(`sanitizeUrl strips every LaTeX metacharacter (${DANGEROUS.length} checked)`);
  } else {
    fail(`these survived sanitizeUrl: ${JSON.stringify(survivors)} in ${JSON.stringify(sanitized)}`);
  }

  // 4. A legitimate URL is still usable after sanitizing — a fix that broke
  //    real links in \href{} would just be a different bug.
  const legit = sanitizeUrl('https://linkedin.com/in/jane-doe');
  if (legit === 'https://linkedin.com/in/jane-doe') pass('a legitimate URL passes through sanitizeUrl unchanged');
  else fail(`legitimate URL was altered: ${JSON.stringify(legit)}`);

  // 5. Text mode still escapes normally — the url fix must not have changed it.
  const escaped = escapeLatex('50% of $100_x & more #1');
  const textModeSafe = !/(?<!\\)%/.test(escaped) && !/(?<!\\)\$/.test(escaped) && !/(?<!\\)&/.test(escaped);
  if (textModeSafe && escaped.includes('\\%') && escaped.includes('\\$') && escaped.includes('\\_')) {
    pass('text mode still escapes %, $, _, & as before (unchanged by the url fix)');
  } else {
    fail(`text mode output: ${JSON.stringify(escaped)}`);
  }

  // 6. A backslash in text mode becomes \textbackslash{}, never a live macro.
  const backslash = escapeLatex('C:\\Users\\jane');
  if (backslash.includes('\\textbackslash{}') && !backslash.includes('\\Users')) {
    pass('text mode converts a backslash to \\textbackslash{}, not a live macro');
  } else {
    fail(`backslash handling: ${JSON.stringify(backslash)}`);
  }

  // 7. Non-string input returns '' in both modes rather than throwing.
  const nonString = [escapeLatex(null), escapeLatex(undefined, 'url'), sanitizeUrl(42)];
  if (nonString.every((v) => v === '')) pass('non-string input returns an empty string in both modes, never throws');
  else fail(`non-string handling: ${JSON.stringify(nonString)}`);

  // 8. Scheme handling: a bare domain gains https://, a bare address gains mailto:.
  if (sanitizeUrl('example.com/x') === 'https://example.com/x' && sanitizeUrl('a@b.com') === 'mailto:a@b.com') {
    pass('sanitizeUrl adds https:// to a bare domain and mailto: to a bare address');
  } else {
    fail(`scheme handling: ${sanitizeUrl('example.com/x')} / ${sanitizeUrl('a@b.com')}`);
  }
} catch (e) {
  fail(`latex-escape tests crashed: ${e.message}\n${e.stack}`);
}
