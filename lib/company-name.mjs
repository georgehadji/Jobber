// lib/company-name.mjs — normalize a company display name into a matching
// key. Shared by invite-match.mjs, scan.mjs, and detect-reposts.mjs so all
// three treat name variants ("Acme Technologies Inc." vs "Acme") the same way.

// True legal-entity suffixes, stripped repeatedly (chained) since a name can
// legitimately carry more than one ("Acme Holdings Inc." → "acme holdings").
// These are unambiguous enough that removing several in a row is safe.
const LEGAL_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co',
  'limited', 'ltd', 'llc', 'llp', 'lp', 'plc',
];

// Generic business-descriptor words that vary between how a recruiter signs
// an email and how the tracker recorded the company, but are common enough
// as substantive parts of a name (e.g. "Data Solutions" vs "Data Corp") that
// chaining their removal risks collapsing two different companies to the
// same key. Stripped at most once, and only after legal suffixes are gone —
// never chained with each other or with LEGAL_SUFFIXES.
const GENERIC_DESCRIPTORS = [
  'group', 'holdings', 'technologies', 'technology', 'solutions',
  'canada', 'international',
];

// Compiled once at module load rather than per call. Safe to share across
// calls: no /g flag, so .test() keeps no lastIndex state between uses.
const LEGAL_SUFFIX_RES = LEGAL_SUFFIXES.map((s) => new RegExp(`\\s${s}$`));
const GENERIC_DESCRIPTOR_RES = GENERIC_DESCRIPTORS.map((w) => new RegExp(`\\s${w}$`));

/**
 * Normalize a company name for matching: lowercase, strip punctuation and
 * parentheticals, collapse whitespace, chain-strip trailing legal-entity
 * suffixes (so "Acme Technologies Inc." reduces to "acme technologies"),
 * then strip at most one trailing generic descriptor word. Deliberately
 * stricter than dedup-tracker.mjs's normalizeCompany (which only lowercases
 * and strips punctuation): invite emails quote company names more loosely
 * than tracker rows quote each other, so matching across the two sources
 * needs the extra suffix-stripping that same-source dedup does not.
 *
 * Generic descriptors are deliberately stripped only once (not chained) and
 * only after legal suffixes, so two distinct companies that happen to both
 * end in a generic word (e.g. "Data Solutions" vs "Data Corp") don't
 * collapse to the same "data" key — see issue discussion on PR #1497.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeCompanyName(name) {
  let key = String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let suffixStripped = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of LEGAL_SUFFIX_RES) {
      if (re.test(key)) {
        key = key.replace(re, '').trim();
        changed = true;
        suffixStripped = true;
      }
    }
  }

  // Only strip a generic descriptor once a legal suffix has actually come
  // off. Without that gate, "Data Corp" (suffix-stripped to "data") and
  // "Data Solutions" (no suffix, descriptor-stripped to "data") collapse to
  // the same key even though they're unrelated companies — the exact
  // collision the docstring above claims is prevented.
  if (suffixStripped) {
    for (const re of GENERIC_DESCRIPTOR_RES) {
      if (re.test(key)) {
        key = key.replace(re, '').trim();
        break;
      }
    }
  }

  return key;
}
