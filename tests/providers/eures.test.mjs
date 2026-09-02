// tests/providers/eures.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — eures');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/eures.mjs')).href);
  const provider = mod.default;
  const { parseEuresConfig, buildLocation, normalizeJob } = mod;

  if (provider.id === 'eures') pass('eures.id is "eures"');
  else fail(`eures.id is ${JSON.stringify(provider.id)}`);

  // detect() — explicit-only
  if (provider.detect({ provider: 'eures' })?.url && provider.detect({ careers_url: 'https://example.invalid' }) === null) {
    pass('detect() claims only an explicit provider:"eures" entry');
  } else {
    fail('detect() should be explicit-only');
  }

  // parseEuresConfig — defaults + clamping + allowlisted publication_period
  const def = parseEuresConfig({});
  if (def.keywords.length === 0 && def.locationCodes.length === 0 && def.publicationPeriod === null
      && def.pageSize === 50 && def.requestLanguage === 'en') {
    pass('parseEuresConfig applies defaults (pageSize 50, requestLanguage en)');
  } else {
    fail(`parseEuresConfig defaults = ${JSON.stringify(def)}`);
  }
  const cfg = parseEuresConfig({
    eures: { keywords: ['  ML  ', ''], location_codes: [' DE ', 'AT'], publication_period: 'LAST_WEEK', page_size: 999, request_language: ' fr ' },
  });
  if (cfg.keywords.length === 1 && cfg.locationCodes.join(',') === 'de,at' && cfg.publicationPeriod === 'LAST_WEEK'
      && cfg.pageSize === 50 && cfg.requestLanguage === 'fr') {
    pass('parseEuresConfig lowercases location codes, clamps page_size to API max 50, and trims request_language');
  } else {
    fail(`parseEuresConfig sanitized = ${JSON.stringify(cfg)}`);
  }
  const badPeriod = parseEuresConfig({ eures: { publication_period: 'BOGUS' } });
  if (badPeriod.publicationPeriod === null) pass('parseEuresConfig rejects an unrecognized publication_period');
  else fail(`parseEuresConfig should reject unknown publication_period, got ${JSON.stringify(badPeriod.publicationPeriod)}`);

  // buildLocation — joins country codes from locationMap
  if (buildLocation({ DE: ['DE138'] }) === 'DE') pass('buildLocation renders a single country code');
  else fail(`buildLocation single = ${JSON.stringify(buildLocation({ DE: ['DE138'] }))}`);
  if (buildLocation({ DE: ['DE138'], AT: ['AT13'] }) === 'DE, AT') pass('buildLocation joins multiple country codes');
  else fail(`buildLocation multi = ${JSON.stringify(buildLocation({ DE: ['DE138'], AT: ['AT13'] }))}`);
  if (buildLocation(null) === '' && buildLocation('x') === '') pass('buildLocation returns "" for missing/garbage input');
  else fail('buildLocation should return "" for missing/garbage input');

  // normalizeJob — happy path, strips HTML from description, keeps epoch-ms postedAt as-is
  const norm = normalizeJob({
    title: 'Machine Learning Engineer (m/f/d)',
    id: 'MTM2MzUtYTgxNGE1ZjFfSkI1MjE1ODY4LVMgMQ',
    employer: { name: 'Global Clearance Solutions AG' },
    locationMap: { DE: ['DE138'] },
    description: 'Who we are<br>We build <b>ML</b> systems.',
    creationDate: 1786047838691,
  });
  if (norm && norm.title === 'Machine Learning Engineer (m/f/d)'
      && norm.url === 'https://europa.eu/eures/portal/jv-se/jv-details/MTM2MzUtYTgxNGE1ZjFfSkI1MjE1ODY4LVMgMQ?lang=en'
      && norm.company === 'Global Clearance Solutions AG' && norm.location === 'DE'
      && norm.description === 'Who we are\nWe build ML systems.'
      && norm.postedAt === 1786047838691) {
    pass('normalizeJob builds the detail URL from id, strips HTML from description, and keeps creationDate as epoch ms');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }

  // normalizeJob — rejects missing title/id and a malformed id
  if (normalizeJob({ id: 'abc12345' }) === null) pass('normalizeJob drops a hit with no title');
  else fail('normalizeJob should require a title');
  if (normalizeJob({ title: 'X', id: 'short' }) === null) pass('normalizeJob rejects an id shorter than JOB_ID_RE allows');
  else fail('normalizeJob should validate id length against JOB_ID_RE');
  if (normalizeJob({ title: 'X', id: '../../etc/passwd' }) === null) {
    pass('normalizeJob rejects an id containing path-traversal characters');
  } else {
    fail('normalizeJob should reject an id with characters outside JOB_ID_RE');
  }

  // fetch() — pagination on short page, dedup across keywords, POST body shape
  const mkJv = (id, title) => ({ title, id, employer: { name: 'Co' }, locationMap: { DE: ['DE1'] } });
  let sentMethod = null, sentBody = null;
  const fetched = await provider.fetch(
    { name: 'EURES', eures: { keywords: ['ML', 'NLP'], page_size: 2 } },
    {
      fetchJson: async (url, opts) => {
        sentMethod = opts.method;
        const body = JSON.parse(opts.body);
        sentBody = body;
        if (body.keywords[0].keyword === 'ML') {
          return body.page === 1 ? { jvs: [mkJv('AAAAAAAA', 'ML Engineer')], numberRecords: 1 } : { jvs: [], numberRecords: 1 };
        }
        // NLP: full page then a short page → pagination continues once, then stops.
        return body.page === 1
          ? { jvs: [mkJv('AAAAAAAA', 'ML Engineer'), mkJv('BBBBBBBB', 'NLP A')], numberRecords: 3 }
          : { jvs: [mkJv('CCCCCCCC', 'NLP B')], numberRecords: 3 };
      },
    },
  );
  if (fetched.length === 3 && new Set(fetched.map(j => j.url)).size === 3) {
    pass('eures.fetch() paginates until a short page and dedups by url across keywords');
  } else {
    fail(`eures.fetch() returned ${JSON.stringify(fetched.map(j => j.url))}`);
  }
  if (sentMethod === 'POST' && sentBody.sortSearch === 'BEST_MATCH' && sentBody.requestLanguage === 'en') {
    pass('eures.fetch() POSTs the expected jv-search request body');
  } else {
    fail(`eures.fetch() request = method=${sentMethod}, body=${JSON.stringify(sentBody)}`);
  }

  // fetch() — profile.yml fallback (hermetic tmp cwd)
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'jobber-eures-fallback-'));
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
        { name: 'EURES', eures: {} },
        { fetchJson: async (url, opts) => { sentKeyword = JSON.parse(opts.body).keywords[0].keyword; return { jvs: [], numberRecords: 0 }; } },
      ),
    );
    if (sentKeyword === 'Data Engineer') pass('eures.fetch() falls back to config/profile.yml target_roles');
    else fail(`eures.fetch() fallback keyword = ${JSON.stringify(sentKeyword)}`);

    let threw = false;
    try {
      await withTmpCwd(() => {}, () => provider.fetch({ name: 'EURES empty', eures: {} }, { fetchJson: async () => ({ jvs: [], numberRecords: 0 }) }));
    } catch { threw = true; }
    if (threw) pass('eures.fetch() throws when no keywords are available from any source');
    else fail('eures.fetch() should throw without keywords');
  }

  // fetch() — total outage throws; partial success does not
  let outage = false;
  try {
    await provider.fetch({ name: 'EURES', eures: { keywords: ['ML'] } }, { fetchJson: async () => { throw new Error('HTTP 503'); } });
  } catch { outage = true; }
  if (outage) pass('eures.fetch() throws when every keyword request fails');
  else fail('eures.fetch() should throw on total outage');

  let partialThrew = false;
  let partial;
  try {
    partial = await provider.fetch(
      { name: 'EURES', eures: { keywords: ['OK', 'BAD'] } },
      { fetchJson: async (url, opts) => {
          if (JSON.parse(opts.body).keywords[0].keyword === 'BAD') throw new Error('HTTP 503');
          return { jvs: [], numberRecords: 0 };
        } },
    );
  } catch { partialThrew = true; }
  if (!partialThrew && Array.isArray(partial) && partial.length === 0) {
    pass('eures.fetch() does not throw when one keyword succeeds empty and another fails');
  } else {
    fail(`eures.fetch() partial-success threw=${partialThrew}, result=${JSON.stringify(partial)}`);
  }
} catch (e) {
  fail(`eures provider tests crashed: ${e.message}`);
}
