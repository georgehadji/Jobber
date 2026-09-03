// lib/sunset-policy.mjs — pure staleness predicate for `sunset.mjs` (#improvement-plan M5)
//
// The tracker grows without bound: a role applied to in February with no reply
// is still `Applied` in August, silently inflating every funnel denominator.
// This is the "right to an ending" (P2) made mechanical — a pure fold over the
// append-only ledger decides which rows have gone quiet, and sunset.mjs (the
// shell) proposes/executes a status change.
//
// Pure module: no I/O, no process.exit, only the predicate. The shell owns all
// I/O and the write path (set-status.mjs, one row at a time).

/** Statuses that are "waiting for a reply" and therefore sunset-eligible.
 * A terminal row (rejected/hired/discarded) is already ending; Evaluated is not
 * yet an application. */

export function isSunsetEligibleStatus(status, states = null) {
  const s = String(status ?? '').replace(/\*\*/g, '').trim().toLowerCase();
  return s === 'applied' || s === 'responded';
}

/**
 * Resolve a configured `sunset_after_days` value, honoring an explicit 0 (or
 * any finite number) and falling back to `fallback` only when the raw value
 * is missing or non-numeric.
 *
 * `Number(raw ?? fallback) || fallback` looks equivalent but is not: 0 is
 * falsy, so it silently re-applies the fallback to a user's explicit
 * "sunset immediately" configuration.
 *
 * @param {*} raw - profile.yml's sunset_after_days, or undefined/null.
 * @param {number} [fallback=45]
 * @returns {number}
 */
export function resolveSunsetAfterDays(raw, fallback = 45) {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Decide whether a tracker row has gone silent past the sunset threshold.
 *
 * @param {object} row - A tracker row: { num, date, status } where `date` is
 *   the applied date (YYYY-MM-DD) and `status` the current canonical status.
 * @param {object[]} ledger - status-log entries for this row, each
 *   { num, date, from, to, source }. May be empty (predates the ledger).
 * @param {object} cfg
 * @param {number} [cfg.sunset_after_days=45] - Days of silence before a waiting
 *   row is proposed for sunset.
 * @param {string|Date|number} [cfg.now] - Reference date for tests (defaults to
 *   today). Anything Date.parse understands.
 * @returns {{stale:boolean, reason:string|null, daysSilent:number, lastActivityDate:string|null}}
 *   stale=true when the row is sunset-eligible AND silent beyond the threshold;
 *   reason explains which rule fired.
 */
export function isStale(row, ledger = [], cfg = {}) {
  const sunsetAfterDays = Number(cfg.sunset_after_days ?? 45);
  const nowMs = cfg.now != null ? Date.parse(cfg.now) : Date.now();

  if (!isSunsetEligibleStatus(row?.status)) {
    return { stale: false, reason: null, daysSilent: 0, lastActivityDate: null };
  }

  // Most recent dated ledger activity for this row (or the row's own date when
  // the ledger has nothing for it — a row can predate status-log.tsv).
  const rowNum = Number(row?.num);
  let lastActivity = row?.date ? Date.parse(row.date) : NaN;
  let lastActivityDate = row?.date || null;
  const rowLedger = (ledger || []).filter((e) => Number(e?.num) === rowNum);
  for (const e of rowLedger) {
    const t = Date.parse(e.date);
    if (!Number.isNaN(t) && (Number.isNaN(lastActivity) || t > lastActivity)) {
      lastActivity = t;
      lastActivityDate = e.date;
    }
  }
  if (Number.isNaN(lastActivity)) {
    return { stale: false, reason: 'no-dated-activity', daysSilent: 0, lastActivityDate: null };
  }

  const daysSilent = Math.floor((nowMs - lastActivity) / 86_400_000);
  if (daysSilent >= sunsetAfterDays) {
    return {
      stale: true,
      reason: `${row.status}-unanswered-at-${sunsetAfterDays}d`,
      daysSilent,
      lastActivityDate,
    };
  }
  return { stale: false, reason: null, daysSilent, lastActivityDate };
}
