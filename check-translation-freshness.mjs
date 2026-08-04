#!/usr/bin/env node
/**
 * check-translation-freshness.mjs — staleness watch for translated READMEs
 *
 * The repo ships 17 translated READMEs. When README.md's source changes, every
 * translation silently drifts — nobody notices until a reader hits a stale
 * claim. This script is the watchdog: it reads the source SHA that was stored
 * at translation time from each README.<lang>.md and warns when it no longer
 * matches the current HEAD SHA of README.md.
 *
 * There is deliberately NO new discovery mechanism or hand-maintained list:
 * files are found as `README.<lang>.md` (two-letter lowercase, or the known
 * BC-40-style codes like `zh-TW` / `ko-KR`), and the stored SHA is just an HTML
 * comment near the top of the file:
 *
 *   <!-- jobber-source-sha: <40-hex> -->
 *
 * Re-stamping happens at translation time (keep the current README.md SHA in
 * that comment; see git log -1 --format=%H -- README.md).
 *
 * Finding types:
 *   - `stale` (soft): the stored SHA is missing or != the current README.md
 *     SHA. Warning only — a stale translation is a quality gap, not a broken
 *     build, so it never exits non-zero (same soft behavior as
 *     check-table-freshness.mjs's review-due).
 *
 * Exit code is always 0 (soft). Run in CI to surface drift; the human decides
 * whether a translation is worth refreshing.
 *
 * Run:
 *   node check-translation-freshness.mjs            (JSON to stdout)
 *   node check-translation-freshness.mjs --summary  (human-readable lines)
 *   node check-translation-freshness.mjs --sha <hex> (inject a source SHA; tests)
 *
 * Companion to #improvement-plan A8.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const SOURCE = 'README.md';
const SHA_RE = /<!-- jobber-source-sha:\s*([0-9a-f]{40})\s*-->/;
const LANG_RE = /^README\.([a-z]{2}(?:-[A-Z]{2})?)\.md$/;
const SUMMARY = process.argv.includes('--summary');
// --ci emits GitHub Actions workflow annotations (::warning::) for stale
// translations and exits 0. The script's contract is deliberately soft — a
// stale translation is a quality gap, not a broken build, so CI surfaces the
// drift on every PR without blocking the merge (the human decides whether to
// refresh). This is the CI gate requested by the HARDEN plan.
const CI = process.argv.includes('--ci');
const shaIdx = process.argv.indexOf('--sha');
const INJECTED_SHA = shaIdx !== -1 ? process.argv[shaIdx + 1] : null;

function currentSourceSha() {
  if (INJECTED_SHA) return INJECTED_SHA;
  try {
    return execSync(`git log -1 --format=%H -- ${SOURCE}`, { cwd: JOBBER, encoding: 'utf-8' }).trim();
  } catch {
    return null; // not a git checkout, or git unavailable — treat as "unknown source"
  }
}

export function checkTranslations({ sourceSha }) {
  const files = readdirSync(JOBBER).filter(f => LANG_RE.test(f));
  const findings = [];
  for (const file of files) {
    const m = LANG_RE.exec(file);
    const lang = m[1];
    let head;
    try { head = readFileSync(join(JOBBER, file), 'utf-8').split('\n').slice(0, 20).join('\n'); } catch { continue; }
    const shaMatch = SHA_RE.exec(head);
    if (!shaMatch) {
      findings.push({ lang, file, stale: true, reason: 'no jobber-source-sha stamp' });
    } else if (sourceSha && shaMatch[1] !== sourceSha) {
      findings.push({ lang, file, stale: true, reason: 'README.md changed since translation', storedSha: shaMatch[1], sourceSha });
    }
    // A file with a matching SHA is fresh; a stale one above is flagged.
  }
  return findings.sort((a, b) => a.lang.localeCompare(b.lang));
}

const sourceSha = currentSourceSha();
const findings = checkTranslations({ sourceSha });

if (SUMMARY) {
  for (const f of findings) {
    console.log(`⚠  ${f.file} stale — ${f.reason}`);
  }
  console.log(`${readdirSync(JOBBER).filter(f => LANG_RE.test(f)).length} translations; ${findings.length} stale${sourceSha ? ` (README.md @ ${sourceSha.slice(0, 12)})` : ' (source SHA unavailable — git required)'}`);
} else if (CI) {
  // GitHub Actions annotations — visible on the PR checks page, non-blocking.
  // One annotation per stale translation so the file is directly clickable.
  for (const f of findings) {
    console.log(`::warning file=${f.file},title=Stale translation::${f.file} is stale — ${f.reason}`);
  }
  if (findings.length === 0) console.log('✅ All README translations are fresh.');
} else {
  console.log(JSON.stringify({ sourceSha, source: SOURCE, stale: findings }, null, 2));
}
process.exit(0);
