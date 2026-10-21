// tests/providers/trudvsem.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — trudvsem');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/trudvsem.mjs')).href);
  const trudvsem = mod.default;
  const { parseTrudvsemConfig, buildTrudvsemUrl, normalizeTrudvsemVacancy } = mod;

  check(trudvsem.id === 'trudvsem', 'trudvsem.id is "trudvsem"', JSON.stringify(trudvsem.id));

  // detect() — explicit-only (board-wide, no URL pattern)
  const hit = trudvsem.detect({ name: 'T', provider: 'trudvsem' });
  check(hit?.url === 'https://opendata.trudvsem.ru/api/v1/vacancies', 'detect() claims an explicit provider:"trudvsem" entry', JSON.stringify(hit));
  for (const [label, entry] of Object.entries({
    'careers_url on the real host': { name: 'T', careers_url: 'https://opendata.trudvsem.ru/api/v1/vacancies' },
    'trudvsem.ru careers_url': { name: 'T', careers_url: 'https://trudvsem.ru/vacancy/card/1/2' },
    'another provider': { name: 'T', provider: 'eures' },
    'no provider': { name: 'T' },
    'null entry': null,
  })) {
    check(trudvsem.detect(entry) === null, `detect() does not claim ${label}`);
  }

  // parseTrudvsemConfig
  const def = parseTrudvsemConfig({});
  check(def.keywords.length === 0 && def.region === null && def.pageSize === 100, 'parseTrudvsemConfig defaults (no keywords, all-Russia, page size 100)', JSON.stringify(def));
  const cfg = parseTrudvsemConfig({ trudvsem: { keywords: ['  Python ', '', 'Python', 7], region: ' 7700000000000 ', page_size: 999 } });
  check(cfg.keywords.join(',') === 'Python' && cfg.region === '7700000000000' && cfg.pageSize === 100, 'parseTrudvsemConfig trims / dedupes keywords, validates region, clamps page_size', JSON.stringify(cfg));
  check(parseTrudvsemConfig({ trudvsem: { region: '../admin' } }).region === null && parseTrudvsemConfig({ trudvsem: { region: '77' } }).region === null,
    'parseTrudvsemConfig rejects a region that is not a 13-digit code (path-injection control)');
  check(parseTrudvsemConfig({ trudvsem: { page_size: 0 } }).pageSize === 1, 'parseTrudvsemConfig clamps page_size up to 1');

  // buildTrudvsemUrl
  check(buildTrudvsemUrl(null, 'python', 100, 0) === 'https://opendata.trudvsem.ru/api/v1/vacancies?text=python&limit=100&offset=0', 'buildTrudvsemUrl: national endpoint, 0-based page index', buildTrudvsemUrl(null, 'python', 100, 0));
  check(buildTrudvsemUrl('7700000000000', 'аналитик данных', 50, 2) === 'https://opendata.trudvsem.ru/api/v1/vacancies/region/7700000000000?text=%D0%B0%D0%BD%D0%B0%D0%BB%D0%B8%D1%82%D0%B8%D0%BA+%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D1%85&limit=50&offset=2',
    'buildTrudvsemUrl: region endpoint, percent-encoded Cyrillic keyword', buildTrudvsemUrl('7700000000000', 'аналитик данных', 50, 2));

  // normalizeTrudvsemVacancy — shape trimmed from the live payload
  const vac = (over = {}) => ({
    id: 'c50d9cd8-bbe3-11f1-9a11-2f8460579df4', region: { region_code: '6300000000000', name: 'Самарская область' },
    company: { name: 'ООО "УРАЛАЙТЕХ"', url: 'https://trudvsem.ru/company/1227700702074' }, 'creation-date': '2026-10-01',
    salary: 'от 45000', salary_min: 45000, salary_max: 45000, 'job-name': ' Разработчик Python ',
    vac_url: 'https://trudvsem.ru/vacancy/card/1227700702074/c50d9cd8-bbe3-11f1-9a11-2f8460579df4',
    duty: 'Разработка ПО', requirements: 'Опыт от 3 лет', ...over,
  });
  const j = normalizeTrudvsemVacancy(vac(), 'Fallback');
  check(j?.title === 'Разработчик Python' && j.url === 'https://trudvsem.ru/vacancy/card/1227700702074/c50d9cd8-bbe3-11f1-9a11-2f8460579df4' && j.company === 'ООО "УРАЛАЙТЕХ"'
    && j.location === 'Самарская область' && j.postedAt === Date.parse('2026-10-01') && j.description === 'Обязанности:\nРазработка ПО\n\nТребования:\nОпыт от 3 лет',
    'normalize maps title, url, employer, region, postedAt, duty+requirements description', JSON.stringify(j));
  check(!('salary' in j), 'normalize omits salary (period unstated, max mirrors min for "от X")');
  const bare = normalizeTrudvsemVacancy(vac({ company: {}, duty: '', requirements: ' ', 'creation-date': 'nope' }), 'Fallback');
  check(bare?.company === 'Fallback' && !('description' in bare) && !('postedAt' in bare), 'normalize: missing employer → fallback; empty text → no description; bad date → no postedAt', JSON.stringify(bare));
  check(normalizeTrudvsemVacancy(vac({ id: '' }), 'F') === null && normalizeTrudvsemVacancy(vac({ id: 'a/../b' }), 'F') === null && normalizeTrudvsemVacancy(vac({ 'job-name': '  ' }), 'F') === null && normalizeTrudvsemVacancy(null, 'F') === null,
    'normalize drops missing / unsafe id, blank title, null record');
  for (const [label, u] of Object.entries({
    'http scheme': 'http://trudvsem.ru/vacancy/card/1/2',
    'foreign host': 'https://evil.example/vacancy/card/1/2',
    'lookalike evil-trudvsem.ru': 'https://evil-trudvsem.ru/vacancy/card/1/2',
    'lookalike trudvsem.ru.evil.com': 'https://trudvsem.ru.evil.com/x',
    'missing': '',
  })) {
    check(normalizeTrudvsemVacancy(vac({ vac_url: u }), 'F') === null, `normalize drops a posting whose vac_url is ${label}`);
  }
  check(normalizeTrudvsemVacancy(vac({ vac_url: 'https://www.trudvsem.ru/vacancy/card/1/2' }), 'F') !== null, 'normalize accepts www.trudvsem.ru (control for the host rejections)');

  // fetch() — pagination, dedupe across keywords, request shape
  const row = (id, name) => ({ vacancy: vac({ id, 'job-name': name, vac_url: `https://trudvsem.ru/vacancy/card/1/${id}` }) });
  const calls = [];
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const u = new URL(url);
      const page = Number(u.searchParams.get('offset'));
      const kw = u.searchParams.get('text');
      if (kw === 'dup') return { meta: { total: 1 }, results: { vacancies: [row('a1', 'Shared')] } };
      // 3 vacancies in total at limit=2: page 0 full (2), page 1 short (1) → stop; page 2 must never be requested.
      return { meta: { total: 3 }, results: { vacancies: page === 0 ? [row('a1', 'Shared'), row('a2', 'Two')] : [row('a3', 'Three')] } };
    },
  };
  const entry = { name: 'Trudvsem', provider: 'trudvsem', trudvsem: { keywords: ['python', 'dup'], page_size: 2 } };
  const jobs = await trudvsem.fetch(entry, ctx);
  check(jobs.map((x) => x.title).join('|') === 'Shared|Two|Three', 'fetch() paginates a keyword and dedupes jobs across keywords', jobs.map((x) => x.title).join('|'));
  check(calls.length === 3 && calls[0].url.includes('offset=0') && calls[1].url.includes('offset=1') && calls[2].url.includes('text=dup'),
    'fetch() stops a keyword on a short page / covered total (no page past the end)', calls.map((c) => c.url).join(' '));
  check(calls.every((c) => c.opts?.redirect === 'error' && c.url.startsWith('https://opendata.trudvsem.ru/api/v1/vacancies?')), 'fetch() passes redirect:"error" on every request and stays on the API host');
  calls.length = 0;
  await trudvsem.fetch(entry, { ...ctx, maxPages: 1 });
  check(calls.length === 2, 'fetch() honours ctx.maxPages = 1 (one page per keyword)', `${calls.length} requests`);
  calls.length = 0;
  await trudvsem.fetch({ ...entry, trudvsem: { keywords: ['python'], region: '7700000000000', page_size: 2 } }, { ...ctx, maxPages: 1 });
  check(calls[0].url.startsWith('https://opendata.trudvsem.ru/api/v1/vacancies/region/7700000000000?'), 'fetch() uses the region endpoint when trudvsem.region is set', calls[0]?.url);
  calls.length = 0;
  const endless = await trudvsem.fetch({ name: 'T', trudvsem: { keywords: ['x'], page_size: 1 } }, { ...ctx, fetchJson: async (url) => { calls.push(url); return { meta: { total: 99999 }, results: { vacancies: [row(`z${calls.length}`, `J${calls.length}`)] } }; } });
  check(endless.length === 3 && calls.length === 3, 'fetch() caps at 3 pages per keyword by default', `${calls.length} requests`);

  // Outage vs partial success
  let outage = false;
  try {
    await trudvsem.fetch(entry, { ...ctx, fetchJson: async () => { throw new Error('HTTP 500'); } });
  } catch (e) {
    outage = /all 2 keyword request\(s\) failed/.test(e.message);
  }
  check(outage, 'fetch() throws when every keyword request fails');
  const partial = await trudvsem.fetch(entry, { ...ctx, fetchJson: async (url, opts) => { if (url.includes('text=dup')) throw new Error('HTTP 500'); return ctx.fetchJson(url, opts); } });
  check(partial.length === 3, 'fetch() keeps results when only some keywords fail', `${partial.length} jobs`);

  // profile.yml fallback (hermetic tmp cwd)
  const withTmpCwd = async (setup, run) => {
    const tmp = mkdtempSync(join(tmpdir(), 'jobber-trudvsem-'));
    const before = process.cwd();
    try {
      setup(tmp);
      process.chdir(tmp);
      return await run();
    } finally {
      process.chdir(before);
    }
  };
  let sentKeyword = null;
  await withTmpCwd(
    (tmp) => {
      mkdirSync(join(tmp, 'config'));
      writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
    },
    () => trudvsem.fetch({ name: 'T', provider: 'trudvsem' }, { fetchJson: async (url) => { sentKeyword = new URL(url).searchParams.get('text'); return { meta: { total: 0 }, results: { vacancies: [] } }; } }),
  );
  check(sentKeyword === 'Data Engineer', 'fetch() falls back to config/profile.yml target_roles when no keywords are configured', String(sentKeyword));
  let noKw = false;
  try {
    await withTmpCwd(() => {}, () => trudvsem.fetch({ name: 'T', provider: 'trudvsem' }, { fetchJson: async () => ({ results: { vacancies: [] } }) }));
  } catch (e) {
    noKw = /no trudvsem\.keywords/.test(e.message);
  }
  check(noKw, 'fetch() throws when no keywords exist in config or profile');

  // A hostile region cannot redirect the request off the API path
  calls.length = 0;
  await trudvsem.fetch({ name: 'T', provider: 'trudvsem', trudvsem: { keywords: ['x'], region: '../../evil' } }, { ...ctx, maxPages: 1 });
  check(calls.length === 1 && calls[0].url.startsWith('https://opendata.trudvsem.ru/api/v1/vacancies?text=x'), 'a malformed region is ignored, never interpolated into the URL path', calls[0]?.url);
} catch (e) {
  fail(`trudvsem provider tests crashed: ${e.message}`);
}
