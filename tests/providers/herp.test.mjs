// tests/providers/herp.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — herp');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/herp.mjs')).href);
  const herp = mod.default;
  const { parseHerpListing } = mod;

  check(herp.id === 'herp', 'herp.id is "herp"', JSON.stringify(herp.id));

  const hit = herp.detect({ name: 'GxP', careers_url: 'https://herp.careers/v1/a244' });
  check(hit?.url === 'https://herp.careers/v1/a244', 'detect() resolves /v1/<board>', JSON.stringify(hit));
  check(herp.detect({ name: 'GxP', careers_url: 'https://herp.careers/v1/a244/requisition-groups/d4917a2b-a689-417c-a27b-2fb1bf8b2759' })?.url === 'https://herp.careers/v1/a244',
    'detect() reduces a deeper herp URL to the board root');

  const neg = {
    'wrong host': 'https://example.com/v1/a244',
    'http scheme': 'http://herp.careers/v1/a244',
    'lookalike evil-herp.careers': 'https://evil-herp.careers/v1/a244',
    'lookalike herp.careers.evil.com': 'https://herp.careers.evil.com/v1/a244',
    'subdomain': 'https://www.herp.careers/v1/a244',
    'host in path': 'https://evil.example/herp.careers/v1/a244',
    'no board segment': 'https://herp.careers/v1',
    'no /v1 prefix': 'https://herp.careers/a244',
  };
  for (const [label, u] of Object.entries(neg)) {
    check(herp.detect({ name: 'X', careers_url: u }) === null, `detect() rejects ${label}`, JSON.stringify(herp.detect({ name: 'X', careers_url: u })));
  }
  check(herp.detect({ name: 'X', careers_url: null }) === null && herp.detect({ name: 'X', careers_url: 7 }) === null, 'detect() tolerates non-string careers_url');

  // Parser — shape of the real board page (card anchors with h2, group links, nav/share/apply/top links)
  const GROUP = 'd4917a2b-a689-417c-a27b-2fb1bf8b2759';
  const board = [
    `<a href="/v1/a244/requisition-groups/${GROUP}"><span>Engineers 5件</span></a>`,
    '<a class="requisition-list-card__header-anchor" href="/v1/a244/AlyUGj2d3Wjq"><h2 class="heading">【名古屋】Webシステム開発リーダー &amp; PM</h2></a>',
    '<a href="/v1/a244/AlyUGj2d3Wjq"><img alt=""></a>', // image link to the same job: no title, must not duplicate or blank it
    '<a href="https://herp.careers/v1/a244/fLSK5q-IZ96J"><h2>Absolute-URL job</h2></a>',
    '<a href="/v1/a244/top">Top page</a>', // platform machinery
    '<a href="/v1/a244/AlyUGj2d3Wjq/apply">Apply</a>', // sublink
    '<a href="/v1/other/zzzzzzzz"><h2>Other board</h2></a>',
    '<a href="https://twitter.com/share?url=https%3A%2F%2Fherp.careers%2Fv1%2Fa244%2FGnoQonoXGBZi">Share</a>',
    '<a href="/v1/a244/EmptyTitle0001"><h2> </h2></a>',
  ].join('');
  const parsed = parseHerpListing(board, 'a244', 'GxP');
  check(parsed.jobs.length === 2, 'parser keeps only titled same-board single-segment links', parsed.jobs.map((j) => j.url).join(' '));
  check(parsed.jobs[0].title === '【名古屋】Webシステム開発リーダー & PM' && parsed.jobs[0].url === 'https://herp.careers/v1/a244/AlyUGj2d3Wjq' && parsed.jobs[0].company === 'GxP' && parsed.jobs[0].location === '',
    'parser maps title (entities decoded), url, company, empty location', JSON.stringify(parsed.jobs[0]));
  check(parsed.jobs[1].url === 'https://herp.careers/v1/a244/fLSK5q-IZ96J', 'parser accepts absolute herp.careers hrefs and ids containing - / _');
  check(parsed.groups.length === 1 && parsed.groups[0] === GROUP, 'parser collects requisition-group ids separately from jobs', JSON.stringify(parsed.groups));
  check(parseHerpListing('<a href="/v1/a244/requisition-groups/not-a-uuid">x</a>', 'a244', 'G').groups.length === 0, 'parser rejects a malformed requisition-group id');
  check(parseHerpListing('', 'a244', 'G').jobs.length === 0 && parseHerpListing(null, 'a244', 'G').groups.length === 0, 'parser: empty / null input → nothing');

  // fetch()
  const calls = [];
  const rootHtml = `<a href="/v1/a244/requisition-groups/${GROUP}">g</a><a href="/v1/a244/JobRoot0001"><h2>Root job</h2></a>`;
  const groupHtml = '<a href="/v1/a244/JobGroup001"><h2>Group job</h2></a><a href="/v1/a244/JobRoot0001"><h2>Root job</h2></a>';
  const ctx = {
    sleep: async () => {},
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return url.includes('requisition-groups') ? groupHtml : rootHtml;
    },
  };
  const jobs = await herp.fetch({ name: 'GxP', careers_url: 'https://herp.careers/v1/a244' }, ctx);
  check(jobs.map((j) => j.title).join('|') === 'Root job|Group job', 'fetch() merges board + requisition-group jobs, deduped', jobs.map((j) => j.title).join('|'));
  check(calls[0].url === 'https://herp.careers/v1/a244' && calls[1].url === `https://herp.careers/v1/a244/requisition-groups/${GROUP}`, 'fetch() requests the board then the group page', calls.map((c) => c.url).join(' '));
  check(calls.every((c) => c.opts?.redirect === 'error'), 'fetch() passes redirect:"error" on every request');
  calls.length = 0;
  const probe = await herp.fetch({ name: 'GxP', careers_url: 'https://herp.careers/v1/a244' }, { ...ctx, maxPages: 1 });
  check(calls.length === 1 && probe.length === 1, 'fetch() honours ctx.maxPages = 1 (board page only)', `${calls.length} requests`);

  // SSRF
  for (const u of ['https://evil-herp.careers/v1/a244', 'http://herp.careers/v1/a244', 'http://169.254.169.254/v1/a244']) {
    let called = false;
    let threw = false;
    try {
      await herp.fetch({ name: 'Evil', careers_url: u }, { fetchText: async () => { called = true; return ''; } });
    } catch {
      threw = true;
    }
    check(threw && !called, `fetch() rejects hostile careers_url ${u} without any request`);
  }
} catch (e) {
  fail(`herp provider tests crashed: ${e.message}`);
}
