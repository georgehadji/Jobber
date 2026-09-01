// tests/providers/arbetsformedlingen.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — arbetsformedlingen');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/arbetsformedlingen.mjs')).href);
  const provider = mod.default;
  const { parseArbetsformedlingenConfig, buildLocation, normalizeJob } = mod;

  if (provider.id === 'arbetsformedlingen') pass('arbetsformedlingen.id is "arbetsformedlingen"');
  else fail(`arbetsformedlingen.id is ${JSON.stringify(provider.id)}`);

  // detect() — explicit-only
  if (provider.detect({ provider: 'arbetsformedlingen' })?.url && provider.detect({ careers_url: 'https://example.invalid' }) === null) {
    pass('detect() claims only an explicit provider:"arbetsformedlingen" entry');
  } else {
    fail('detect() should be explicit-only (board-wide feed, no URL-pattern claiming)');
  }

  // parseArbetsformedlingenConfig — defaults + clamping
  const def = parseArbetsformedlingenConfig({});
  if (def.keywords.length === 0 && def.limit === 100) pass('parseArbetsformedlingenConfig applies defaults (limit 100)');
  else fail(`parseArbetsformedlingenConfig defaults = ${JSON.stringify(def)}`);

  const cfg = parseArbetsformedlingenConfig({ arbetsformedlingen: { keywords: ['  ML Engineer  ', '', 7, 'NLP'], limit: 999 } });
  if (cfg.keywords.length === 2 && cfg.keywords[0] === 'ML Engineer' && cfg.keywords[1] === 'NLP' && cfg.limit === 100) {
    pass('parseArbetsformedlingenConfig trims keywords, drops empty/non-string entries, and clamps limit to API max 100');
  } else {
    fail(`parseArbetsformedlingenConfig sanitized = ${JSON.stringify(cfg)}`);
  }

  // buildLocation — Sweden omitted, non-Sweden appended
  if (buildLocation({ municipality: 'Stockholm', region: 'Stockholms län', country: 'Sverige' }) === 'Stockholm, Stockholms län') {
    pass('buildLocation joins municipality/region and omits Sweden');
  } else {
    fail(`buildLocation SE = ${JSON.stringify(buildLocation({ municipality: 'Stockholm', region: 'Stockholms län', country: 'Sverige' }))}`);
  }
  if (buildLocation({ municipality: 'Oslo', country: 'Norge' }) === 'Oslo, Norge') {
    pass('buildLocation appends a non-Sweden country');
  } else {
    fail(`buildLocation non-SE = ${JSON.stringify(buildLocation({ municipality: 'Oslo', country: 'Norge' }))}`);
  }
  if (buildLocation(null) === '' && buildLocation('x') === '') pass('buildLocation returns "" for missing/garbage input');
  else fail('buildLocation should return "" for missing/garbage input');

  // normalizeJob — happy path
  const norm = normalizeJob({
    headline: '  Machine Learning Engineer  ',
    webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/12345',
    employer: { name: ' Modulai AB ' },
    workplace_address: { municipality: 'Stockholm', country: 'Sverige' },
    description: { text: 'Join our team.' },
    publication_date: '2026-08-21T00:00:00',
  });
  if (norm && norm.title === 'Machine Learning Engineer' && norm.company === 'Modulai AB'
      && norm.url === 'https://arbetsformedlingen.se/platsbanken/annonser/12345'
      && norm.location === 'Stockholm' && norm.description === 'Join our team.'
      && Number.isFinite(norm.postedAt)) {
    pass('normalizeJob trims fields, keeps the trusted webpage_url, and parses publication_date');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }
  if (norm.salary === undefined) pass('normalizeJob never emits a guessed salary (API exposes no numeric bounds)');
  else fail('normalizeJob should never emit salary for this source');

  // normalizeJob — rejects missing title/url and untrusted host
  if (normalizeJob({ webpage_url: 'https://arbetsformedlingen.se/x' }) === null) pass('normalizeJob drops a hit with no headline');
  else fail('normalizeJob should require a title');
  if (normalizeJob({ headline: 'X', webpage_url: 'https://evil.example/x' }) === null) {
    pass('normalizeJob drops a webpage_url on an untrusted host');
  } else {
    fail('normalizeJob should reject an off-host webpage_url');
  }
  if (normalizeJob({ headline: 'X', webpage_url: 'http://arbetsformedlingen.se/x' }) === null) {
    pass('normalizeJob drops a non-HTTPS webpage_url');
  } else {
    fail('normalizeJob should reject a non-HTTPS webpage_url');
  }

  // fetch() — pagination, dedup across keywords, partial-failure tolerance
  const mkHit = (id, title) => ({
    headline: title,
    webpage_url: `https://arbetsformedlingen.se/platsbanken/annonser/${id}`,
    employer: { name: 'Co' },
    workplace_address: { municipality: 'Stockholm' },
  });
  const fetched = await provider.fetch(
    { name: 'AF', arbetsformedlingen: { keywords: ['ML', 'NLP'], limit: 2 } },
    {
      fetchJson: async (url) => {
        const q = new URL(url).searchParams.get('q');
        const offset = Number(new URL(url).searchParams.get('offset'));
        if (q === 'ML') return { hits: offset === 0 ? [mkHit(1, 'ML Engineer')] : [] };
        // NLP returns a full page then a short page → tests pagination continuing then stopping.
        return { hits: offset === 0 ? [mkHit(1, 'ML Engineer'), mkHit(2, 'NLP Scientist')] : [mkHit(3, 'NLP Researcher')] };
      },
    },
  );
  if (fetched.length === 3 && new Set(fetched.map(j => j.url)).size === 3) {
    pass('arbetsformedlingen.fetch() paginates until a short page and dedups by url across keywords');
  } else {
    fail(`arbetsformedlingen.fetch() returned ${JSON.stringify(fetched.map(j => j.url))}`);
  }

  // fetch() — profile.yml fallback (hermetic tmp cwd)
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'jobber-af-fallback-'));
      const cwdBefore = process.cwd();
      try {
        setup(tmp);
        process.chdir(tmp);
        return await run();
      } finally {
        process.chdir(cwdBefore);
      }
    };

    let sentQ = null;
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => provider.fetch(
        { name: 'AF', arbetsformedlingen: {} },
        { fetchJson: async (url) => { sentQ = new URL(url).searchParams.get('q'); return { hits: [] }; } },
      ),
    );
    if (sentQ === 'Data Engineer') pass('arbetsformedlingen.fetch() falls back to config/profile.yml target_roles');
    else fail(`arbetsformedlingen.fetch() fallback q = ${JSON.stringify(sentQ)}`);

    let threw = false;
    try {
      await withTmpCwd(() => {}, () => provider.fetch({ name: 'AF empty', arbetsformedlingen: {} }, { fetchJson: async () => ({ hits: [] }) }));
    } catch { threw = true; }
    if (threw) pass('arbetsformedlingen.fetch() throws when no keywords are available from any source');
    else fail('arbetsformedlingen.fetch() should throw without keywords');
  }

  // fetch() — total outage throws; partial success does not
  let outage = false;
  try {
    await provider.fetch({ name: 'AF', arbetsformedlingen: { keywords: ['ML'] } }, { fetchJson: async () => { throw new Error('HTTP 503'); } });
  } catch { outage = true; }
  if (outage) pass('arbetsformedlingen.fetch() throws when every keyword request fails');
  else fail('arbetsformedlingen.fetch() should throw on total outage');

  let partialThrew = false;
  let partial;
  try {
    partial = await provider.fetch(
      { name: 'AF', arbetsformedlingen: { keywords: ['OK', 'BAD'] } },
      { fetchJson: async (url) => {
          if (new URL(url).searchParams.get('q') === 'BAD') throw new Error('HTTP 503');
          return { hits: [] };
        } },
    );
  } catch { partialThrew = true; }
  if (!partialThrew && Array.isArray(partial) && partial.length === 0) {
    pass('arbetsformedlingen.fetch() does not throw when one keyword succeeds empty and another fails');
  } else {
    fail(`arbetsformedlingen.fetch() partial-success threw=${partialThrew}, result=${JSON.stringify(partial)}`);
  }
} catch (e) {
  fail(`arbetsformedlingen provider tests crashed: ${e.message}`);
}
