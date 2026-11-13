// server/scan.mjs — the "scan" task: open roles that match the visitor's CV.
//
// No LLM and no per-visitor network traffic. A background job index is refreshed from a fixed
// list of company boards (Greenhouse, Lever, Ashby) every few hours; each request only filters
// that in-memory index. Board URLs come from our own source list, never from a visitor, and the
// providers re-check their own host allowlists, so a visitor cannot aim the server anywhere.
//
// The visitor's roles and location are used for matching and never logged. Result links are
// accepted only as https URLs.

import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { makeHttpCtx } from '../providers/_http.mjs';
import greenhouse from '../providers/greenhouse.mjs';
import lever from '../providers/lever.mjs';
import ashby from '../providers/ashby.mjs';
import { withTimeout } from '../lib/with-timeout.mjs';

const PROVIDERS = [greenhouse, lever, ashby];
const MAX_TERMS = 8;
const MAX_JOBS = 100_000;

const TITLE_NOUNS = ['Engineer', 'Developer', 'Analyst', 'Manager', 'Designer', 'Scientist', 'Consultant', 'Specialist', 'Architect',
  'Director', 'Administrator', 'Coordinator', 'Officer', 'Accountant', 'Nurse', 'Teacher', 'Researcher', 'Technician', 'Writer', 'Editor',
  'Recruiter', 'Strategist', 'Associate', 'Assistant', 'Executive', 'Advisor', 'Producer', 'Planner', 'Buyer', 'Auditor', 'Programmer',
  'Operator', 'Representative', 'Marketer', 'Lawyer', 'Paralegal', 'Pharmacist', 'Therapist', 'Underwriter', 'Controller'];
const NOT_TITLE_START = new Set(['the', 'a', 'an', 'and', 'with', 'as', 'our', 'my', 'of', 'for', 'to', 'in', 'at', 'on', 'by', 'team', 'new']);
const SENIORITY = new Set(['senior', 'junior', 'lead', 'principal', 'staff', 'head', 'chief', 'associate', 'sr', 'jr']);
const TITLE_RE = new RegExp(`((?:[A-Z][\\p{L}&+-]*\\s+){1,3}(?:${TITLE_NOUNS.join('|')}))\\b`, 'gu');

/** Job titles found in the CV text, most frequent first, seniority words dropped. Best effort, no AI. */
export function deriveRoles(cv, max = 5) {
  const counts = new Map();
  let order = 0;
  for (const m of cv.matchAll(TITLE_RE)) {
    const words = m[1].trim().split(/\s+/);
    while (words.length > 1 && (NOT_TITLE_START.has(words[0].toLowerCase()) || SENIORITY.has(words[0].toLowerCase()))) words.shift();
    if (words.length < 2) continue;        // a bare noun like "Manager" matches every board
    const term = words.join(' ');
    const key = term.toLowerCase();
    const cur = counts.get(key) || { term, n: 0, order: order++ };
    cur.n++; counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.order - b.order).slice(0, max).map((c) => c.term);
}

/** "data analyst, operations\nnurse" -> ["data analyst", "operations", "nurse"] */
export function parseTerms(text, max = MAX_TERMS) {
  return [...new Set(String(text ?? '').split(/[,;\n]+/).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 60)).filter((t) => t.length >= 2))].slice(0, max);
}

const tokens = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}+#]+/gu) || [];
const hasToken = (set, t) => set.has(t) || set.has(t + 's') || (t.endsWith('s') && set.has(t.slice(0, -1)));

/** Jobs whose title contains every word of at least one term, most terms matched first. */
export function matchJobs(jobs, terms, location, max = 40) {
  const wanted = terms.map((t) => tokens(t)).filter((t) => t.length);
  const locs = parseTerms(location).map((l) => l.toLowerCase());
  const seen = new Set();
  const hits = [];
  for (const j of jobs) {
    if (seen.has(j.url)) continue;
    const set = new Set(tokens(j.title));
    const score = wanted.filter((w) => w.every((t) => hasToken(set, t))).length;
    if (!score) continue;
    if (locs.length) { const l = j.location.toLowerCase(); if (!locs.some((x) => l.includes(x))) continue; }
    seen.add(j.url);
    hits.push({ j, score });
  }
  hits.sort((a, b) => b.score - a.score || a.j.company.localeCompare(b.j.company) || a.j.title.localeCompare(b.j.title));
  return { total: hits.length, matches: hits.slice(0, max).map((h) => h.j) };
}

