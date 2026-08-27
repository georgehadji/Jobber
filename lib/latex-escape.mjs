/**
 * Shared LaTeX escaping for Jobber CV scripts.
 */

/**
 * Escape user text for insertion into LaTeX macro arguments.
 *
 * `mode: 'url'` delegates to sanitizeUrl() rather than returning the input
 * untouched, which is what it used to do. That old passthrough was dead code —
 * no caller in the tree ever passed 'url' (every URL goes through sanitizeUrl
 * directly) — but it was dead code shaped like a safety function, which is the
 * dangerous kind: a future caller reaching for `escapeLatex(url, 'url')` would
 * reasonably assume it escapes, and instead get raw text straight into a
 * `\href{}` argument. Verified: the old branch passed
 * `https://x.com/\write18{rm -rf /}` through byte-for-byte, where
 * `\write18` is LaTeX's shell-execution primitive. generate-latex.mjs does
 * pass `-no-shell-escape` to pdflatex, so this was defence-in-depth rather
 * than a live hole, but a function whose 'url' mode does not sanitize URLs is
 * a trap regardless of what the current callers happen to do.
 *
 * Full text-escaping would be the wrong fallback here: it turns a legitimate
 * `https://x.com/a_b` into `https://x.com/a\_b` and breaks the link.
 *
 * @param {string} text
 * @param {'text'|'url'} [mode='text']
 * @returns {string}
 */
export function escapeLatex(text, mode = 'text') {
  if (typeof text !== 'string') return '';
  if (mode === 'url') return sanitizeUrl(text);
  const out = [];
  for (const ch of text) {
    switch (ch) {
      case '\\': out.push('\\textbackslash{}'); break;
      case '{': case '}': out.push('\\' + ch); break;
      case '^': out.push('\\textasciicircum{}'); break;
      case '~': out.push('\\textasciitilde{}'); break;
      case '_': out.push('\\_'); break;
      case '&': out.push('\\&'); break;
      case '%': out.push('\\%'); break;
      case '$': out.push('\\$'); break;
      case '#': out.push('\\#'); break;
      case '\u00B1': out.push('$\\pm$'); break;
      case '\u2192': out.push('$\\rightarrow$'); break;
      default: out.push(ch);
    }
  }
  return out.join('');
}

/**
 * Validate and normalize URLs for \\href{} (not LaTeX-escaped).
 *
 * @param {string} url
 * @returns {string}
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';
  const allowedSchemes = ['mailto:', 'http:', 'https:'];
  const hasScheme = allowedSchemes.some(s => url.toLowerCase().startsWith(s));
  if (!hasScheme) {
    if (url.includes('@') && !url.includes('/')) {
      url = 'mailto:' + url;
    } else {
      url = 'https://' + url;
    }
  }
  return url.replace(/[{}%$#\\~^]/g, '');
}
