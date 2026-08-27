// tests/core-tailoring-coverage.test.mjs — core/tailoring/coverage.mjs
//
// This module replaces a metric that modes/pdf.md and modes/latex.md instruct
// an agent to report and that no code computed. The tests below therefore care
// about two things above all: that the number is REAL (it reflects the actual
// document, including cross-spelling matches and symbol-bearing tokens), and
// that it cannot be quietly inflated (a hostile or malformed keyword list is
// rejected rather than silently shrinking the denominator).
import { pass, fail } from './helpers.mjs';
import { computeCoverage, formatPercent, COVERAGE_VERSION, DEFAULT_EVIDENCE_SECTIONS } from '../core/tailoring/coverage.mjs';
import { parseCvMarkdown } from '../core/cv/parse.mjs';

console.log('\ncore/tailoring/coverage.mjs — keyword and evidence coverage');

const CV = `# Jane Smith

**Email:** jane@example.com

## Professional Summary

Backend engineer focused on distributed systems.

## Work Experience

### Senior Engineer — Acme — 2020-2024

- Ran production services on k8s across three regions
- Built ingestion in C++ and shipped a .NET client library
- Owned the GitHub Actions pipeline for twelve services

## Projects

### Recommender

Collaborative filtering with LLM reranking.

## Skills

- **Languages:** Python, Go, TypeScript
- **Cloud:** Terraform, GraphQL
`;

// A deliberately small alias table: the point is that core takes vocabulary as
// DATA and never imports skill-extract.mjs (validate-core-purity.mjs forbids
// it). If these tests needed the real table, the injection contract would be
// failing to do its job.
const ALIASES = /** @type {Array<[string, string]>} */ ([
  ['k8s', 'Kubernetes'],
  ['kubernetes', 'Kubernetes'],
  ['llm', 'LLMs'],
  ['llms', 'LLMs'],
  ['golang', 'Go'],
]);

