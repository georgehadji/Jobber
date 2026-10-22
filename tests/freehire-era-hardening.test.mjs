// tests/freehire-era-hardening.test.mjs — Workstream G of docs/AUDIT-FIX-PLAN.md.
// Employer-board scope, sameOpening across scripts and spellings, detectBoard evidence, the capped
// streaming page read, and discover-ats refusing an unverified board. Each has its control.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { loadProviders } from '../providers/_registry.mjs';
import { sameOpening } from '../lib/employer-board.mjs';
import { detectBoard, fetchPage } from '../lib/ats-detect.mjs';
import { resolveFromWebsite } from '../discover-ats.mjs';

console.log('\nfreehire-era code (audit workstream G)');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

const providers = await loadProviders(join(ROOT, 'providers'));

// ── employer-board scope (12) ───────────────────────────────────────────
{
  for (const id of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters']) {
    eq(`${id} is a per-company board (feeds the employer-board cross-check)`, providers.get(id)?.scope, 'company');
  }
  for (const id of ['freehire', 'eures', 'arbeitnow', 'hackernews', 'remoteok', 'weworkremotely']) {
    eq(`${id} is a search/board-wide source (never an employer's board)`, providers.get(id)?.scope, undefined);
  }
}

// ── sameOpening (s10) ───────────────────────────────────────────────────
eq('CJK title matches itself with a location suffix', sameOpening('软件工程师', '软件工程师 (上海)'), true);
eq('Cyrillic title matches across decoration', sameOpening('Разработчик Python (удалённо)', 'Разработчик Python'), true);
eq('Back-end / Backend hyphenation is the same opening', sameOpening('Desarrollador Back-end', 'Desarrollador Backend'), true);
eq('Full-Stack / Full Stack spacing is the same opening', sameOpening('Senior Full-Stack Engineer', 'Senior Full Stack Engineer'), true);
eq('control: different CJK roles stay different', sameOpening('软件工程师', '产品经理'), false);
eq('control: different Latin roles stay different', sameOpening('Backend Engineer', 'Product Designer'), false);

// ── detectBoard evidence (14) ───────────────────────────────────────────
{
  const urls = ['https://job-boards.greenhouse.io/competitorco', 'https://jobs.lever.co/acme', 'https://job-boards.greenhouse.io/competitorco/jobs/1'];
  const named = detectBoard(urls, providers, { company: 'Acme' });
  eq('a board whose URL names the company beats an earlier link', [named?.provider, named?.careers_url, named?.confidence], ['lever', 'https://jobs.lever.co/acme', 'verified']);
  const other = detectBoard(['https://job-boards.greenhouse.io/competitorco'], providers, { company: 'Acme' });
  eq('a lone board that names someone else is unverified', [other?.provider, other?.confidence], ['greenhouse', 'unverified']);
  const legacy = detectBoard(urls, providers);
  eq('control: without a company the old first-link behaviour is unchanged', [legacy?.provider, legacy?.confidence], ['greenhouse', undefined]);
  eq('diacritics fold when matching the company', detectBoard(['https://jobs.lever.co/nestle'], providers, { company: 'Nestlé' })?.confidence, 'verified');
}

// ── fetchPage reads a capped amount (s11) ───────────────────────────────
{
  let cancelled = false;
  let chunks = 0;
  const endless = new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new TextEncoder().encode('x'.repeat(100_000))); },
    cancel() { cancelled = true; },
  });
  const res = { status: 200, ok: true, headers: new Headers(), body: endless, text: async () => { throw new Error('text() must not be used on a streamed body'); } };
  const page = await fetchPage('https://example.com/careers', { fetchImpl: async () => res });
  eq('an endless body is cut at the cap and the download is cancelled', [cancelled, page.html.length <= 3_000_000, chunks < 50], [true, true, true]);

  const small = { status: 200, ok: true, headers: new Headers(), body: null, text: async () => '<html>ok</html>' };
  eq('control: a small page is returned whole', (await fetchPage('https://example.com/', { fetchImpl: async () => small })).html, '<html>ok</html>');

  let redirectCancelled = false;
  const hops = [
    { status: 302, ok: false, headers: new Headers({ location: 'https://example.com/next' }), body: { cancel: async () => { redirectCancelled = true; } } },
    small,
  ];
  await fetchPage('https://example.com/', { fetchImpl: async () => hops.shift() });
  eq('a redirect response body is cancelled before following it', redirectCancelled, true);
}

// ── discover-ats refuses an unverified board (14) ───────────────────────
{
  const page = (html) => async () => ({ status: 200, ok: true, headers: new Headers(), body: null, text: async () => html });
  let fetched = 0;
  const countingProviders = new Map([...providers].map(([id, p]) => [id, { ...p, fetch: async (...a) => { fetched++; return p.fetch(...a); } }]));
  const ctx = { fetchJson: async () => ({ jobs: [{ id: 1, title: 'Eng', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', location: { name: 'Berlin' } }] }), fetchText: async () => '', maxPages: 1 };

  const foreign = await resolveFromWebsite({ name: 'Acme', website: 'https://acme.example.com' }, { providers: countingProviders, ctx, fetchImpl: page('<a href="https://job-boards.greenhouse.io/competitorco">Partner jobs</a>') });
  eq('a board that names another company is reported unverified', [foreign.status, foreign.vendor, foreign.careers_url], ['unverified', 'greenhouse', 'https://job-boards.greenhouse.io/competitorco']);
  eq('and its provider is never called', fetched, 0);

  const own = await resolveFromWebsite({ name: 'Acme', website: 'https://acme.example.com' }, { providers: countingProviders, ctx, fetchImpl: page('<a href="https://job-boards.greenhouse.io/acme">Careers</a>') });
  eq('control: the company\'s own board resolves with its job count', [own.resolved?.vendor, own.resolved?.careers_url, own.resolved?.jobCount], ['greenhouse', 'https://job-boards.greenhouse.io/acme', 1]);
}
