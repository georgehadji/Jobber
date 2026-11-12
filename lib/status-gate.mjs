// lib/status-gate.mjs — the one transition gate for tracker status writes
// (STATE-MACHINES-PLAN §4.3, Phase 3.2 / 3.4). Wraps lib/state-machine.mjs check().
//
// The tracker Status cell is user-layer text and is often NOT a clean label
// (`Applied 2026-01-05`, `Hired (2026-01-05)`, `**Rejected**`, `Evaluada`). The gate
// therefore resolves the existing cell tolerantly before judging a move, so a decorated
// terminal such as `Rejected 2026-02-01` is still a terminal, and a decorated or
// aliased live cell is never mistaken for one (bug M1).
//
// This module is pure: no locks, no file writes, no process exit. Callers own the tracker
// transaction (acquireTrackerLock / openTrackerTransaction + writeFileAtomic) and the
// status-log append (appendStatusLog) — applyStatusChange only decides and edits `parts`.
import { loadMachine, check, canonicalize, APPLICATION_STATUS } from './state-machine.mjs';

// Same decoration merge-tracker.validateStatus and tracker.normalizeStatus strip:
// trailing bare date + anything after it, then any remaining (date) / bare date.
const TRAILING_DATE_RE = /\s+\(?\d{4}-\d{2}-\d{2}\)?.*$/;
const ANY_DATE_RE = /\(?\d{4}-\d{2}-\d{2}\)?/g;

/**
 * Resolve an existing Status cell to a machine state: exact first, then with date/`**`
 * decoration stripped. Returns {id,label,via:'exact'|'stripped'} or null (truly unknown).
 */
export function resolveStatusCell(machine, raw) {
  const exact = canonicalize(machine, raw);
  if (exact) return { id: exact.id, label: exact.label, via: 'exact' };
  const stripped = String(raw ?? '').replace(/\*\*/g, '').replace(TRAILING_DATE_RE, '').replace(ANY_DATE_RE, '').trim();
  const hit = stripped && canonicalize(machine, stripped);
  return hit ? { id: hit.id, label: hit.label, via: 'stripped' } : null;
}

/**
 * Judge `rawFrom` -> `to` (see state-machine.check kinds). A decorated/aliased `from` is
 * resolved first; only a cell that still resolves to nothing is `unknown-from`
 * (allowed with a warning, never terminal). Adds `fromRaw` and `fromVia` to the result.
 */
export function gateStatusChange(machine, rawFrom, to) {
  const src = resolveStatusCell(machine, rawFrom);
  const res = check(machine, src ? src.label : rawFrom, to);
  return { ...res, fromRaw: String(rawFrom ?? ''), fromVia: src ? src.via : null };
}

/**
 * Decide and apply one status change to a split tracker row (`parts` = line.split('|') cells).
 *   mode 'enforce' (default): an illegal move is refused unless `force`; `parts` untouched.
 *   mode 'warn' (Phase 3.4):  an illegal move is APPLIED anyway, with a
 *                             `WARN illegal transition <from> -> <to> (row N)` warning and a
 *                             ledger note — behaviour unchanged, the move is only reported.
 * `unknown-from` is applied in both modes, with its own warning (the row stays live).
 * Returns {allowed, applied, gate, warnings[], logNote}. The caller prints `warnings`, writes
 * the line under its own lock, and appends the status-log row (put `logNote` in its note).
 */
export function applyStatusChange({ parts, colmap, num, to, mode = 'enforce', force = false, machine = loadMachine(APPLICATION_STATUS) }) {
  const from = parts[colmap.status] ?? '';
  const gate = gateStatusChange(machine, from, to);
  const warnings = [];
  let logNote = '';
  if (!gate.ok) {
    if (mode === 'enforce' && !force) return { allowed: false, applied: false, gate, warnings, logNote };
    if (mode === 'warn') {
      const w = `WARN illegal transition ${gate.from} -> ${gate.to}`;
      warnings.push(`${w} (row ${num})`);
      logNote = w;
    }
  } else if (gate.kind === 'unknown-from') {
    warnings.push(`WARN row ${num}: ${gate.warning}`);
  }
  parts[colmap.status] = gate.kind === 'unknown-to' ? String(to) : gate.to;
  return { allowed: true, applied: true, gate, warnings, logNote };
}
