#!/usr/bin/env node

/**
 * sunset.mjs — propose/apply the "right to an ending" for silent applications
 * (#improvement-plan M5).
 *
 * A role applied to and never answered sits in the tracker as `Applied` or
 * `Responded` month after month, silently inflating every funnel denominator.
 * The tracker grows without bound and dead rows distort the numbers. sunset.mjs
 * proposes those rows for `Discarded` (the honest end of an unanswered
 * application), dry-run by default — it never touches the tracker unless you
 * pass --apply.
 *
 * The policy lives in lib/sunset-policy.mjs (a pure predicate: eligible status
 * + silence beyond `sunset_after_days` since the last dated activity). This
 * file is the shell: argument parsing, reading the tracker + ledger + config,
 * and — under --apply — writing through the canonical set-status.mjs path, one
 * row at a time (so the transition ledger stays complete and the lock is held
 * per write).
 *
 * Usage:
 *   node sunset.mjs                  # propose (JSON to stdout)
 *   node sunset.mjs --summary        # propose (human-readable)
 *   node sunset.mjs --apply          # apply proposals (Discarded), then print JSON
 *   node sunset.mjs --apply --summary
 *
 * Threshold: `sunset_after_days` in config/profile.yml (default 45).
 *
 * Exit codes: 0 success; 1 usage/config error; 2 apply path failure.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { resolveTrackerPath, loadCanonicalStates } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { isStale } from './lib/sunset-policy.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const STATES_FILE = join(ROOT, 'templates/states.yml');

const args = process.argv.slice(2);
const SUMMARY = args.includes('--summary');
const APPLY = args.includes('--apply');
if (args.includes('--help') || args.includes('-h')) {
  console.log(`sunset.mjs — put silent applications to rest (#improvement-plan M5)
  --summary   human-readable output (default is JSON)
  --apply     write proposals via set-status.mjs (Discarded) — dry-run otherwise
  --help      this help`);
  process.exit(0);
}

// ── config: sunset_after_days (default 45, per improvement plan) ─────────
let sunsetAfterDays = 45;
try {
  const profile = yaml.load(readFileSync(join(ROOT, 'config', 'profile.yml'), 'utf-8')) ?? {};
  sunsetAfterDays = Number(profile.sunset_after_days ?? 45) || 45;
} catch {
  // profile.yml missing or unparseable → keep the default.
}

// ── load tracker + canonical states ───────────────────────────────────────
const APPS_FILE = resolveTrackerPath(ROOT);
if (!existsSync(APPS_FILE)) {
  console.error(`❌ No tracker found at ${APPS_FILE}`);
  process.exit(1);
}
let states;
try {
  states = loadCanonicalStates(STATES_FILE);
} catch {
  states = [];
}

const lines = readFileSync(APPS_FILE, 'utf-8').split('\n');
const colmap = resolveColumns(lines);
const rows = [];
for (const line of lines) {
  const row = parseTrackerRow(line, colmap);
  if (row) rows.push(row);
}

// ── ledger (status-log.tsv sibling of the tracker) ─────────────────────────
const ledgerPath = join(dirname(APPS_FILE), 'status-log.tsv');
const ledger = [];
if (existsSync(ledgerPath)) {
  for (const line of readFileSync(ledgerPath, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const p = line.split('\t');
    if (p.length >= 4) ledger.push({ num: p[0], date: p[1], from: p[2], to: p[3] });
  }
}

// ── propose ───────────────────────────────────────────────────────────────
const cfg = { sunset_after_days: sunsetAfterDays };
const proposals = [];
for (const row of rows) {
  const verdict = isStale({ num: row.num, date: row.date, status: row.status }, ledger, cfg);
  if (verdict.stale) {
    proposals.push({
      num: row.num,
      company: row.company,
      role: row.role,
      status: row.status,
      reason: verdict.reason,
      daysSilent: verdict.daysSilent,
      lastActivityDate: verdict.lastActivityDate,
    });
  }
}

// ── apply (one set-status.mjs write per row) ───────────────────────────────
let applied = [];
if (APPLY) {
  for (const p of proposals) {
    try {
      const out = execFileSync(NODE, [
        join(ROOT, 'set-status.mjs'),
        String(p.num), 'Discarded',
        '--note', `sunset: ${p.reason}`,
        '--json',
      ], { cwd: ROOT, encoding: 'utf-8' });
      applied.push({ num: p.num, ok: true });
    } catch (err) {
      applied.push({ num: p.num, ok: false, error: (err?.stdout || err?.message || '').trim() });
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────
if (SUMMARY) {
  if (proposals.length === 0) {
    console.log(`No sunset candidates (sunset_after_days=${sunsetAfterDays}).`);
  } else {
    console.log(`Sunset candidates (sunset_after_days=${sunsetAfterDays}):`);
    for (const p of proposals) {
      console.log(`  #${p.num} ${p.company} — ${p.role} [${p.status}]: ${p.reason} (${p.daysSilent}d silent since ${p.lastActivityDate})`);
    }
  }
  if (APPLY) {
    const ok = applied.filter((a) => a.ok).length;
    const bad = applied.filter((a) => !a.ok);
    console.log(`${ok} sunset applied${bad.length ? `; ${bad.length} failed (${bad.map((b) => `${b.num}:${b.error}`).join('; ')})` : ''}`);
  } else {
    console.log(`(dry-run — pass --apply to mark these Discarded)`);
  }
} else {
  const result = {
    sunset_after_days: sunsetAfterDays,
    dry_run: !APPLY,
    proposals,
    ...(APPLY ? { applied } : {}),
  };
  console.log(JSON.stringify(result, null, 2));
}
