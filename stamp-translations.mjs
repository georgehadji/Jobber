#!/usr/bin/env node

/**
 * stamp-translations.mjs — add/update <!-- jobber-source-sha --> stamps on
 * translated mode files.
 *
 * The checker (check-translation-freshness.mjs) flags translated READMEs
 * whose stored source SHA no longer matches the English source's HEAD SHA.
 * Mode translations (modes/<lang>/<file>.md) had no such stamp — this script
 * backfills them so the same freshness watchdog can cover every translation.
 *
 * Stamping rule: for modes/<lang>/<file>.md, the source is modes/<file>.md,
 * and the stamp records `git log -1 --format=%H -- modes/<file>.md` — i.e.
 * the commit that last touched the ENGLISH source. When the source changes,
 * the stored SHA goes stale and the checker flags the translation.
 *
 * Stamp placement: inserted right after the first line (the `# heading`), so
 * the checker's head-scan (first 20 lines) reliably finds it. Idempotent:
 * an existing stamp is replaced in place; running twice produces identical
 * files.
 *
 * Run:
 *   node stamp-translations.mjs              # stamp everything, write files
 *   node stamp-translations.mjs --dry-run    # report what would change
 *   node stamp-translations.mjs --verify     # exit 1 if any file is unstamped
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const MODES_DIR = join(JOBBER, 'modes');
const SHA_RE = /<!-- jobber-source-sha:\s*([0-9a-f]{40})\s*-->/;

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

// Subdirectories under modes/ that are NOT language translation dirs.
const SKIP_DIRS = new Set([
  'interview', 'heuristics', 'regional',
]);

/**
 * Map of repo-relative file → SHA of the commit that last touched it, from
 * ONE git log pass. `git log --format=%H --name-only` emits the SHA followed
 * by the files that commit touched, newest first; the FIRST occurrence of a
 * file is its most recent commit — exactly what the per-file
 * `git log -1 --format=%H -- <file>` fallback returns, but in one spawn.
 *
 * @returns {Map<string, string>} relPath → 40-hex SHA.
 */
function sourceShas() {
  const map = new Map();
  try {
    const out = execSync('git log --format=%H --name-only -- modes/ README.md', { cwd: JOBBER, encoding: 'utf-8' });
    let currentSha = null;
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (/^[0-9a-f]{40}$/.test(trimmed)) { currentSha = trimmed; continue; }
      if (trimmed.startsWith('modes/') && trimmed.endsWith('.md') && currentSha && !map.has(trimmed)) {
        map.set(trimmed, currentSha);
      }
    }
  } catch {
    // git unavailable — callers fall back to per-file sourceSha().
  }
  return map;
}

/**
 * SHA of the last commit that touched a repo-relative file (per-file
 * fallback; the bulk path uses sourceShas()).
 *
 * @param {string} relPath - Repo-relative path (e.g. "modes/oferta.md").
 * @returns {string|null} 40-hex SHA, or null when git is unavailable.
 */
