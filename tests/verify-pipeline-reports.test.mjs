/**
 * verify-pipeline-reports.test.mjs — verify-pipeline.mjs integrity checks.
 *
 * Covers the duplicate/orphan report checks (#1425, warning-level, exit 0)
 * and the duplicate tracker number check (#1704, error-level, exit 1).
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs).
 */

import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, run, ROOT, NODE } from './helpers.mjs';

console.log('\n🧪 Testing verify-pipeline duplicate/orphan report checks...');
try {
  const vpTmp = mkdtempSync(join(tmpdir(), 'jobber-verify-reports-'));
  try {
    const vpReports = join(vpTmp, 'reports');
    mkdirSync(vpReports, { recursive: true });
    const vpTracker = join(vpTmp, 'applications.md');
    const vpEnv = { ...process.env, JOBBER_TRACKER: vpTracker, JOBBER_REPORTS: vpReports };

    const report = (company, role) =>
      `# Evaluación: ${company} — ${role}\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: "${company}"\nrole: "${role}"\nscore: 4.2\n\`\`\`\n`;

    // #1 and #3 are the same role at Acme written by two concurrent workers;
    // #2 is a different Acme role (must NOT be flagged as duplicate);
    // #3 also has no tracker row (orphan — tracker dedup kept #1).
    writeFileSync(join(vpReports, '001-acme-2026-01-04.md'), report('Acme', 'Staff AI Engineer'));
    writeFileSync(join(vpReports, '002-acme-2026-01-05.md'), report('Acme', 'Platform Engineer'));
    writeFileSync(join(vpReports, '003-acme-2026-01-05.md'), report('Acme', 'Staff AI Engineer'));

    writeFileSync(vpTracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-04 | Acme | Staff AI Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-01-04.md) | ok |\n' +
      '| 2 | 2026-01-05 | Acme | Platform Engineer | 4.0/5 | Evaluated | ❌ | [2](reports/002-acme-2026-01-05.md) | ok |\n');

    const vpOut = run(NODE, ['verify-pipeline.mjs'], { env: vpEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    if (vpOut === null) {
      fail('verify-pipeline crashed on duplicate/orphan report fixture');
    } else {
      if (vpOut.includes('Duplicate reports for same company+role') &&
          vpOut.includes('001-acme-2026-01-04.md') && vpOut.includes('003-acme-2026-01-05.md')) {
        pass('duplicate reports for the same company+role are flagged (#1425)');
      } else {
        fail('duplicate company+role reports not flagged');
      }
      if (vpOut.includes('002-acme-2026-01-05.md') && /Duplicate reports[^\n]*002-acme/.test(vpOut)) {
        fail('different role at the same company falsely flagged as duplicate report');
      } else {
        pass('different role at the same company is not flagged as duplicate');
      }
      if (/Orphan report[^\n]*#3[^\n]*003-acme-2026-01-05\.md/.test(vpOut)) {
        pass('orphan report with no tracker row is flagged (#1425)');
      } else {
        fail('orphan report not flagged');
      }
      if (/Orphan report[^\n]*(001|002)-acme/.test(vpOut)) {
        fail('referenced report falsely flagged as orphan');
      } else {
        pass('referenced reports are not flagged as orphans');
      }
      // run() returns non-null only on exit 0 — warnings must not fail the check.
      pass('duplicate/orphan report findings stay warning-level (exit 0)');
    }

    // Clean fixture: one row, one report — both checks must pass green.
    rmSync(join(vpReports, '003-acme-2026-01-05.md'));
    const vpClean = run(NODE, ['verify-pipeline.mjs'], { env: vpEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    if (vpClean !== null &&
        vpClean.includes('No duplicate reports for the same company+role') &&
        vpClean.includes('No orphan reports')) {
      pass('clean tracker+reports fixture passes both report checks');
    } else {
      fail('clean fixture did not pass duplicate/orphan report checks');
    }
  } finally {
    rmSync(vpTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`verify-pipeline report checks crashed: ${e.message}`);
}

// ── VERIFY-PIPELINE DUPLICATE TRACKER NUMBER (#1704) ────────────
// A tracker # must be a unique row id. Two rows sharing a # is never
// legitimate (unlike Check 2's company+role dedup, which can false-positive
// on a genuine re-application) — verify-pipeline must flag it as an error.
console.log('\n🧪 Testing verify-pipeline duplicate tracker # check (#1704)...');
try {
  const dupNumTmp = mkdtempSync(join(tmpdir(), 'jobber-verify-dupnum-'));
  try {
    const dupNumTracker = join(dupNumTmp, 'applications.md');
    const dupNumEnv = { ...process.env, JOBBER_TRACKER: dupNumTracker };

    writeFileSync(dupNumTracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 698 | 2026-05-29 | University of Alberta | Curriculum Coordinator | 3.8/5 | Evaluated | ❌ | — | — |\n' +
      '| 698 | 2026-06-03 | Esri Canada | Manager Talent and Organizational Development | 4.1/5 | Evaluated | ❌ | — | — |\n' +
      '| 700 | 2026-06-10 | Shopify | Staff Engineer | 4.5/5 | Evaluated | ❌ | — | — |\n');

    let dupNumOut;
    try {
      dupNumOut = execFileSync(NODE, ['verify-pipeline.mjs'], { cwd: ROOT, env: dupNumEnv, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
      fail('verify-pipeline should exit non-zero on a duplicate tracker number');
    } catch (e) {
      dupNumOut = (e.stdout || '').toString();
      if (e.status === 1) {
        pass('verify-pipeline exits 1 on a duplicate tracker number');
      } else {
        fail(`verify-pipeline: expected exit 1, got ${e.status}`);
      }
    }
    if (dupNumOut.includes('Duplicate tracker number #698')
        && dupNumOut.includes('University of Alberta') && dupNumOut.includes('Esri Canada')) {
      pass('duplicate tracker number #698 flagged with both colliding rows named');
    } else {
      fail(`duplicate tracker number not flagged with both rows\n${dupNumOut}`);
    }
    if (/Duplicate tracker number #700/.test(dupNumOut)) {
      fail('unique #700 row falsely flagged as a duplicate tracker number');
    } else {
      pass('unique tracker number not falsely flagged');
    }
  } finally {
    rmSync(dupNumTmp, { recursive: true, force: true });
  }

  // Clean fixture: no duplicate numbers — must pass green.
  const cleanTmp = mkdtempSync(join(tmpdir(), 'jobber-verify-dupnum-clean-'));
  try {
    const cleanTracker = join(cleanTmp, 'applications.md');
    writeFileSync(cleanTracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | — | — |\n' +
      '| 2 | 2026-01-02 | Globex | Analyst | 3.9/5 | Evaluated | ❌ | — | — |\n');
    const cleanOut = run(NODE, ['verify-pipeline.mjs'], { env: { ...process.env, JOBBER_TRACKER: cleanTracker }, stdio: ['pipe', 'pipe', 'pipe'] });
    if (cleanOut !== null && cleanOut.includes('No duplicate tracker numbers')) {
      pass('clean tracker with unique numbers passes the duplicate-number check');
    } else {
      fail('clean fixture did not pass the duplicate tracker number check');
    }
  } finally {
    rmSync(cleanTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`verify-pipeline duplicate tracker number test crashed: ${e.message}`);
}
