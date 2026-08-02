#!/usr/bin/env node

/**
 * validate-report.mjs — verify every report's Machine Summary against the
 * shared contract (#improvement-plan M1), so the "six dimensions → one number"
 * rubric is persisted as machine-readable data and can be trusted downstream.
 *
 * Scans reports/*.md, extracts each `## Machine Summary` YAML fence via the
 * shared parser in lib/report-schema.mjs (the single implementation the
 * evaluators emit against and the analytics read), and validates:
 *   - required: score (0-5 number) and legitimacy_tier present;
 *   - optional: the `dimensions` block, when present, conforms to the M1
 *     contract (recognised dimension keys, 0-5 scores).
 *
 * Backward compatible: a report WITHOUT a `dimensions` block is not an error —
 * it predates M1. Such reports are counted and listed under `missingDimensions`
 * so coverage is visible, but they never fail the run. A report with a broken
 * `dimensions` block, or a missing/out-of-range score or legitimacy_tier, IS a
 * real defect and fails.
 *
 * Exit codes (CI-friendly): 1 if any hard defect (bad score/legitimacy or a
 * malformed dimensions block) or on usage error; 0 otherwise — missing
 * dimensions alone never fails. This is the enforcement half of the M1 output
 * contract; the emission half lives in batch/batch-prompt.md + modes/oferta.md.
 *
 * Run:
 *   node validate-report.mjs                 (JSON to stdout)
 *   node validate-report.mjs --summary       (human-readable)
 *   node validate-report.mjs --reports DIR   (scan a different reports dir)
 *   node validate-report.mjs --file PATH     (validate a single report)
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseReportSummary, validateReportSummary } from './lib/report-schema.mjs';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const SUMMARY = process.argv.includes('--summary');

function reportsDir() {
  const i = process.argv.indexOf('--reports');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return join(JOBBER, 'reports');
}

function singleFile() {
  const i = process.argv.indexOf('--file');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function validateFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { file: filePath, errors: [`unreadable: ${filePath}`], ok: false, hasDimensions: false };
  }
  const summary = parseReportSummary(content);
  if (!summary) {
    return { file: filePath, errors: ['no parseable ## Machine Summary YAML fence'], ok: false, hasDimensions: false };
  }
  const errors = validateReportSummary(summary);
  return {
    file: filePath,
    errors,
    ok: errors.length === 0,
    score: summary.score,
    legitimacy: summary.legitimacy_tier,
    hasDimensions: summary && typeof summary === 'object' && summary.dimensions !== undefined,
  };
}

function main() {
  const single = singleFile();
  const files = single
    ? [single]
    : readdirSync(reportsDir()).filter((f) => f.endsWith('.md')).map((f) => join(reportsDir(), f)).sort();

  if (files.length === 0 && !single) {
    console.log(SUMMARY
      ? `0 reports found in ${reportsDir()} — no checks run`
      : JSON.stringify({ reportsDir: reportsDir(), reports: 0, defects: 0, missingDimensions: 0, files: [] }, null, 2));
    process.exit(0);
  }

  const results = files.map(validateFile);
  const defects = results.filter((r) => !r.ok);
  const missingDimensions = results.filter((r) => r.ok && !r.hasDimensions);
  const withDimensions = results.filter((r) => r.ok && r.hasDimensions);

  if (SUMMARY) {
    for (const r of defects) {
      console.log(`❌ ${r.file}`);
      for (const e of r.errors) console.log(`   → ${e}`);
    }
    for (const r of missingDimensions) {
      console.log(`—  ${r.file} (score ${r.score}) no dimensions block (predates M1, counted not failed)`);
    }
    console.log(`${withDimensions.length} with dimensions · ${missingDimensions.length} without · ${defects.length} defective`);
  } else {
    console.log(JSON.stringify({
      reportsDir: reportsDir(),
      reports: results.length,
      withDimensions: withDimensions.length,
      missingDimensions: missingDimensions.map((r) => r.file),
      defects: defects.map((r) => ({ file: r.file, errors: r.errors })),
    }, null, 2));
  }

  process.exit(defects.length === 0 ? 0 : 1);
}

main();
