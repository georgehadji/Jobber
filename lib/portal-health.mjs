// lib/portal-health.mjs — the ONE place that classifies a data/portal-health.tsv status and folds the
// append-only records into failure streaks. Pure: no I/O and no provider imports, so `stats.mjs` can use
// it without loading `scan.mjs` (which pulls every provider). The classification used to be copy-pasted
// three times (scan computeConsecutiveFailures, scan computePortalSkipTargets, stats computePortalStats);
// the copies drifted once (D12), so there is now one.
//
//   healthy   (reachable, empty) resets the streak — a live board with 0 jobs is reachable.
//   neutral   (rate_limited)     throttled, not dead: neither extends nor resets the streak.
//   failure   everything else    (slug_gone, network, auth, server, unknown, any new kind) extends it.
// Failure is the DEFAULT, so a newer error kind can never silently fall outside the streak.
// The state vocabulary is declared in templates/machines/portal-health.yml.

/** @param {string} status @returns {'reset'|'skip'|'count'} what a record does to its company's streak */
export function healthEffect(status) {
  if (status === 'rate_limited') return 'skip';
  if (status === 'reachable' || status === 'empty') return 'reset';
  return 'count';
}

/**
 * Parse portal-health.tsv text (header line first) into records.
 * @param {string} text
 * @returns {Array<{timestamp:string,company:string,status:string}>}
 */
export function parsePortalHealthTsv(text) {
  const lines = String(text ?? '').split('\n');
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) records.push({ timestamp: parts[0], company: parts[1], status: parts[2] });
  }
  return records;
}

/** @param {Array<{company:string,status:string}>} healthRecords @returns {Map<string,number>} consecutive failures per company */
export function computeConsecutiveFailures(healthRecords) {
  const streaks = new Map();
  for (const r of healthRecords) {
    const effect = healthEffect(r.status);
    if (effect === 'skip') continue;
    if (effect === 'reset') streaks.set(r.company, 0);
    else streaks.set(r.company, (streaks.get(r.company) || 0) + 1);
  }
  return streaks;
}

/**
 * Which portals to skip this run because they keep failing (#improvement-plan A3).
 *
 * Consecutive failures over a threshold earn the portal a backoff window that
 * grows exponentially and caps after a few days; the portal is skipped until
 * its window elapses, then probed again. This replaces "record the failure,
 * print a warning, hit the same dead portal again next run" — the signal is
 * finally actuated instead of collected. Pure fold over the append-only
 * portal-health.tsv records; no I/O here so it is unit-testable.
 *
 * `status` resets on reachable/empty (a live board with 0 jobs is healthy);
 * the backoff counts from the LAST failure timestamp.
 *
 * @param {Array<{timestamp:string,company:string,status:string}>} healthRecords
 * @param {object} [opts]
 * @param {number} [opts.threshold=3] - Consecutive failures before a portal is eligible to be skipped.
 * @param {number} [opts.baseDelayDays=1] - Backoff after hitting the threshold (doubles per extra failure).
 * @param {number} [opts.capDelayDays=4] - Backoff ceiling, in days.
 * @param {number} [opts.now=Date.now()] - Reference time (injectable for tests).
 * @returns {Map<string,{streak:number,lastFailureTs:number|null,skipUntilTs:number}>}
 */
export function computePortalSkipTargets(healthRecords, {
  threshold = 3, baseDelayDays = 1, capDelayDays = 4, now = Date.now(),
} = {}) {
  const byCompany = new Map();
  for (const r of healthRecords) {
    let c = byCompany.get(r.company);
    if (!c) { c = { streak: 0, lastFailureTs: null }; byCompany.set(r.company, c); }
    const effect = healthEffect(r.status);
    if (effect === 'skip') continue; // throttled, not dead
    if (effect === 'reset') {
      c.streak = 0;
      c.lastFailureTs = null;
    } else {
      c.streak += 1;
      const ts = Date.parse(r.timestamp);
      if (!Number.isNaN(ts) && (c.lastFailureTs === null || ts > c.lastFailureTs)) c.lastFailureTs = ts;
    }
  }
  const out = new Map();
  for (const [company, c] of byCompany) {
    if (c.streak < threshold) continue;
    const backoffMs = Math.min(capDelayDays, baseDelayDays * Math.pow(2, c.streak - threshold)) * 86_400_000;
    const skipUntilTs = (c.lastFailureTs ?? now) + backoffMs;
    if (now < skipUntilTs) {
      out.set(company, { streak: c.streak, lastFailureTs: c.lastFailureTs, skipUntilTs });
    }
  }
  return out;
}
