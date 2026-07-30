// Regression tests for companyMatch's diacritic handling in scan.mjs.
//
// Before the fold was added, cleanNoSpaces() ran `.replace(/[^a-z0-9]/g, '')`
// on a merely-lowercased string, which STRIPPED non-ASCII letters instead of
// folding them: "Nørgaard" reduced to "nrgaard" and could never equal
// "norgaard". A portals.yml entry typed without diacritics therefore matched
// nothing in the ATS feed — silently, since a zero-match company looks
// identical to a company with no open roles.

import assert from 'node:assert/strict';
import { companyMatch, foldCompanyName } from '../scan.mjs';

let passed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${label}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

// ── The regression: diacritic variants must match ────────────────

const DIACRITIC_PAIRS = [
  ['Nørgaard', 'Norgaard', 'Danish/Norwegian ø'],
  ['Škoda', 'Skoda', 'Czech caron'],
  ['Müller', 'Muller', 'German umlaut, NFD fold'],
  ['Müller', 'Mueller', 'German umlaut, digraph transliteration'],
  ['Ericssön', 'Ericsson', 'Swedish ö'],
  ['Åhlens', 'Ahlens', 'Swedish å'],
  ['Æther Labs', 'Aether Labs', 'æ digraph'],
  ['Beiersdorf AG', 'Beiersdorf AG', 'plain ASCII still matches'],
  ['Société Générale', 'Societe Generale', 'French accents'],
  ['Łukasiewicz', 'Lukasiewicz', 'Polish ł'],
  ['Straße GmbH', 'Strasse GmbH', 'German eszett'],
];

for (const [a, b, why] of DIACRITIC_PAIRS) {
  check(`${a} matches ${b} (${why})`, () => {
    assert.equal(companyMatch(a, b), true, `expected match: "${a}" vs "${b}"`);
    assert.equal(companyMatch(b, a), true, `expected symmetric match: "${b}" vs "${a}"`);
  });
}

// ── Guard against over-matching ──────────────────────────────────
// The fold must not collapse genuinely different companies together.

// NOTE: whole-word containment in either direction is INTENDED behaviour
// ("Siemens" does match "Siemens Energy"), so such pairs belong in the
// containment group below, not here. These are pairs sharing only a prefix
// or nothing at all.
const MUST_NOT_MATCH = [
  ['Acme Robotics', 'Acme Biotech'],
  ['Nordea', 'Nordex'],
  ['Norgaard', 'Nordgaard'],
  ['Alpha', 'Beta'],
];

for (const [a, b] of MUST_NOT_MATCH) {
  check(`${a} does NOT match ${b}`, () => {
    assert.equal(companyMatch(a, b), false, `unexpected match: "${a}" vs "${b}"`);
  });
}

// ── Substring behaviour preserved (pre-existing contract) ────────
// companyMatch has always matched on whole-word containment in either
// direction; the fold must not regress that.

check('word-boundary containment still matches', () => {
  assert.equal(companyMatch('Spotify AB', 'Spotify'), true);
  assert.equal(companyMatch('Spotify', 'Spotify AB'), true);
});

check('partial word does not match', () => {
  assert.equal(companyMatch('Spot', 'Spotify'), false);
});

// ── foldCompanyName unit behaviour ───────────────────────────────

check('foldCompanyName strips combining marks', () => {
  assert.equal(foldCompanyName('Société'), 'societe');
  assert.equal(foldCompanyName('Škoda'), 'skoda');
});

check('foldCompanyName maps atomic non-decomposable letters', () => {
  assert.equal(foldCompanyName('Nørgaard'), 'norgaard');
  assert.equal(foldCompanyName('Straße'), 'strasse');
  assert.equal(foldCompanyName('Łukasiewicz'), 'lukasiewicz');
});

check('foldCompanyName german mode expands umlauts to digraphs', () => {
  assert.equal(foldCompanyName('Müller', true), 'mueller');
  assert.equal(foldCompanyName('Müller', false), 'muller');
  assert.equal(foldCompanyName('Öresund', true), 'oeresund');
});

check('foldCompanyName handles empty and nullish input', () => {
  assert.equal(foldCompanyName(''), '');
  assert.equal(foldCompanyName(null), '');
  assert.equal(foldCompanyName(undefined), '');
});

if (process.exitCode) {
  console.error(`\ncompany-match: ${passed} passed, failures above`);
} else {
  console.log(`company-match: ${passed} checks passed`);
}