function sourceSha(relPath) {
  try {
    return execSync(`git log -1 --format=%H -- ${relPath}`, { cwd: JOBBER, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Stamp one translated file with its source's SHA.
 *
 * @param {string} transPath - Absolute path of the translated file.
 * @param {string} sourceRel - Repo-relative English source path.
 * @param {string} sha - Source SHA to record.
 * @param {boolean} [write=true] - When false, only compute the change
 *   without touching the file (dry-run).
 * @returns {{changed: boolean, line: number}} Whether the file would change
 *   and the stamp's line number (1-based), or 0 when the file has no heading.
 */
function stampFile(transPath, sourceRel, sha, write = true) {
  const text = readFileSync(transPath, 'utf-8');
  const stamp = `<!-- jobber-source-sha: ${sha} -->`;
  const lines = text.split('\n');
  const existingIdx = lines.findIndex(l => SHA_RE.test(l));
  if (existingIdx !== -1) {
    if (lines[existingIdx].includes(sha)) return { changed: false, line: existingIdx + 1 };
    lines[existingIdx] = stamp;
    if (write) writeFileSync(transPath, lines.join('\n'), 'utf-8');
    return { changed: true, line: existingIdx + 1 };
  }
  // Insert after the first non-empty line (the `# heading`).
  const firstContent = lines.findIndex(l => l.trim() !== '');
  if (firstContent === -1) return { changed: false, line: 0 };
  lines.splice(firstContent + 1, 0, '', stamp);
  if (write) writeFileSync(transPath, lines.join('\n'), 'utf-8');
  return { changed: true, line: firstContent + 2 };
}

/**
 * Walk modes/ and stamp every translated file that has an English source.
 *
 * @returns {Array<{file: string, source: string, changed: boolean, line: number}>}
 */
function stampAll() {
  const out = [];
  const rootFiles = new Set(readdirSync(MODES_DIR).filter(n => n.endsWith('.md')));
  const shas = sourceShas();

  // ── Mode translations (modes/<lang>/<file>.md) ──────────────
  for (const lang of readdirSync(MODES_DIR)) {
    const langDir = join(MODES_DIR, lang);
    if (!statSync(langDir).isDirectory()) continue;
    if (SKIP_DIRS.has(lang)) continue;
    if (!existsSync(join(langDir, 'README.md')) && !readdirSync(langDir).some(f => rootFiles.has(f))) continue;
    for (const f of readdirSync(langDir)) {
      if (!f.endsWith('.md')) continue;
      // Skip files with no English counterpart in the root modes/ dir.
      if (!rootFiles.has(f)) continue;
      const transPath = join(langDir, f);
      const sourceRel = `modes/${f}`;
      const sha = shas.get(sourceRel) ?? sourceSha(sourceRel);
      if (!sha) {
        out.push({ file: `modes/${lang}/${f}`, source: sourceRel, changed: false, line: 0, reason: 'git unavailable — cannot compute source SHA' });
        continue;
      }
      const { changed, line } = stampFile(transPath, sourceRel, sha, !DRY_RUN);
      out.push({ file: `modes/${lang}/${f}`, source: sourceRel, changed, line });
    }
  }

  // ── README translations (README.<lang>.md at repo root) ─────
  // FC-004: these use the same <!-- jobber-source-sha --> stamp
  // mechanism as mode translations, but live in the repo root.
  const README_LANG_RE = /^README\.([a-z]{2}(?:-[A-Z]{2})?)\.md$/;
  const readmeSha = shas.get('README.md') ?? sourceSha('README.md');
  if (readmeSha) {
    for (const f of readdirSync(JOBBER)) {
      if (!README_LANG_RE.test(f)) continue;
      const transPath = join(JOBBER, f);
      const { changed, line } = stampFile(transPath, 'README.md', readmeSha, !DRY_RUN);
      out.push({ file: f, source: 'README.md', changed, line });
    }
  }

  return out;
}

// ── Main ────────────────────────────────────────────────────────
const results = stampAll();
const changed = results.filter(r => r.changed);
const unstamped = results.filter(r => !r.changed && !r.reason);

if (VERIFY) {
  const missing = results.filter(r => r.reason || r.line === 0);
  if (missing.length > 0) {
    for (const m of missing) console.log(`  ❌ ${m.file} — ${m.reason || 'no stamp line (missing heading?)'}`);
    console.log(`\n❌ ${missing.length} translated file(s) could not be stamped.`);
    process.exit(1);
  }
  console.log(`✅ All ${results.length} translated mode files carry a source stamp.`);
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`🔎 Dry-run: ${results.length} translated files scanned; ${changed.length} would be (re)stamped.`);
  for (const r of results) {
    console.log(`  ${r.changed ? '✏️' : '✓'} ${r.file} ${r.changed ? '→ stamp would update' : '(stamp current)'}`);
  }
} else {
  console.log(`📝 Stamped ${changed.length} of ${results.length} translated mode files.`);
  for (const r of results) {
    console.log(`  ${r.changed ? '✏️' : '✓'} ${r.file}${r.changed ? ` — stamped at line ${r.line}` : ' (stamp current)'}`);
  }
}
