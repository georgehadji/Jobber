// tests/providers/freehire.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — freehire');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/freehire.mjs')).href);
  const provider = mod.default;
  const { parseFreehireConfig, normalizeJob, resolveBaseUrl } = mod;

  if (provider.id === 'freehire') pass('freehire.id is "freehire"');
  else fail(`freehire.id is ${JSON.stringify(provider.id)}`);

  // detect() — explicit-only
  if (provider.detect({ provider: 'freehire' })?.url && provider.detect({ careers_url: 'https://example.invalid' }) === null) {
    pass('detect() claims only an explicit provider:"freehire" entry');
  } else {
    fail('detect() should be explicit-only');
  }

  // resolveBaseUrl — default, and hardens against an invalid/non-http override
  delete process.env.FREEHIRE_API_URL;
  if (resolveBaseUrl() === 'https://freehire.me') pass('resolveBaseUrl() defaults to https://freehire.me');
  else fail(`resolveBaseUrl() default = ${resolveBaseUrl()}`);

  process.env.FREEHIRE_API_URL = 'https://self-hosted.example.com/';
  if (resolveBaseUrl() === 'https://self-hosted.example.com') pass('resolveBaseUrl() honors FREEHIRE_API_URL and strips a trailing slash');
  else fail(`resolveBaseUrl() override = ${resolveBaseUrl()}`);

  process.env.FREEHIRE_API_URL = 'file:///etc/passwd';
  if (resolveBaseUrl() === 'https://freehire.me') pass('resolveBaseUrl() falls back to the default on a non-http(s) scheme');
  else fail(`resolveBaseUrl() should reject file: scheme, got ${resolveBaseUrl()}`);

  process.env.FREEHIRE_API_URL = 'not a url';
  if (resolveBaseUrl() === 'https://freehire.me') pass('resolveBaseUrl() falls back to the default on an unparseable URL');
  else fail(`resolveBaseUrl() should reject garbage, got ${resolveBaseUrl()}`);
  delete process.env.FREEHIRE_API_URL;

  // parseFreehireConfig — defaults + sanitization
  const def = parseFreehireConfig({});
  if (def.keywords.length === 0 && def.countries.length === 0 && def.regions.length === 0
      && def.remote === false && def.isTech === null && def.postedWithinDays === null && def.pageSize === 50) {
    pass('parseFreehireConfig applies defaults (pageSize 50, remote false, isTech null)');
  } else {
    fail(`parseFreehireConfig defaults = ${JSON.stringify(def)}`);
  }
  const cfg = parseFreehireConfig({
    freehire: {
      keywords: ['  Platform Engineer  ', ''], countries: [' DK ', 'de'], regions: ['EU'],
      remote: true, is_tech: 'tech', posted_within_days: 14, page_size: 999,
    },
  });
  if (cfg.keywords.length === 1 && cfg.countries.join(',') === 'dk,de' && cfg.regions.join(',') === 'eu'
      && cfg.remote === true && cfg.isTech === 'tech' && cfg.postedWithinDays === 14 && cfg.pageSize === 100) {
    pass('parseFreehireConfig lowercases facet values and clamps page_size to the 100 max');
  } else {
    fail(`parseFreehireConfig sanitized = ${JSON.stringify(cfg)}`);
  }
  const badIsTech = parseFreehireConfig({ freehire: { is_tech: 'definitely-tech-trust-me' } });
  if (badIsTech.isTech === null) pass('parseFreehireConfig rejects an unrecognized is_tech value (null, not passed through)');
  else fail(`parseFreehireConfig should reject a bad is_tech value, got ${JSON.stringify(badIsTech.isTech)}`);

  // normalizeJob — the real API shape (verified live 2026-09-01)
  const norm = normalizeJob({
    title: 'Platform Engineer',
    url: 'https://thehub.io/jobs/6a6009290fc73bb345535824?utm_source=freehire.me',
    company: 'Terraform',
    location: 'Samsø, Danmark',
    description: 'Platform Engineer role description',
    posted_at: '2026-07-22T18:00:00Z',
  });
  if (norm && norm.title === 'Platform Engineer' && norm.company === 'Terraform'
      && norm.location === 'Samsø, Danmark' && norm.description === 'Platform Engineer role description'
      && Number.isInteger(norm.postedAt) && norm.postedAt > 0) {
    pass('normalizeJob maps the real freehire.me response shape and parses posted_at to epoch ms');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }
  if (normalizeJob({ url: 'https://x.example/1' }) === null) pass('normalizeJob drops a hit with no title');
  else fail('normalizeJob should require a title');
  if (normalizeJob({ title: 'X', url: 'not-a-url' }) === null) pass('normalizeJob drops a hit with a non-absolute URL');
  else fail('normalizeJob should require an absolute http(s) URL');
  if (normalizeJob({ title: 'X', url: 'https://x.example/1' }).description === undefined) {
    pass('normalizeJob omits description when the source did not supply one (contract: undefined, not empty string)');
  } else {
    fail('normalizeJob should omit an absent description field entirely');
  }
  if (!('salary' in normalizeJob({ title: 'X', url: 'https://x.example/1' }))) {
    pass('normalizeJob never emits a salary field (deliberately omitted — see module header)');
  } else {
    fail('normalizeJob should never emit salary');
  }

  // fetch() — pagination on a short page, dedup across keywords, facet params
  // land on the query string, GET (not POST)
  let sentMethod = null, sentUrl = null;
  const mkRow = (n, title) => ({ title, url: `https://x.example/${n}`, company: 'Co', location: 'Remote' });
  const fetched = await provider.fetch(
    { name: 'freehire', freehire: { keywords: ['Platform Engineer', 'SRE'], countries: ['dk'], remote: true, page_size: 2 } },
    {
      fetchJson: async (url, opts) => {
        sentMethod = opts.method;
        sentUrl = url;
        const params = new URL(url).searchParams;
        const q = params.get('q');
        const offset = Number(params.get('offset'));
        if (q === 'Platform Engineer') {
          return offset === 0 ? { data: [mkRow(1, 'Platform Engineer')], meta: { total: 1 } } : { data: [], meta: { total: 1 } };
        }
        // SRE: full page then a short page → pagination continues once, then stops.
        return offset === 0
          ? { data: [mkRow(1, 'Platform Engineer'), mkRow(2, 'SRE A')], meta: { total: 3 } }
          : { data: [mkRow(3, 'SRE B')], meta: { total: 3 } };
      },
    },
  );
  if (fetched.length === 3 && new Set(fetched.map((j) => j.url)).size === 3) {
    pass('freehire.fetch() paginates until a short page and dedups by url across keywords');
  } else {
    fail(`freehire.fetch() returned ${JSON.stringify(fetched.map((j) => j.url))}`);
  }
  if (sentMethod === undefined || sentMethod === null) {
    pass('freehire.fetch() issues a GET (no method override — fetchJson defaults to GET)');
  } else {
    fail(`freehire.fetch() should GET, sent method=${sentMethod}`);
  }
  const sentParams = new URL(sentUrl).searchParams;
  if (sentParams.get('countries') === 'dk' && sentParams.get('work_mode') === 'remote' && sentUrl.includes('/api/v1/jobs/search?')) {
    pass('freehire.fetch() places facet params on the query string against /api/v1/jobs/search');
  } else {
    fail(`freehire.fetch() built url = ${sentUrl}`);
  }

  // fetch() — profile.yml fallback (hermetic tmp cwd)
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'jobber-freehire-fallback-'));
      const cwdBefore = process.cwd();
      try {
        setup(tmp);
        process.chdir(tmp);
        return await run();
      } finally {
        process.chdir(cwdBefore);
      }
    };

    let sentKeyword = null;
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => provider.fetch(
        { name: 'freehire', freehire: {} },
        { fetchJson: async (url) => { sentKeyword = new URL(url).searchParams.get('q'); return { data: [], meta: { total: 0 } }; } },
      ),
    );
    if (sentKeyword === 'Data Engineer') pass('freehire.fetch() falls back to config/profile.yml target_roles');
    else fail(`freehire.fetch() fallback keyword = ${JSON.stringify(sentKeyword)}`);

    let threw = false;
    try {
      await withTmpCwd(() => {}, () => provider.fetch({ name: 'freehire empty', freehire: {} }, { fetchJson: async () => ({ data: [], meta: { total: 0 } }) }));
    } catch { threw = true; }
    if (threw) pass('freehire.fetch() throws when no keywords are available from any source');
    else fail('freehire.fetch() should throw without keywords');
  }

  // fetch() — total outage throws; partial success does not
  let outage = false;
  try {
    await provider.fetch({ name: 'freehire', freehire: { keywords: ['X'] } }, { fetchJson: async () => { throw new Error('HTTP 503'); } });
  } catch { outage = true; }
  if (outage) pass('freehire.fetch() throws when every keyword request fails');
  else fail('freehire.fetch() should throw on total outage');

  let partialThrew = false;
  let partial;
  try {
    partial = await provider.fetch(
      { name: 'freehire', freehire: { keywords: ['OK', 'BAD'] } },
      { fetchJson: async (url) => {
          if (new URL(url).searchParams.get('q') === 'BAD') throw new Error('HTTP 503');
          return { data: [], meta: { total: 0 } };
        } },
    );
  } catch { partialThrew = true; }
  if (!partialThrew && Array.isArray(partial) && partial.length === 0) {
    pass('freehire.fetch() does not throw when one keyword succeeds empty and another fails');
  } else {
    fail(`freehire.fetch() partial-success threw=${partialThrew}, result=${JSON.stringify(partial)}`);
  }
} catch (e) {
  fail(`freehire provider tests crashed: ${e.message}`);
}
