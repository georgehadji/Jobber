// tests/generate-plaintext-fact-gate.test.mjs — B7-D4: build-cv-plaintext.mjs
// must run the CV fact gate (verify-cv-facts.mjs's assertFacts) before writing
// the output file, the same way generate-pdf.mjs/generate-latex.mjs do.
//
// Confirmed live (docs/DEFECT-HUNT-LEDGER.md B7-D4): before this fix, a JSON
// payload whose `summary` field fabricated a metric absent from cv.md
// ("Increased revenue by 500%") wrote straight through to a .txt file with no
// fact check at all. build-cv-plaintext.mjs's main() runs unconditionally on
// import (no direct-invocation guard), so this runs it as a real subprocess.
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'jobber-plaintext-fact-gate-'));
try {
  const fabricatedPayload = {
    candidate: { name: 'Jane Smith', email: 'jane@example.com' },
    summary: 'Increased company-wide revenue by 500% at Acme Corp.',
    competencies: [], experience: [], projects: [], education: [], skills: [],
  };
  const fabricatedIn = join(tmp, 'fabricated.json');
  const fabricatedOut = join(tmp, 'fabricated.txt');
  writeFileSync(fabricatedIn, JSON.stringify(fabricatedPayload), 'utf-8');
  const blocked = spawnSync(NODE, [join(ROOT, 'build-cv-plaintext.mjs'), fabricatedIn, fabricatedOut], { encoding: 'utf-8', timeout: 15_000 });
  if (blocked.status !== 0 && /Fact check failed for CV \(plaintext\)/.test(blocked.stderr) && !existsSync(fabricatedOut)) {
    pass('build-cv-plaintext.mjs blocks a fabricated metric absent from cv.md and writes no file');
  } else {
    fail(`build-cv-plaintext.mjs did not block the fabricated CV: status=${blocked.status}, stderr=${blocked.stderr.trim()}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
