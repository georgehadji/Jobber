#!/usr/bin/env node
// @ts-check
/**
 * cv-coverage.mjs — real keyword and evidence coverage for a tailored CV.
 *
 * Computes the number that `modes/pdf.md` step 22 and `modes/latex.md` step 14
 * have always instructed the agent to report and that no code has ever
 * produced. Before this existed, an agent following those steps literally had
 * to either drop the number or invent one — and an invented percentage
 * presented as a measurement is the same fabrication this project forbids in a
 * CV, just pointed at its own output instead of the user's.
 *
 * Two numbers, not one. `coverage` is the lexical fact: how many JD keywords
 * appear anywhere in the CV. `evidenceCoverage` is the useful one: how many
 * appear in Experience, Projects, Education, or Certifications — attached to a
 * role, project, or credential rather than asserted in a skills list. A single
 * percentage is maximized by pasting the JD's keywords into a competency grid,
 * so reporting only that would score keyword stuffing and call it fit. The gap
 * between the two numbers is exactly the set of claims a CV asserts but does
 * not back up. See core/tailoring/coverage.mjs for the full rationale.
 *
 * This measures TEXT, not truth. A keyword being present says nothing about
 * whether the candidate has the skill; nothing here adds, infers, or suggests
 * adding a claim to a CV.
 *
 * Usage:
 *   node cv-coverage.mjs /tmp/cv-jane-acme.json --keywords "Kubernetes, RAG, Python"
 *   node cv-coverage.mjs /tmp/cv-jane-acme.json --jd jds/acme.md --summary
 *   node cv-coverage.mjs cv.md --jd jds/acme.md --summary
 *   node cv-coverage.mjs --self-test
 *
 * Input: a CV render payload (`.json`, as written by modes/pdf.md step 17 —
 * this is the tailored content and the preferred input) or a markdown CV
 * (`.md`, e.g. cv.md — the untailored source).
 *
 * Keywords: `--keywords` takes the list the mode extracted from the JD;
 * `--jd` derives one from a JD file with zero LLM calls via jd-skill-gap.mjs's
 * extractor, so the input to the metric is as deterministic as the metric.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { computeCoverage, formatPercent, COVERAGE_VERSION } from './core/tailoring/coverage.mjs';
import { parseCvMarkdown } from './core/cv/parse.mjs';
import { ingestRenderPayload } from './adapters/ingest/render-payload.mjs';
import { CANONICAL, DISPLAY } from './skill-extract.mjs';
import { extractJdSkills } from './jd-skill-gap.mjs';

// The single alias vocabulary, passed to the pure core as data. core/ cannot
// import skill-extract.mjs (validate-core-purity.mjs forbids reaching outside
// core/), and copying the table in would recreate the three-way drift #1896
// was opened to end — so the adapter layer supplies it instead. Both maps are
// already [spelling → canonical] shaped.
const ALIAS_PAIRS = /** @type {Array<[string, string]>} */ ([
  ...Object.entries(CANONICAL),
  ...Object.entries(DISPLAY),
]);

/**
 * @param {string} path
 * @returns {import('./core/shared/result.mjs').Result<import('./core/cv/model.mjs').CvDocument, import('./core/shared/result.mjs').DomainError>}
 */
function loadCv(path) {
  const text = readFileSync(path, 'utf-8');
  return path.endsWith('.json') ? ingestRenderPayload(text) : parseCvMarkdown(text);
}

function usage() {
  console.log(`cv-coverage — real keyword and evidence coverage for a tailored CV

Usage:
  node cv-coverage.mjs <cv-source> --keywords "a, b, c" [--summary]
  node cv-coverage.mjs <cv-source> --jd <jd-path> [--summary]
  node cv-coverage.mjs --self-test

  <cv-source>   A CV render payload (.json, from modes/pdf.md step 17 — the
                tailored content) or a markdown CV (.md, e.g. cv.md).

Options:
  --keywords    Comma-separated keywords extracted from the JD.
  --jd <path>   Derive keywords from a JD file with zero LLM calls.
  --summary     Human-readable output instead of JSON.

Reports two numbers: coverage (keyword appears anywhere) and evidenceCoverage
(keyword appears in Experience/Projects/Education/Certifications). This measures
text, not truth — presence of a keyword is not evidence the candidate has the
skill, and nothing here adds a claim to a CV.`);
}

/**
 * @param {import('./core/tailoring/coverage.mjs').CoverageReport} report
 * @param {string} cvPath
 */
