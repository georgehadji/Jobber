// tests/providers/hiringroom.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hiringroom');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hiringroom.mjs')).href);
  const hr = mod.default;
  const { parseHiringRoomCards } = mod;

  check(hr.id === 'hiringroom', 'hiringroom.id is "hiringroom"', JSON.stringify(hr.id));

  const hit = hr.detect({ name: 'Tata', careers_url: 'https://tatachile.hiringroom.com/jobs' });
  check(hit?.url === 'https://tatachile.hiringroom.com/jobs/getVacanciesForPortal/1', 'detect() resolves <tenant>.hiringroom.com', JSON.stringify(hit));
  check(hr.detect({ name: 'T', careers_url: 'https://tatachile.hiringroom.com/' }) !== null, 'detect() accepts the portal root');
  const neg = {
    'wrong host': 'https://example.com/jobs',
    'http scheme': 'http://tatachile.hiringroom.com/jobs',
    'lookalike evil-hiringroom.com': 'https://evil-hiringroom.com/jobs',
    'lookalike tatachile.hiringroom.com.evil.com': 'https://tatachile.hiringroom.com.evil.com/jobs',
    'bare hiringroom.com': 'https://hiringroom.com/jobs',
    'vendor www label': 'https://www.hiringroom.com/',
    'vendor ve label': 'https://ve.hiringroom.com/',
    'host in path': 'https://evil.example/tatachile.hiringroom.com',
    'nested subdomain': 'https://a.b.hiringroom.com/',
  };
  for (const [label, u] of Object.entries(neg)) {
    check(hr.detect({ name: 'X', careers_url: u }) === null, `detect() rejects ${label}`, JSON.stringify(hr.detect({ name: 'X', careers_url: u })));
  }
  check(hr.detect({ name: 'X', careers_url: null }) === null && hr.detect({ name: 'X', careers_url: 7 }) === null, 'detect() tolerates non-string careers_url');

  // Parser — trimmed shape of the real pager fragment (card = <a href=/jobs/get_vacancy/<24hex>> … name__vacancy … hr-Location-pin …)
  const ID1 = '66984666bb7169324800e116';
  const ID2 = '6a3a8d198f1293a70f3f9ecb';
  const ID3 = '6a6cfa68e72fbb6ad42b5999';
  const card = (id, title, loc, extra = '') =>
    `<a href="/jobs/get_vacancy/${id}" class="text-decoration-none"><div class="card"><h4 class="font-black name__vacancy">\n  ${title}\n </h4>` +
    (loc ? `<p><span class="font-weight-light"><i class="hr-Location-pin hrc-black"></i>\n   ${loc}   </span></p>` : '') +
    `${extra}</div></a>`;
  const fragment = card(ID1, 'Analista de monitoreo JR', 'Surquillo, Lima, Peru') +
    card(ID2, 'Dise&#241;ador &amp; UX', 'Santiago, Chile', '<span class="tag"><i class="hr-Remote mr-1"></i> Remoto</span>') +
    card(ID3, '   ', 'Nowhere') + // no title → dropped
    '<a href="/jobs/get_vacancy/not-hex">\n<h4 class="name__vacancy">Bad id</h4></a>' + // malformed id → dropped
    '<a href="/jobs/other/66984666bb7169324800e116"><h4 class="name__vacancy">Not a vacancy link</h4></a>';
  const cards = parseHiringRoomCards(fragment, 'tatachile', 'Tata');
  check(cards.length === 2, 'parser keeps titled cards with a 24-hex id, drops the rest', cards.map((c) => c.url).join(' '));
  check(cards[0].title === 'Analista de monitoreo JR' && cards[0].url === `https://tatachile.hiringroom.com/jobs/get_vacancy/${ID1}` && cards[0].company === 'Tata' && cards[0].location === 'Surquillo, Lima, Peru',
    'parser maps title, canonical url, company, location (whitespace collapsed)', JSON.stringify(cards[0]));
  check(cards[1].title === 'Diseñador & UX' && cards[1].location === 'Santiago, Chile, Remote', 'parser decodes entities in the title and appends Remote for the hr-Remote tag', JSON.stringify(cards[1]));
  check(parseHiringRoomCards('', 't', 'A').length === 0 && parseHiringRoomCards(undefined, 't', 'A').length === 0, 'parser: empty input → []');

  // fetch() — POST pager. 3 cards total over 2 pages; page 3 must not be requested.
  const page = (n) => ({
    result: 'success',
    data: {
      htmlContent: n === 1 ? card(ID1, 'One', 'A') + card(ID2, 'Two', 'B') : card(ID3, 'Three', 'C'),
      total_vacancies: 3,
    },
  });
  const calls = [];
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      return page(Number(url.split('/').pop()));
    },
  };
  const jobs = await hr.fetch({ name: 'Tata', careers_url: 'https://tatachile.hiringroom.com/jobs' }, ctx);
  check(jobs.map((j) => j.title).join('|') === 'One|Two|Three', 'fetch() accumulates pages until the portal total', jobs.map((j) => j.title).join('|'));
  check(calls.length === 2 && calls[0].url === 'https://tatachile.hiringroom.com/jobs/getVacanciesForPortal/1' && calls[1].url.endsWith('/getVacanciesForPortal/2'),
    'fetch() stops at total_vacancies (page 3 never requested)', calls.map((c) => c.url).join(' '));
  check(calls.every((c) => c.opts?.method === 'POST' && c.opts?.redirect === 'error' && /selectedPage=\d+&typePortal=external/.test(c.opts?.body) && c.opts?.headers?.['content-type'] === 'application/x-www-form-urlencoded'),
    'fetch() POSTs the pager form with redirect:"error" on every request', JSON.stringify(calls[0]?.opts));
  check(calls[1].opts.body === 'selectedPage=2&typePortal=external', 'fetch() sends the page number in the form body', calls[1].opts.body);

  calls.length = 0;
  await hr.fetch({ name: 'Tata', careers_url: 'https://tatachile.hiringroom.com/jobs' }, { ...ctx, maxPages: 1 });
  check(calls.length === 1, 'fetch() honours ctx.maxPages = 1', `${calls.length} requests`);

  // No-progress and error handling
  calls.length = 0;
  const stuck = await hr.fetch({ name: 'T', careers_url: 'https://tatachile.hiringroom.com/' }, { ...ctx, fetchJson: async (url, opts) => { calls.push(url); return { result: 'success', data: { htmlContent: card(ID1, 'Same', 'A'), total_vacancies: 99 } }; } });
  check(stuck.length === 1 && calls.length === 2, 'fetch() stops when a page adds no new vacancy', `${stuck.length} jobs, ${calls.length} requests`);
  const empty = await hr.fetch({ name: 'T', careers_url: 'https://tatachile.hiringroom.com/' }, { ...ctx, fetchJson: async () => ({ result: 'success', data: { htmlContent: '', total_vacancies: 0 } }) });
  check(empty.length === 0, 'fetch() returns [] for an empty portal');
  let threw = false;
  try {
    await hr.fetch({ name: 'T', careers_url: 'https://tatachile.hiringroom.com/' }, { ...ctx, fetchJson: async () => ({ result: 'error' }) });
  } catch (e) {
    threw = /answered "error"/.test(e.message);
  }
  check(threw, 'fetch() throws when the pager does not answer result:"success"');

  // SSRF
  for (const u of ['https://evil-hiringroom.com/jobs', 'http://tatachile.hiringroom.com/jobs', 'http://169.254.169.254/jobs', 'https://www.hiringroom.com/']) {
    let called = false;
    let rejected = false;
    try {
      await hr.fetch({ name: 'Evil', careers_url: u }, { fetchJson: async () => { called = true; return {}; } });
    } catch {
      rejected = true;
    }
    check(rejected && !called, `fetch() rejects hostile careers_url ${u} without any request`);
  }
} catch (e) {
  fail(`hiringroom provider tests crashed: ${e.message}`);
}