/** Pick the board provider for each tracked company; skip companies that are not on a supported board. */
export function loadSources(path) {
  const doc = yaml.load(readFileSync(path, 'utf8'));
  const out = [];
  for (const entry of Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : []) {
    if (!entry || entry.enabled === false || typeof entry.name !== 'string') continue;
    const provider = PROVIDERS.find((p) => p.detect(entry));
    if (provider) out.push({ entry, provider });
  }
  return out;
}

const cleanJob = (j, company) => {
  let url;
  try { url = new URL(String(j?.url ?? '')); } catch { return null; }
  if (url.protocol !== 'https:' || !j.title) return null;
  return { title: String(j.title).slice(0, 200), company: String(company).slice(0, 100), location: String(j.location ?? '').slice(0, 150), url: url.href };
};

/**
 * @param {{sources: {entry: object, provider: {fetch: Function}}[], refreshMs?: number, concurrency?: number,
 *          boardTimeoutMs?: number, makeCtx?: () => object, log?: (o: object) => void, now?: () => number}} cfg
 */
export function createJobIndex({
  sources, refreshMs = 6 * 3600_000, concurrency = 4, boardTimeoutMs = 20_000,
  makeCtx = () => makeHttpCtx({ rateLimitMs: 250 }), log = (o) => console.log(JSON.stringify(o)), now = Date.now,
}) {
  let jobs = [];
  let loadedAt = 0;
  let boards = 0;
  let running = null;
  let timer = null;

  function refresh() {
    if (running) return running;
    running = (async () => {
      const next = [];
      let ok = 0, failed = 0, i = 0;
      const worker = async () => {
        while (i < sources.length) {
          const { entry, provider } = sources[i++];
          try {
            const list = await withTimeout(Promise.resolve().then(() => provider.fetch(entry, makeCtx())), boardTimeoutMs, entry.name);
            for (const raw of Array.isArray(list) ? list : []) {
              const job = cleanJob(raw, entry.name);
              if (job && next.length < MAX_JOBS) next.push(job);
            }
            ok++;
          } catch { failed++; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
      if (ok > 0) { jobs = next; boards = ok; loadedAt = now(); }   // a total outage keeps the last good index
      log({ route: 'scan-index', boards: ok, failed, jobs: next.length });
    })().finally(() => { running = null; });
    return running;
  }

  return {
    refresh,
    start() { refresh(); timer = setInterval(refresh, refreshMs); timer.unref(); },
    stop() { clearInterval(timer); },
    ready: () => loadedAt > 0,
    snapshot: () => ({ jobs, loadedAt, boards }),
  };
}

/** @param {{index: ReturnType<typeof createJobIndex>, maxResults?: number}} cfg */
export function createScanTask({ index, maxResults = 40 }) {
  const termsFor = (cv, extra) => {
    const given = parseTerms(extra?.roles);
    return given.length ? { terms: given, derived: false } : { terms: deriveRoles(cv), derived: true };
  };
  return {
    needsJob: false,
    check(cv, _job, extra) {
      if (!index.ready()) return { status: 503, error: 'The list of open roles is still loading. Try again in a few minutes. This did not use one of your checks.' };
      if (!termsFor(cv, extra).terms.length) return 'We could not find a job title in your CV. Type the roles you want in the roles box (for example: data analyst, operations manager).';
      return null;
    },
    maxCostUsd: () => 0,
    async run(cv, _job, extra) {
      const { terms, derived } = termsFor(cv, extra);
      const { jobs, loadedAt, boards } = index.snapshot();
      const { total, matches } = matchJobs(jobs, terms, extra?.location, maxResults);
      return {
        costUsd: 0,
        result: { task: 'scan', searched: terms, derived, location: String(extra?.location ?? '').slice(0, 200), boards, listed: jobs.length, loadedAt, total, matches },
      };
    },
  };
}
