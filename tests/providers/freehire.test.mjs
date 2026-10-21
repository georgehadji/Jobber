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
    pass('normalizeJob omits salary when the source states none (absent key, not an empty object)');
  } else {
    fail('normalizeJob should omit salary without enrichment');
  }

  // annualizeSalary — year passes, month ×12, day/hour/no-currency omitted, KEY PRESENCE
  {
    const { annualizeSalary, postingHistoryFrom, retryAfterMs, buildSearchParams } = mod;
    const y = annualizeSalary({ salary_min: 90000, salary_max: 130000, salary_currency: 'eur', salary_period: 'year' });
    const m = annualizeSalary({ salary_min: 5000, salary_currency: 'USD', salary_period: 'month' });
    const swapped = annualizeSalary({ salary_min: 130000, salary_max: 90000, salary_currency: 'GBP', salary_period: 'year' });
    if (y && y.min === 90000 && y.max === 130000 && y.currency === 'EUR') pass('annualizeSalary passes a yearly range and uppercases the currency');
    else fail(`annualizeSalary year = ${JSON.stringify(y)}`);
    if (m && m.min === 60000 && m.max === null && m.currency === 'USD' && 'max' in m) {
      pass('annualizeSalary multiplies a monthly figure by 12 and keeps an unknown bound as null (KEY PRESENCE)');
    } else fail(`annualizeSalary month = ${JSON.stringify(m)}`);
    if (swapped && swapped.min === 90000 && swapped.max === 130000) pass('annualizeSalary normalizes a reversed range');
    else fail(`annualizeSalary swapped = ${JSON.stringify(swapped)}`);
    const omitted = [
      annualizeSalary({ salary_min: 50, salary_currency: 'EUR', salary_period: 'hour' }),
      annualizeSalary({ salary_min: 400, salary_currency: 'EUR', salary_period: 'day' }),
      annualizeSalary({ salary_min: 90000, salary_currency: '', salary_period: 'year' }),
      annualizeSalary({ salary_min: 90000, salary_period: 'year' }),
      annualizeSalary({ salary_min: 0, salary_max: null, salary_currency: 'EUR', salary_period: 'year' }),
      annualizeSalary({ salary_min: 90000, salary_currency: 'EUR', salary_period: 'toString' }),
      annualizeSalary(undefined),
    ];
    if (omitted.every((v) => v === null)) pass('annualizeSalary omits hour/day periods, missing currency, zero bounds and prototype-key periods');
    else fail(`annualizeSalary should omit imprecise salaries, got ${JSON.stringify(omitted)}`);

    // postingHistoryFrom — facts only, never the class label
    const h = postingHistoryFrom({ class: 'likely-evergreen', age_days: 74, repost_count: 3, mass_posting_count: 2, fake_freshness: true });
    if (h && h.source === 'freehire' && h.ageDays === 74 && h.repostCount === 3 && h.concurrentCount === 2
        && h.fakeFreshness === true && !Object.values(h).includes('likely-evergreen')) {
      pass('postingHistoryFrom maps reality to facts and drops freehire\'s class label');
    } else fail(`postingHistoryFrom = ${JSON.stringify(h)}`);
    if (postingHistoryFrom(null) === null && postingHistoryFrom({ age_days: -1 }) === null && postingHistoryFrom({ age_days: 'x' }) === null) {
      pass('postingHistoryFrom returns null without a usable age');
    } else fail('postingHistoryFrom should reject an absent/invalid age');

    // normalizeJob carries salary / postingHistory / externalRef from the real wire shape
    const full = normalizeJob({
      public_slug: 'platform-engineer-tomra-oujimwaz',
      title: 'Platform Engineer', url: 'https://jobs.example/1', company: 'Tomra', location: 'Berlin',
      enrichment: { salary_min: 70000, salary_max: 90000, salary_currency: 'EUR', salary_period: 'year' },
      reality: { class: 'stale', age_days: 74, repost_count: 3, mass_posting_count: 2, fake_freshness: false },
    });
    if (full && full.salary?.min === 70000 && full.postingHistory?.ageDays === 74
        && full.externalRef?.source === 'freehire' && full.externalRef?.id === 'platform-engineer-tomra-oujimwaz') {
      pass('normalizeJob carries annualized salary, postingHistory and externalRef');
    } else fail(`normalizeJob full = ${JSON.stringify(full)}`);
    const badSlug = normalizeJob({ public_slug: '../../etc', title: 'X', url: 'https://x.example/1' });
    if (!('externalRef' in badSlug)) pass('normalizeJob drops a public_slug that is not a plain slug');
    else fail(`normalizeJob should reject a path-like slug, got ${JSON.stringify(badSlug.externalRef)}`);

    // retryAfterMs — delta-seconds, HTTP-date, garbage
    const now = Date.parse('2026-10-21T12:00:00Z');
    if (retryAfterMs('5', now) === 5000 && retryAfterMs('Wed, 21 Oct 2026 12:00:10 GMT', now) === 10000
        && retryAfterMs('soon', now) === null && retryAfterMs(null, now) === null) {
      pass('retryAfterMs parses delta-seconds and HTTP-dates, null otherwise');
    } else fail('retryAfterMs parsing');

    // buildSearchParams always asks for plain-text descriptions
    if (buildSearchParams({ keyword: 'SRE', pageSize: 10, page: 2, filters: [['seniority', 'senior']] }).toString()
        === 'q=SRE&limit=10&offset=20&description_format=text&seniority=senior') {
      pass('buildSearchParams pages by offset, requests description_format=text and appends filters');
    } else fail('buildSearchParams shape');
  }

  // parseFreehireConfig — facet table: closed vocabularies drop unknowns, aliases fold, salary floor needs currency
  {
    const f = parseFreehireConfig({ freehire: {
      seniority: ['Senior', 'wizard'], category: 'backend', work_mode: ['hybrid'], remote: true,
      employment_type: ['full_time'], exclude_company_types: ['outstaff', 'evil'], exclude_reality: ['likely-evergreen'],
      visa_sponsorship: true, requires_clearance: false, open_within_days: 7, salary_min: 90000, salary_currency: 'eur',
    } });
    const pairs = f.filters.map(([p, v]) => `${p}=${v}`);
    const expect = ['work_mode=hybrid', 'work_mode=remote', 'seniority=senior', 'category=backend', 'employment_type=full_time',
      'company_type_exclude=outstaff', 'reality_exclude=likely-evergreen', 'visa_sponsorship=true', 'requires_clearance=false',
      'open_within_days=7', 'salary_min=90000', 'salary_currency=EUR'];
    if (expect.every((e) => pairs.includes(e)) && !pairs.some((p) => p.includes('wizard') || p.includes('evil'))) {
      pass('parseFreehireConfig maps every facet row, folds remote into work_mode and drops out-of-vocabulary values');
    } else fail(`parseFreehireConfig filters = ${JSON.stringify(pairs)}`);
    const src = parseFreehireConfig({ freehire: { sources: ['UKG', 'paycom'], exclude_sources: 'greenhouse' } }).filters.map(([p, v]) => `${p}=${v}`);
    if (src.join('&') === 'source=ukg&source=paycom&source_exclude=greenhouse') pass('parseFreehireConfig maps sources/exclude_sources to source/source_exclude (lowercased, scalar accepted)');
    else fail(`sources filters = ${JSON.stringify(src)}`);
    const noCur = parseFreehireConfig({ freehire: { salary_min: 90000 } });
    if (!noCur.filters.some(([p]) => p === 'salary_min')) pass('parseFreehireConfig drops salary_min without salary_currency');
    else fail('salary_min without a currency should be dropped');
    const badTypes = parseFreehireConfig({ freehire: { visa_sponsorship: 'yes', open_within_days: -3, salary_currency: 'BTC' } });
    if (badTypes.filters.length === 0) pass('parseFreehireConfig drops wrongly-typed bool/int and an unknown currency');
    else fail(`parseFreehireConfig should drop bad types, got ${JSON.stringify(badTypes.filters)}`);
  }

  // fetch() — a 429 with a short Retry-After is waited out once, then the page succeeds
  {
    let calls = 0;
    const slept = [];
    const jobs = await provider.fetch(
      { name: 'freehire', freehire: { keywords: ['SRE'], page_size: 5 } },
      {
        sleep: async (ms) => { slept.push(ms); },
        fetchJson: async () => {
          calls++;
          if (calls === 1) { const e = new Error('HTTP 429'); e.status = 429; e.retryAfter = '2'; throw e; }
          return { data: [{ title: 'SRE', url: 'https://x.example/sre' }], meta: { total: 1 } };
        },
      },
    );
    if (calls === 2 && slept.includes(2000) && jobs.length === 1) pass('freehire.fetch() waits out a short 429 Retry-After once and retries the page');
    else fail(`429 retry: calls=${calls} slept=${JSON.stringify(slept)} jobs=${jobs.length}`);

    let longCalls = 0;
    let threwLong = false;
    try {
      await provider.fetch(
        { name: 'freehire', freehire: { keywords: ['SRE'] } },
        { sleep: async () => {}, fetchJson: async () => { longCalls++; const e = new Error('HTTP 429'); e.status = 429; e.retryAfter = '3600'; throw e; } },
      );
    } catch { threwLong = true; }
    if (longCalls === 1 && threwLong) pass('freehire.fetch() does not wait out a long Retry-After (no retry, keyword fails fast)');
    else fail(`long 429: calls=${longCalls} threw=${threwLong}`);
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
  if (sentParams.get('countries') === 'dk' && sentParams.get('work_mode') === 'remote'
      && sentParams.get('description_format') === 'text' && sentUrl.includes('/api/v1/agent/jobs/search?')) {
    pass('freehire.fetch() places facet params on the query string against /api/v1/agent/jobs/search (full descriptions)');
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
