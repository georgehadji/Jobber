#!/usr/bin/env node
/**
 * salary-import.mjs — Normalize local salary-benchmark exports into the
 * comp-gap observation log (data/salary-observations.tsv)
 *
 * Zero network, zero keys. Reads a local JSON file the user already
 * produced — an Apify actor's dataset export, an MCP tool's response, a
 * hand-typed file, anything — and appends `advertised`/`source: benchmark`
 * observations for salary-gap.mjs to fold in. The fetch is always the
 * user's own business (same "user-provided input, not automated scraping"
 * boundary paste-reply.mjs and jd-skill-gap.mjs already draw); this script
 * only ever reads a file already on disk.
 *
 * WHY NOT actor-specific parsers: vendor actor output schemas vary (Indeed's
 * baseSalary.min/max, Glassdoor's salaryMin/Median/Max, a generic salary
 * actor's own shape) and actors get renamed or delisted without notice (see
 * templates/job-data-sources.yml). One normalized input shape, documented
 * here, is cheaper to maintain than N actor-specific mappings that will
 * break on their own schedule. Shaping raw actor JSON into the shape below
 * is the user/agent's job — jq, a one-off script, or asking the AI CLI.
 *
 * Input record shape (array of objects in the input JSON file):
 *   {
 *     "company":  string   REQUIRED — resolves to a tracker#, via
 *                          data/applications.md company-name matching
 *     "num":      integer  OPTIONAL — tracker# override; skips company
 *                          resolution entirely when present
 *     "role":     string   OPTIONAL — disambiguates when one company has
 *                          multiple tracker rows
 *     "amount":   string   REQUIRED — a salary-gap.mjs-parseable figure,
 *                          e.g. "135000", "120k-150k", "€95,000"
 *     "currency": string   OPTIONAL — 3-letter code (USD, EUR, ...); omitted
 *                          becomes UNKNOWN at read time (excluded from gap
 *                          math, never guessed)
 *     "date":     string   OPTIONAL — YYYY-MM-DD; defaults to today
 *     "note":     string   OPTIONAL — provenance (actor id, board, etc.);
 *                          auto-prefixed "benchmark import: " either way
 *   }
 *
 * Writes with type=advertised, source=benchmark — the bottom trust tier in
 * salary-gap.mjs's TRUST.advertised, so an imported benchmark surfaces only
 * when no JD figure and no user observation exist for that tracker#, and
 * never outranks either.
 *
 * Every cell is validated and stripped of tabs/newlines before it reaches
 * the append-only TSV — an unsanitized note or amount could forge columns
 * or whole rows in a log that feeds salary negotiation. A record that fails
 * validation is REJECTED and reported, never silently half-written.
 *
 * Run: node salary-import.mjs <file.json> [--num <n>] [--dry-run]
 *      node salary-import.mjs --self-test
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { normalizeCompany, resolveTrackerPath, readTrackerSafe } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { parseAmount } from './salary-gap.mjs';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const OBS_PATH = join(JOBBER, 'data/salary-observations.tsv');

const HEADER_COMMENT = [
  '# salary-observations.tsv — append-only comp-observation log (user layer). Never rewrite rows.',
  '# {tracker#}\\t{YYYY-MM-DD}\\t{type}\\t{amount}\\t{currency}\\t{source}\\t{note}\\t{round}\\t{interviewer}',
  '# type: desired|advertised|actual|stated — see salary-gap.mjs for the full contract.',
].join('\n');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

function noControlChars(v, field) {
  const s = String(v ?? '');
  if (s.includes('\t') || s.includes('\n') || s.includes('\r')) {
    throw new Error(`${field} must not contain tabs or newlines`);
  }
  return s;
}

// --- Tracker# resolution ---
// Never guesses across an ambiguous match — an ambiguous or absent match is
// reported back to the caller as a rejection, not silently coerced to the
// first candidate. A wrong tracker# on a comp observation corrupts
// negotiation math for a DIFFERENT application than the one it describes.
export function resolveTrackerNum(company, role, trackerRows) {
  const target = normalizeCompany(company);
  const matches = trackerRows.filter(r => normalizeCompany(r.company) === target);
  if (matches.length === 0) return { num: null, reason: 'no-company-match' };
  if (matches.length === 1) return { num: matches[0].num, reason: 'unique-company-match' };
  if (role) {
    const roleLower = role.toLowerCase().trim();
    const roleMatches = matches.filter(r => {
      const rl = r.role.toLowerCase();
      return roleLower && (rl.includes(roleLower) || roleLower.includes(rl));
    });
    if (roleMatches.length === 1) return { num: roleMatches[0].num, reason: 'unique-role-match' };
  }
  return { num: null, reason: 'ambiguous-company-match', candidates: matches.map(r => r.num) };
}

// --- Record validation + TSV row build ---
// Returns { row: string } on success or { error: string } on rejection —
// never a partially-built row. `resolved` carries how the tracker# was
// determined, for the import summary.
export function buildImportRow(record, { trackerRows = [], today } = {}) {
  if (record == null || typeof record !== 'object' || Array.isArray(record)) {
    return { error: 'record must be a JSON object' };
  }

  let num;
  let resolved;
  if (record.num != null) {
    const n = Number(record.num);
    if (!Number.isInteger(n) || n <= 0) return { error: `num must be a positive integer, got ${JSON.stringify(record.num)}` };
    num = n;
    resolved = { reason: 'explicit-num' };
  } else {
    const company = record.company;
    if (!company || typeof company !== 'string') return { error: 'company is required when num is omitted' };
    resolved = resolveTrackerNum(company, record.role, trackerRows);
    if (resolved.num == null) {
      return { error: `could not resolve tracker# for company ${JSON.stringify(company)} (${resolved.reason}${resolved.candidates ? `: candidates ${resolved.candidates.join(', ')}` : ''}) — add an explicit "num"` };
    }
    num = resolved.num;
  }

  if (!record.amount) return { error: 'amount is required' };
  let amount;
  try {
    amount = noControlChars(record.amount, 'amount');
  } catch (e) {
    return { error: e.message };
  }
  if (parseAmount(amount) === null) return { error: `amount ${JSON.stringify(amount)} is not parseable (see salary-gap.mjs parseAmount)` };

  let currency = '';
  if (record.currency != null && record.currency !== '') {
    const c = String(record.currency).trim();
    if (!CURRENCY_RE.test(c)) return { error: `currency must be a 3-letter code, got ${JSON.stringify(record.currency)}` };
    currency = c.toUpperCase();
  }

  let date = today;
  if (record.date != null && record.date !== '') {
    const d = String(record.date).trim();
    if (!DATE_RE.test(d)) return { error: `date must be YYYY-MM-DD, got ${JSON.stringify(record.date)}` };
    date = d;
  }

  let note;
  try {
    const raw = noControlChars(record.note ?? '', 'note').trim();
    note = raw ? `benchmark import: ${raw}` : 'benchmark import';
  } catch (e) {
    return { error: e.message };
  }

  const row = [num, date, 'advertised', amount, currency, 'benchmark', note, '', ''].join('\t');
  return { row, num, resolved };
}

// --- File I/O (edges only — everything above is a pure transform) ---
function loadTrackerRows(rootDir) {
  const trackerPath = resolveTrackerPath(rootDir);
  if (!existsSync(trackerPath)) return [];
  const content = readTrackerSafe(trackerPath);
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  return lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);
}

function appendRows(rows) {
  mkdirSync(dirname(OBS_PATH), { recursive: true });
  let prefix;
  if (existsSync(OBS_PATH)) {
    const existing = readFileSync(OBS_PATH, 'utf-8');
    prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  } else {
    prefix = HEADER_COMMENT + '\n';
  }
  appendFileSync(OBS_PATH, prefix + rows.join('\n') + '\n');
}

function runImport(filePath, { forceNum = null, dryRun = false } = {}) {
  if (!existsSync(filePath)) {
    console.error(`salary-import: file not found: ${filePath}`);
    process.exit(1);
  }
  let records;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    records = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error(`salary-import: ${filePath} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  if (records.length === 0) {
    console.error('salary-import: input file has no records');
    process.exit(1);
  }
  if (forceNum != null && records.length > 1) {
    console.error('salary-import: --num only applies to a single-record input file (found multiple records) — put "num" on each record instead');
    process.exit(1);
  }

  const trackerRows = loadTrackerRows(JOBBER);
  const today = new Date().toISOString().slice(0, 10);
  const accepted = [];
  const rejected = [];

  records.forEach((record, i) => {
    const effective = forceNum != null && record.num == null ? { ...record, num: forceNum } : record;
    const result = buildImportRow(effective, { trackerRows, today });
    if (result.error) {
      rejected.push({ index: i, error: result.error });
    } else {
      accepted.push(result);
    }
  });

  if (rejected.length) {
    console.error(`salary-import: ${rejected.length} of ${records.length} record(s) rejected — nothing partial was written for them:`);
    for (const r of rejected) console.error(`  [${r.index}] ${r.error}`);
  }
  if (accepted.length === 0) {
    console.error('salary-import: no valid records to import');
    process.exit(rejected.length ? 1 : 0);
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, wouldImport: accepted.length, rejected: rejected.length, rows: accepted.map(a => a.row.split('\t')) }, null, 2));
    return;
  }

  appendRows(accepted.map(a => a.row));
  console.log(JSON.stringify({ imported: accepted.length, rejected: rejected.length, trackerNums: accepted.map(a => a.num) }, null, 2));
}

// --- Self-test (in-memory fixtures, no file writes) ---
function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };

  const trackerRows = [
    { num: 12, company: 'Acme Corp', role: 'Staff Engineer' },
    { num: 13, company: 'Globex', role: 'Backend Engineer' },
    { num: 14, company: 'Globex', role: 'Frontend Engineer' },
  ];

  // resolveTrackerNum
  assert(resolveTrackerNum('Acme Corp', null, trackerRows).num === 12, 'unique company match');
  assert(resolveTrackerNum('acme corp!!', null, trackerRows).num === 12, 'normalized company match ignores punctuation/case');
  assert(resolveTrackerNum('Nobody Inc', null, trackerRows).num === null, 'no match -> null');
  const ambiguous = resolveTrackerNum('Globex', null, trackerRows);
  assert(ambiguous.num === null && ambiguous.reason === 'ambiguous-company-match', 'ambiguous multi-role company -> null, never guesses');
  assert(resolveTrackerNum('Globex', 'Backend', trackerRows).num === 13, 'role substring disambiguates');

  // buildImportRow — happy paths
  const today = '2026-08-26';
  const ok1 = buildImportRow({ company: 'Acme Corp', amount: '135000', currency: 'usd', note: 'valig/linkedin-jobs-scraper' }, { trackerRows, today });
  assert(!ok1.error, `expected success, got ${ok1.error}`);
  assert(ok1.row === '12\t2026-08-26\tadvertised\t135000\tUSD\tbenchmark\tbenchmark import: valig/linkedin-jobs-scraper\t\t', `row shape: ${ok1.row}`);

  const ok2 = buildImportRow({ num: 99, amount: '80k-95k' }, { trackerRows, today });
  assert(!ok2.error && ok2.num === 99, 'explicit num bypasses company resolution entirely');
  assert(ok2.row.startsWith('99\t2026-08-26\tadvertised\t80k-95k\t\tbenchmark\tbenchmark import\t\t'), `default note applied: ${ok2.row}`);

  const ok3 = buildImportRow({ company: 'Globex', role: 'Frontend', amount: '110000', date: '2026-01-05' }, { trackerRows, today });
  assert(!ok3.error && ok3.num === 14 && ok3.row.startsWith('14\t2026-01-05\t'), 'role-disambiguated num + explicit date used');

  // buildImportRow — rejections (security-relevant)
  const badTab = buildImportRow({ num: 1, amount: '100000', note: 'evil\tinjected\tcolumns' }, { trackerRows, today });
  assert(badTab.error && /tabs or newlines/.test(badTab.error), 'embedded tab in note rejected, not stripped-and-written');

  const badNewline = buildImportRow({ num: 1, amount: '100000\n2\t2026-01-01\tactual\t999999\t\tuser\tforged row' }, { trackerRows, today });
  assert(badNewline.error, 'embedded newline in amount rejected (row-forgery attempt)');

  const badCompany = buildImportRow({ company: 'Nobody Inc', amount: '100000' }, { trackerRows, today });
  assert(badCompany.error && /could not resolve/.test(badCompany.error), 'unresolvable company rejected, not silently dropped');

  const badAmbiguous = buildImportRow({ company: 'Globex', amount: '100000' }, { trackerRows, today });
  assert(badAmbiguous.error && /ambiguous-company-match/.test(badAmbiguous.error), 'ambiguous company rejected with candidates surfaced');

  const badAmount = buildImportRow({ num: 1, amount: 'competitive salary' }, { trackerRows, today });
  assert(badAmount.error && /not parseable/.test(badAmount.error), 'unparseable amount rejected');

  const badCurrency = buildImportRow({ num: 1, amount: '100000', currency: 'US Dollars' }, { trackerRows, today });
  assert(badCurrency.error && /3-letter code/.test(badCurrency.error), 'malformed currency rejected, never guessed');

  const badDate = buildImportRow({ num: 1, amount: '100000', date: '08/26/2026' }, { trackerRows, today });
  assert(badDate.error && /YYYY-MM-DD/.test(badDate.error), 'non-ISO date rejected');

  const badNum = buildImportRow({ num: -1, amount: '100000' }, { trackerRows, today });
  assert(badNum.error && /positive integer/.test(badNum.error), 'non-positive num rejected');

  const badType = buildImportRow('not an object', { trackerRows, today });
  assert(badType.error, 'non-object record rejected');

  const noAmount = buildImportRow({ num: 1 }, { trackerRows, today });
  assert(noAmount.error && /amount is required/.test(noAmount.error), 'missing amount rejected');

  // never writes type: actual — buildImportRow has no code path that can
  // produce anything but 'advertised'/'benchmark', by construction
  assert(ok1.row.split('\t')[2] === 'advertised' && ok1.row.split('\t')[5] === 'benchmark', 'always writes advertised/benchmark, never actual');

  console.log('salary-import self-test OK (tracker# resolution + record validation + TSV injection guards)');
}

// --- CLI ---
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); return; }

  const numIdx = args.indexOf('--num');
  const forceNum = numIdx !== -1 ? Number(args[numIdx + 1]) : null;
  if (numIdx !== -1 && (!Number.isInteger(forceNum) || forceNum <= 0)) {
    console.error('salary-import: --num requires a positive integer');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const filePath = args.find(a => !a.startsWith('--') && a !== String(forceNum));

  if (!filePath) {
    console.error('Usage: node salary-import.mjs <file.json> [--num <n>] [--dry-run]');
    console.error('       node salary-import.mjs --self-test');
    process.exit(1);
  }
  runImport(filePath, { forceNum, dryRun });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