function printSummary(report, cvPath) {
  console.log(`\nKeyword coverage — ${cvPath}`);
  console.log(`  Keywords considered : ${report.keywords}`);
  console.log(`  Coverage            : ${formatPercent(report.coverage)}  (${report.matched}/${report.keywords} appear anywhere in the CV)`);
  console.log(`  Evidence coverage   : ${formatPercent(report.evidenceCoverage)}  (${report.evidenced}/${report.keywords} appear in Experience/Projects/Education/Certifications)`);

  const asserted = report.hits.filter((h) => !h.evidenced);
  if (asserted.length) {
    console.log(`\n  Asserted but not evidenced (${asserted.length}) — present, but not attached to a role, project, or credential:`);
    for (const hit of asserted) console.log(`    · ${hit.canonical}  → ${hit.sectionKey}: "${truncate(hit.source.text, 70)}"`);
  }
  if (report.misses.length) {
    console.log(`\n  Not found (${report.misses.length}):`);
    for (const miss of report.misses) console.log(`    · ${miss.canonical}`);
    console.log(`\n  A missing keyword is not a defect to paper over. If the CV genuinely`);
    console.log(`  shows it, reword to use the JD's term; if it does not, leave it out.`);
  }
  console.log(`\n  Measures text, not truth. Coverage rules v${report.version}.\n`);
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ── Self-test ────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  /** @param {boolean} cond @param {string} label */
  const check = (cond, label) => {
    if (cond) { console.log(`  ok   ${label}`); }
    else { console.log(`  FAIL ${label}`); failed++; }
  };

  const payload = JSON.stringify({
    candidate: { name: 'Jane Smith', email: 'jane@example.com' },
    sections: { experience: 'Work Experience', skills: 'Skills' },
    summary: 'Backend engineer.',
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2020-2024', bullets: ['Ran services on k8s in production.'] }],
    skills: [{ category: 'Cloud', items: 'Terraform, GraphQL' }],
  }, null, 2);

  const doc = ingestRenderPayload(payload);
  check(doc.ok === true, 'render payload ingests to a CvDocument');
  if (doc.ok !== true) { console.log('  (cannot continue)'); return failed + 1; }

  const result = computeCoverage(['Kubernetes', 'GraphQL', 'Rust'], doc.value, { aliases: ALIAS_PAIRS });
  check(result.ok === true, 'coverage computes');
  if (result.ok !== true) { console.log('  (cannot continue)'); return failed + 1; }
  const r = result.value;

  check(r.matched === 2 && r.misses.length === 1, `2 of 3 keywords matched (got ${r.matched})`);
  check(r.misses[0]?.canonical === 'Rust', 'Rust reported as a miss');

  const kube = r.hits.find((h) => h.canonical === 'Kubernetes');
  check(kube?.matchedText.toLowerCase() === 'k8s', 'JD "Kubernetes" matched the CV\'s "k8s" spelling');
  check(kube?.evidenced === true, 'the k8s mention in Experience counts as evidenced');

  const graphql = r.hits.find((h) => h.canonical === 'GraphQL');
  check(graphql?.evidenced === false, 'the GraphQL mention in Skills is matched but NOT evidenced');
  check(r.evidenced === 1 && r.matched === 2, 'evidence coverage is strictly below plain coverage here');

  return failed;
}

// ── CLI ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args.includes('--self-test')) {
    console.log(`cv-coverage self-test (coverage rules v${COVERAGE_VERSION})`);
    const failed = selfTest();
    console.log(failed === 0 ? '\n🟢 self-test passed\n' : `\n🔴 ${failed} check(s) failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const summary = args.includes('--summary');
  const positional = args.filter((a) => !a.startsWith('--'));
  const cvPath = positional[0];

  if (!cvPath) {
    console.error('ERROR: no CV source given. Pass a .json render payload or a .md CV.');
    process.exit(1);
  }
  if (!existsSync(cvPath)) {
    console.error(`ERROR: CV source not found: ${cvPath}`);
    process.exit(1);
  }

  const keywordsArg = args.find((a) => a.startsWith('--keywords='))?.slice('--keywords='.length)
    ?? (args.includes('--keywords') ? args[args.indexOf('--keywords') + 1] : undefined);
  const jdArg = args.find((a) => a.startsWith('--jd='))?.slice('--jd='.length)
    ?? (args.includes('--jd') ? args[args.indexOf('--jd') + 1] : undefined);

  /** @type {string[]} */
  let keywords = [];
  if (keywordsArg) {
    keywords = keywordsArg.split(',').map((k) => k.trim()).filter(Boolean);
  } else if (jdArg) {
    if (!existsSync(jdArg)) {
      console.error(`ERROR: JD file not found: ${jdArg}`);
      process.exit(1);
    }
    keywords = [...extractJdSkills(readFileSync(jdArg, 'utf-8'))];
    if (keywords.length === 0) {
      // Zero extracted keywords would produce a meaningless 0/0 rather than a
      // real reading, and silently reporting 0% would misrepresent the CV.
      console.error(`ERROR: no keywords could be extracted from ${jdArg}. Pass --keywords explicitly.`);
      process.exit(1);
    }
  } else {
    console.error('ERROR: pass either --keywords "a, b, c" or --jd <path>.');
    process.exit(1);
  }

  const doc = loadCv(cvPath);
  if (doc.ok === false) {
    console.error(`ERROR: could not read ${cvPath} as a CV — ${doc.error.code}: ${doc.error.message}`);
    process.exit(1);
  }

  const result = computeCoverage(keywords, doc.value, { aliases: ALIAS_PAIRS });
  if (result.ok === false) {
    console.error(`ERROR: ${result.error.code}: ${result.error.message}`);
    process.exit(1);
  }

  if (summary) printSummary(result.value, cvPath);
  else console.log(JSON.stringify({ cv: cvPath, ...result.value }, null, 2));
}
