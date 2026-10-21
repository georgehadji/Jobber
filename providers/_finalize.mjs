// @ts-check
// Provider output contract, enforced in ONE place. providers/_registry.mjs wraps
// every loaded provider's fetch() with finalizeJobs(), so a provider that emits
// a job without a title, with a relative/non-http URL, a zero postedAt or a
// half-built salary can no longer poison pipeline.md and the dedup keys
// (see providers/_types.js for the shape). Providers keep their own parsing.

import { isHttpUrl } from '../lib/url-guard.mjs';

const isPositive = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const boundOk = (/** @type {unknown} */ n) => n === null || isPositive(n);

/**
 * Drop postings that violate the Job contract and strip invalid optional
 * fields. A non-array result is returned untouched so the scanner's own
 * "fetch must return an array" error still surfaces.
 * @param {string} providerId
 * @param {any} jobs
 * @returns {any}
 */
export function finalizeJobs(providerId, jobs) {
  if (!Array.isArray(jobs)) return jobs;
  let dropped = 0;
  const out = [];
  for (const raw of jobs) {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim() || !isHttpUrl(raw.url)) {
      dropped++;
      continue;
    }
    const job = { ...raw };
    if ('postedAt' in job && !isPositive(job.postedAt)) delete job.postedAt;
    if ('salary' in job) {
      const s = job.salary;
      const complete = s && typeof s === 'object' && 'min' in s && 'max' in s && typeof s.currency === 'string'
        && boundOk(s.min) && boundOk(s.max) && (s.min !== null || s.max !== null);
      if (!complete) delete job.salary;
    }
    out.push(job);
  }
  if (dropped) console.error(`${providerId}: dropped ${dropped} malformed posting${dropped === 1 ? '' : 's'}`);
  return out;
}

/**
 * Guard for provider code that maps over a payload array: non-array becomes
 * [], and null / non-object elements are removed so one bad row cannot crash
 * the whole board.
 * @param {unknown} arr
 * @returns {any[]}
 */
export function compact(arr) {
  return (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');
}

/**
 * Uniform warning for a provider that stopped at its page cap while the source
 * reports more postings (silent truncation reads as "that is all there is").
 * @param {string} providerId
 * @param {{ got: number, total: number, cap: number }} info
 */
export function warnTruncated(providerId, { got, total, cap }) {
  if (total > got) {
    console.error(`${providerId}: fetched ${got} of ${total} postings (page cap ${cap}) — raise max_pages for the rest`);
  }
}
