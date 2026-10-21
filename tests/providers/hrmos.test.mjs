// tests/providers/hrmos.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hrmos');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hrmos.mjs')).href);
  const hrmos = mod.default;
  const { parseHrmosListing } = mod;

  check(hrmos.id === 'hrmos', 'hrmos.id is "hrmos"', JSON.stringify(hrmos.id));

  // detect() — positive (+ control: each negative below differs from this by ONE property)
  const hit = hrmos.detect({ name: 'CA', careers_url: 'https://hrmos.co/pages/cyberagent-group/jobs' });
  check(hit?.url === 'https://hrmos.co/pages/cyberagent-group/jobs', 'detect() resolves /pages/<board>/jobs', JSON.stringify(hit));
  check(hrmos.detect({ name: 'CA', careers_url: 'https://hrmos.co/pages/1218800560317673472' })?.url === 'https://hrmos.co/pages/1218800560317673472/jobs',
    'detect() accepts a bare board root and a numeric board id');

  // detect() — negatives
  const neg = {
    'wrong host': 'https://example.com/pages/acme/jobs',
    'http scheme': 'http://hrmos.co/pages/acme/jobs',
    'lookalike evil-hrmos.co': 'https://evil-hrmos.co/pages/acme/jobs',
    'lookalike hrmos.co.evil.com': 'https://hrmos.co.evil.com/pages/acme/jobs',
    'subdomain': 'https://corp.hrmos.co/pages/acme/jobs',
    'host in path': 'https://evil.example/https://hrmos.co/pages/acme/jobs',
    'no board segment': 'https://hrmos.co/pages',
    'bad board chars': 'https://hrmos.co/pages/a%20b/jobs',
  };
  for (const [label, u] of Object.entries(neg)) {
    check(hrmos.detect({ name: 'X', careers_url: u }) === null, `detect() rejects ${label}`, JSON.stringify(hrmos.detect({ name: 'X', careers_url: u })));
  }
  check(hrmos.detect({ name: 'X', careers_url: null }) === null && hrmos.detect({ name: 'X', careers_url: 7 }) === null, 'detect() tolerates non-string careers_url');

  // Parser — trimmed shape of the real listing (cards, h2, location tag, body snippet, 全 N 件中)
  const card = (id, title, loc, body, prefix = 'https://hrmos.co') =>
    `<li class="pg-list-cassette jsc-joblist-cassette"> <a href="${prefix}/pages/acme/jobs/${id}"> <h2>${title}</h2> ` +
    `<p> <span class="pg-list-cassette-body jsc-joblist-cassette-body">${body}</span> </p> ` +
    `<ul class="sg-tags cf"> <li>正社員</li> <li class="sg-tag-location">${loc}</li> </ul> </a> </li>`;
  const page1 = `<ul>${card('0001', 'Backend Engineer &amp; Lead', '東京都渋谷区', 'Build things')}${card('0002', 'Designer', '', '')}` +
    `${card('0003', '', 'X', 'no title')}` +
    `<li class="pg-list-cassette jsc-joblist-cassette"> <a href="/pages/other-board/jobs/0004"> <h2>Other board</h2> </a> </li>` +
    `<li class="pg-list-cassette jsc-joblist-cassette"> <a href="https://evil.example/pages/acme/jobs/0005"> <h2>Off host</h2> </a> </li>` +
    `</ul><p class="pg-count"> 全 3 件中 3 件 を表示しています </p>`;
  const parsed = parseHrmosListing(page1, 'acme', 'Acme');
  check(parsed.jobs.length === 2 && parsed.total === 3, 'parser keeps titled same-board cards, drops no-title / other-board / off-host / nav', `${parsed.jobs.length} jobs, total ${parsed.total}`);
  const j0 = parsed.jobs[0];
  check(j0.title === 'Backend Engineer & Lead' && j0.url === 'https://hrmos.co/pages/acme/jobs/0001' && j0.company === 'Acme' && j0.location === '東京都渋谷区' && j0.description === 'Build things',
    'parser maps title (entities decoded), canonical url, company, location, description', JSON.stringify(j0));
  check(!('description' in parsed.jobs[1]) && parsed.jobs[1].location === '', 'parser omits empty description (no empty-string field)', JSON.stringify(parsed.jobs[1]));
  check(parseHrmosListing('', 'acme', 'A').jobs.length === 0 && parseHrmosListing(null, 'acme', 'A').total === null, 'parser: empty / null input → no jobs');

  // fetch() — mock ctx
  const calls = [];
  const pages = {
    1: `${card('0001', 'One', 'Tokyo', 'a')}${card('0002', 'Two', 'Osaka', 'b')}<p class="pg-count"> 全 3 件中 2 件 を表示しています </p>`,
    2: `${card('0003', 'Three', 'Kyoto', 'c')}<p class="pg-count"> 全 3 件中 1 件 を表示しています </p>`,
    3: `${card('9999', 'Should not be requested', 'Z', 'z')}`,
  };
  const ctx = {
    maxPages: undefined,
    sleep: async () => {},
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return pages[new URL(url).searchParams.get('page')] ?? '';
    },
  };
  const jobs = await hrmos.fetch({ name: 'Acme', careers_url: 'https://hrmos.co/pages/acme/jobs' }, ctx);
  check(jobs.map((j) => j.title).join('|') === 'One|Two|Three', 'fetch() walks pages in order and returns every job', jobs.map((j) => j.title).join('|'));
  check(calls.length === 2 && calls[0].url === 'https://hrmos.co/pages/acme/jobs?page=1' && calls[1].url === 'https://hrmos.co/pages/acme/jobs?page=2',
    'fetch() stops once the stated total is reached (page 3 never requested)', calls.map((c) => c.url).join(' '));
  check(calls.every((c) => c.opts?.redirect === 'error'), 'fetch() passes redirect:"error" on every request');

  // maxPages hint (portal health probe passes 1) and repeated-page stop
  calls.length = 0;
  await hrmos.fetch({ name: 'Acme', careers_url: 'https://hrmos.co/pages/acme/jobs' }, { ...ctx, maxPages: 1 });
  check(calls.length === 1, 'fetch() honours ctx.maxPages = 1', `${calls.length} requests`);
  calls.length = 0;
  const loop = await hrmos.fetch({ name: 'Acme', careers_url: 'https://hrmos.co/pages/acme/jobs' }, { ...ctx, fetchText: async (url, opts) => { calls.push({ url, opts }); return card('0001', 'Same', 'T', 'x'); } });
  check(loop.length === 1 && calls.length === 2, 'fetch() stops when a page adds nothing new (server ignoring ?page=)', `${loop.length} jobs, ${calls.length} requests`);
  calls.length = 0;
  const endless = await hrmos.fetch({ name: 'Acme', careers_url: 'https://hrmos.co/pages/acme/jobs' }, { ...ctx, fetchText: async (url) => { calls.push(url); return card(String(calls.length).padStart(4, '0'), `J${calls.length}`, 'T', 'x'); } });
  check(endless.length === 5 && calls.length === 5, 'fetch() caps at 5 pages by default when no total is stated', `${calls.length} requests`);

  // SSRF — hostile careers_url never reaches the network
  for (const u of ['https://evil-hrmos.co/pages/acme/jobs', 'http://hrmos.co/pages/acme/jobs', 'http://169.254.169.254/pages/acme/jobs']) {
    let called = false;
    let threw = false;
    try {
      await hrmos.fetch({ name: 'Evil', careers_url: u }, { fetchText: async () => { called = true; return ''; } });
    } catch {
      threw = true;
    }
    check(threw && !called, `fetch() rejects hostile careers_url ${u} without any request`);
  }
} catch (e) {
  fail(`hrmos provider tests crashed: ${e.message}`);
}
