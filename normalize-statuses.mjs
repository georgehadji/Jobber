#!/usr/bin/env node
/**
 * normalize-statuses.mjs — Clean non-canonical states in applications.md
 *
 * Maps all non-canonical statuses to canonical ones per states.yml:
 *   Evaluada, Aplicado, Respondido, Entrevista, Oferta, Rechazado, Descartado, NO APLICAR
 *
 * Also strips markdown bold (**) and dates from the status field,
 * moving DUPLICADO info to the notes column.
 *
 * Run: node jobber/normalize-statuses.mjs [--dry-run]
 */

import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  openTrackerTransaction, rebuildRow, resolveTrackerPath,
} from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { loadMachine, canonicalize, APPLICATION_STATUS } from './lib/state-machine.mjs';
import { extraStatusId } from './lib/status-extra-aliases.mjs';
import { applyStatusChange } from './lib/status-gate.mjs';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = resolveTrackerPath(JOBBER);
const DRY_RUN = process.argv.includes('--dry-run');

// Ensure required directories exist (fresh setup)
mkdirSync(join(JOBBER, 'data'), { recursive: true });

// Canonical status mapping. Exact label/alias spellings resolve through the registry
// (templates/states.yml), then the shared extra-alias table (D2); the regexes below
// handle the prefix/dated/placeholder shapes the registry cannot express.
const STATUS_MACHINE = loadMachine(APPLICATION_STATUS);

// Phase 5.3: rewriting a spelling must never move a row OUT of a final state. The shared
// transition gate runs in ENFORCE mode by default (a refused row is kept as-is and listed);
// JOBBER_NORMALIZE_GATE=warn applies the change anyway with a WARN. Cells that resolve to no
// state (junk such as DUPLICADO or a bare dash) are this tool's job to fix and always pass.
const GATE_MODE = process.env.JOBBER_NORMALIZE_GATE === 'warn' ? 'warn' : 'enforce';

function normalizeStatus(raw) {
  // Strip markdown bold
  let s = raw.replace(/\*\*/g, '').trim();
  const lower = s.toLowerCase();

  // DUPLICADO variants → Discarded
  if (/^duplicado/i.test(s) || /^dup\b/i.test(s)) {
    return { status: 'Discarded', moveToNotes: raw.trim() };
  }

  // Cancelada (and any "cancelada ..." suffix) → Discarded
  if (/^cancelada/i.test(s)) return { status: 'Discarded' };

  // Rechazada / Rechazado → Rejected
  if (/^rechazada?$/i.test(s)) return { status: 'Rejected' };
  if (/^rechazado\s+\d{4}/i.test(s)) return { status: 'Rejected' };

  // Aplicado with date → Applied (strip date)
  if (/^aplicado\s+\d{4}/i.test(s)) return { status: 'Applied' };

  // GEO BLOCKER → SKIP
  if (/geo.?blocker/i.test(s)) return { status: 'SKIP' };

  // Repost #NNN → Discarded
  if (/^repost/i.test(s)) return { status: 'Discarded', moveToNotes: raw.trim() };

  // "—" (em dash, no status) → Discarded
  if (s === '—' || s === '-' || s === '') return { status: 'Discarded' };

  // Canonical labels and aliases (registry), then the extra spellings (condicional, hold, ...)
  const hit = canonicalize(STATUS_MACHINE, lower) ?? canonicalize(STATUS_MACHINE, extraStatusId(lower));
  if (hit) return { status: hit.label };

  // Unknown — flag it
  return { status: null, unknown: true };
}

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to normalize.');
  process.exit(0);
}

let trackerTransaction = null;
if (!DRY_RUN) {
  try {
    trackerTransaction = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    console.error(`Cannot acquire tracker lock: ${err.message}`);
    process.exit(1);
  }
  process.once('exit', () => {
    try { trackerTransaction.close(); } catch {}
  });
}
try {
const content = trackerTransaction ? trackerTransaction.read() : readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

let changes = 0;
let unknowns = [];
let kept = [];

// Map columns by header name (tracker-parse.mjs, #954/#1596). Fixed indices
// assumed the original 9-column layout, so a customized tracker — an inserted
// Location or Via column — shifted every field one to the left: the Score cell
// was normalized as if it were the status and overwritten, while the real
// status was left alone and reported as unknown (#1955).
const COLS = resolveColumns(lines);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const row = parseTrackerRow(line, COLS);
  if (!row) continue; // header, separator, non-row, or a row missing cells

  const parts = line.split('|').map(s => s.trim());
  const num = row.num;
  const rawStatus = row.status;
  const result = normalizeStatus(rawStatus);

  if (result.unknown) {
    unknowns.push({ num, rawStatus, line: i + 1 });
    continue;
  }

  if (result.status === rawStatus) continue; // Already canonical

  // Apply change (through the shared gate)
  const oldStatus = rawStatus;
  const change = applyStatusChange({ parts, colmap: COLS, num, to: result.status, mode: GATE_MODE, machine: STATUS_MACHINE });
  if (!change.allowed) {
    kept.push({ num, rawStatus, to: result.status, from: change.gate.from, line: i + 1 });
    continue;
  }
  // unknown-from is expected here (junk cells are what this tool fixes); only illegal-move warnings matter
  for (const w of change.warnings) if (!w.startsWith('WARN row ')) console.error(w);

  // Move DUPLICADO info to notes if needed. A layout without a Notes column
  // has nowhere to put it — dropping the provenance beats appending a cell the
  // table has no header for.
  if (result.moveToNotes && COLS.notes != null) {
    const existing = parts[COLS.notes] || '';
    if (!existing.includes(result.moveToNotes)) {
      parts[COLS.notes] = result.moveToNotes + (existing ? '. ' + existing : '');
    }
  }

  // Also strip bold from score field
  if (parts[COLS.score]) {
    parts[COLS.score] = parts[COLS.score].replace(/\*\*/g, '');
  }

  // Reconstruct line
  const newLine = rebuildRow(parts);
  lines[i] = newLine;
  changes++;

  console.log(`#${num}: "${oldStatus}" → "${result.status}"`);
}

if (unknowns.length > 0) {
  console.log(`\n⚠️  ${unknowns.length} unknown statuses:`);
  for (const u of unknowns) {
    console.log(`  #${u.num} (line ${u.line}): "${u.rawStatus}"`);
  }
}

if (kept.length > 0) {
  console.log(`\n⛔ ${kept.length} kept (change would leave a final state):`);
  for (const k of kept) {
    console.log(`  #${k.num} (line ${k.line}): "${k.rawStatus}" stays — ${k.from} -> ${k.to} is an illegal transition. Override with: node set-status.mjs ${k.num} ${k.to} --force`);
  }
}

console.log(`\n📊 ${changes} statuses normalized`);

if (!DRY_RUN && changes > 0) {
  // Backup first
  const backupPath = `${APPS_FILE}.bak`;
  copyFileSync(APPS_FILE, backupPath);
  trackerTransaction.replace(lines.join('\n'));
  console.log(`✅ Written to ${APPS_FILE} (backup: ${backupPath})`);
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No changes needed');
}
} finally {
  trackerTransaction?.close();
}