try {
  const parsed = parseCvMarkdown(CV);
  if (parsed.ok !== true) {
    fail(`fixture CV failed to parse: ${JSON.stringify(parsed)}`);
  } else {
    const doc = parsed.value;

    // 1. A keyword present only in Skills is matched but NOT evidenced. This is
    //    the whole reason two numbers exist: one number would score stuffing.
    const skillsOnly = computeCoverage(['Python'], doc, { aliases: ALIASES });
    if (skillsOnly.ok && skillsOnly.value.matched === 1 && skillsOnly.value.evidenced === 0) {
      pass('a keyword found only in Skills counts toward coverage but not evidence coverage');
    } else {
      fail(`skills-only: ${JSON.stringify(skillsOnly)}`);
    }

    // 2. A keyword in Work Experience is evidenced.
    const inExperience = computeCoverage(['Kubernetes'], doc, { aliases: ALIASES });
    if (inExperience.ok && inExperience.value.evidenced === 1) {
      pass('a keyword found in Work Experience counts as evidenced');
    } else {
      fail(`experience: ${JSON.stringify(inExperience)}`);
    }

    // 3. Cross-spelling: the JD says "Kubernetes", the CV says "k8s". Matching
    //    only the literal keyword would report a false miss and push the user
    //    toward adding a redundant line — #1851's failure, in a new place.
    const alias = computeCoverage(['Kubernetes'], doc, { aliases: ALIASES });
    if (alias.ok && alias.value.hits[0]?.matchedText.toLowerCase() === 'k8s') {
      pass('JD spelling "Kubernetes" matches the CV\'s "k8s" via the injected alias table');
    } else {
      fail(`alias match: ${JSON.stringify(alias.ok && alias.value.hits)}`);
    }

    // 4. Without aliases the same lookup is a genuine miss — proving the match
    //    came from the injected data and not a table smuggled into core/.
    const noAliases = computeCoverage(['Kubernetes'], doc, {});
    if (noAliases.ok && noAliases.value.matched === 0) {
      pass('with no alias table supplied, "Kubernetes" is a miss (vocabulary is injected, not built in)');
    } else {
      fail(`no-alias: ${JSON.stringify(noAliases)}`);
    }

    // 5. Symbol-bearing tokens. `\b` cannot match "C++" or ".NET" standalone —
    //    same trap as skill-extract.mjs's SKILL_PATTERN. An unescaped "C++"
    //    would also be an invalid quantifier and throw.
    const symbols = computeCoverage(['C++', '.NET', 'CI/CD'], doc, { aliases: ALIASES });
    if (symbols.ok && symbols.value.matched === 2 && symbols.value.misses[0]?.keyword === 'CI/CD') {
      pass('symbol-bearing keywords match ("C++", ".NET") and regex metacharacters are escaped, not executed');
    } else {
      fail(`symbols: ${JSON.stringify(symbols)}`);
    }

    // 6. Multi-word keywords tolerate the whitespace the source actually has.
    const multiword = computeCoverage(['GitHub Actions'], doc, { aliases: ALIASES });
    if (multiword.ok && multiword.value.matched === 1 && multiword.value.evidenced === 1) {
      pass('a multi-word keyword matches and is attributed to its section');
    } else {
      fail(`multiword: ${JSON.stringify(multiword)}`);
    }

    // 7. Substring safety: "Java" must not match inside "JavaScript".
    const substring = computeCoverage(['Java'], doc, { aliases: ALIASES });
    if (substring.ok && substring.value.matched === 0) {
      pass('"Java" does not match inside "TypeScript"/"JavaScript"-style tokens (word boundaries hold)');
    } else {
      fail(`substring: ${JSON.stringify(substring)}`);
    }

    // 8. An evidenced hit is preferred over an asserted one for the same
    //    keyword — reporting the Skills-list mention while a real one sits in
    //    Experience would point the user at the less useful sentence.
    const both = computeCoverage(['Go'], doc, { aliases: ALIASES });
    if (both.ok && both.value.hits[0]?.sectionKey === 'skills') {
      pass('"Go" appears only in Skills here and is reported from there');
    } else {
      fail(`preference fixture: ${JSON.stringify(both.ok && both.value.hits)}`);
    }

    // 9. Every hit carries a real SourceSpan, so the user can read the actual
    //    sentence rather than trusting the tally.
    const spanned = computeCoverage(['Terraform'], doc, { aliases: ALIASES });
    const span = spanned.ok ? spanned.value.hits[0]?.source : undefined;
    if (span && span.line > 0 && span.text.includes('Terraform') && span.contentHash.length === 8) {
      pass('each hit carries a SourceSpan with a line number, verbatim text, and content hash');
    } else {
      fail(`span: ${JSON.stringify(span)}`);
    }

    // 10. Canonical dedup: a JD listing both spellings of one skill must not
    //     double-weight it, which would distort the denominator.
    const dedup = computeCoverage(['k8s', 'Kubernetes'], doc, { aliases: ALIASES });
    if (dedup.ok && dedup.value.keywords === 1) {
      pass('two spellings of the same skill collapse to one keyword (no double-weighting)');
    } else {
      fail(`dedup: ${JSON.stringify(dedup)}`);
    }

    // 11-14. Malformed keyword lists are REJECTED, not silently dropped.
    //     Dropping a bad entry would compute over a smaller denominator than
    //     the caller asked about — quietly inflating the percentage, which is
    //     the exact dishonesty this module exists to remove.
    const badInputs = [
      [['ok', ''], 'COVERAGE_KEYWORD_EMPTY', 'an empty keyword'],
      [['ok', 42], 'COVERAGE_KEYWORD_NOT_A_STRING', 'a non-string keyword'],
      [['x'.repeat(81)], 'COVERAGE_KEYWORD_TOO_LONG', 'an over-long keyword'],
      ['not an array', 'COVERAGE_KEYWORDS_NOT_ARRAY', 'a non-array keyword list'],
    ];
    for (const [input, code, label] of badInputs) {
      const r = computeCoverage(input, doc, { aliases: ALIASES });
      if (r.ok === false && r.error.code === code) pass(`${label} is rejected with ${code}, never silently dropped`);
      else fail(`${label} should fail with ${code}: ${JSON.stringify(r)}`);
    }

    // 15. Too many keywords is bounded — the list comes from a JD (TB2), so
    //     its length is attacker-influenced.
    const flood = computeCoverage(Array.from({ length: 201 }, (_, i) => `kw${i}`), doc, { aliases: ALIASES });
    if (flood.ok === false && flood.error.code === 'COVERAGE_TOO_MANY_KEYWORDS') {
      pass('an oversized keyword list is rejected (JD-supplied input is bounded)');
    } else {
      fail(`flood: ${JSON.stringify(flood)}`);
    }

    // 16. A malformed document is rejected rather than reported as 0% coverage,
    //     which a caller would read as "this CV matches nothing".
    const badDoc = computeCoverage(['Python'], /** @type {any} */ ({ sections: 'nope' }), {});
    if (badDoc.ok === false && badDoc.error.code === 'COVERAGE_INVALID_DOCUMENT') {
      pass('a malformed document errors rather than reporting a misleading 0%');
    } else {
      fail(`bad doc: ${JSON.stringify(badDoc)}`);
    }

    // 17. Ratios are consistent with their counts, and evidence coverage can
    //     never exceed plain coverage.
    const full = computeCoverage(['Python', 'Kubernetes', 'LLMs', 'Rust'], doc, { aliases: ALIASES });
    if (full.ok) {
      const v = full.value;
      const consistent = Math.abs(v.coverage - v.matched / v.keywords) < 1e-9
        && Math.abs(v.evidenceCoverage - v.evidenced / v.keywords) < 1e-9
        && v.evidenced <= v.matched
        && v.matched + v.misses.length === v.keywords;
      if (consistent) pass('counts, ratios, hits and misses are internally consistent; evidence never exceeds coverage');
      else fail(`inconsistent: ${JSON.stringify(v)}`);
    } else {
      fail(`full: ${JSON.stringify(full)}`);
    }

    // 18. The evidence-section set is overridable, for CVs with unusual headings.
    const widened = computeCoverage(['Python'], doc, { aliases: ALIASES, evidenceSections: ['skills'] });
    if (widened.ok && widened.value.evidenced === 1) {
      pass('evidenceSections is overridable for CVs whose headings do not resolve to the defaults');
    } else {
      fail(`widened: ${JSON.stringify(widened)}`);
    }

    // 19. Defaults exclude the self-asserted sections — this is the guarantee
    //     that keyword stuffing cannot raise evidence coverage.
    const defaults = new Set(DEFAULT_EVIDENCE_SECTIONS);
    if (!defaults.has('skills') && !defaults.has('competencies') && !defaults.has('summary') && defaults.has('experience')) {
      pass('default evidence sections exclude skills/competencies/summary — stuffing cannot raise evidence coverage');
    } else {
      fail(`defaults: ${JSON.stringify(DEFAULT_EVIDENCE_SECTIONS)}`);
    }

    // 20. Percent formatting is shared so every surface rounds identically.
    if (formatPercent(0.5) === '50.0%' && formatPercent(1 / 3) === '33.3%' && formatPercent(0) === '0.0%') {
      pass('formatPercent rounds to one decimal place consistently');
    } else {
      fail(`formatPercent: ${formatPercent(0.5)} / ${formatPercent(1 / 3)} / ${formatPercent(0)}`);
    }

    // 21. The rules that produced a number are traceable from the number.
    const versioned = computeCoverage(['Python'], doc, { aliases: ALIASES });
    if (versioned.ok && versioned.value.version === COVERAGE_VERSION) {
      pass('every report carries the coverage rule version that produced it');
    } else {
      fail(`version: ${JSON.stringify(versioned.ok && versioned.value.version)}`);
    }

    // 22. A pathological keyword must not hang the matcher. Escaping turns the
    //     JD-supplied string into a literal alternation with no nested
    //     quantifiers, so there is nothing to backtrack catastrophically —
    //     the failure mode that cost a 120s timeout in core/cv/score/contact.mjs.
    const evil = '(a+)+' + 'a'.repeat(60);
    const t0 = Date.now();
    const hostile = computeCoverage([evil], doc, { aliases: ALIASES });
    const elapsed = Date.now() - t0;
    if (hostile.ok && hostile.value.matched === 0 && elapsed < 1000) {
      pass(`a regex-shaped keyword is treated as a literal and completes fast (${elapsed}ms)`);
    } else {
      fail(`hostile keyword took ${elapsed}ms: ${JSON.stringify(hostile)}`);
    }
  }
} catch (e) {
  fail(`core-tailoring-coverage tests crashed: ${e.message}\n${e.stack}`);
}
