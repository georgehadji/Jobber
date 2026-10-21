// tests/providers/traffit.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — traffit');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/traffit.mjs')).href);
  const traffit = mod.default;

  check(traffit.id === 'traffit', 'traffit.id is "traffit"');

  check(traffit.detect({ name: 'C', careers_url: 'https://cloudfide.traffit.com/' })?.url === 'https://cloudfide.traffit.com/public/an/list/?limit=100&offset=0', 'detect() claims <tenant>.traffit.com');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/careers'],
    ['http scheme', 'http://cloudfide.traffit.com/'],
    ['lookalike host', 'https://evil-traffit.com/'],
    ['lookalike suffix', 'https://cloudfide.traffit.com.evil.com/'],
    ['host in path', 'https://evil.example/cloudfide.traffit.com'],
    ['reserved www', 'https://www.traffit.com/'],
    ['bare apex', 'https://traffit.com/'],
    ['non-string', 7],
  ]) {
    check(traffit.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  const it = (id, extra = {}) => ({
    advertId: id,
    title: `Role ${id}`,
    name: `Role ${id}`,
    url: `https://acme.traffit.com/public/an/h${id}?source=career_page`,
    description: '<p>Build <em>things</em></p><script>evil()</script>',
    geolocation: '{"iso":"pl","locality":"Warszawa","region1":"Mazowieckie","country":"Polska"}',
    validStart: 1770284174,
    ...extra,
  });
  const items = [
    it(1),
    it(2, { title: '', name: 'Name Fallback', geolocation: null, validStart: null }),
    it(0), // no id → dropped
    it(4, { url: 'https://evil.example/x' }), // foreign host → dropped
    it(5, { url: 'http://acme.traffit.com/x' }), // http → dropped
    it(6, { geolocation: 'not-json' }),
  ];
  const parsed = mod.parseTraffitPage({ count: 6, items }, 'acme', 'Acme');
  check(parsed.map(j => j.title).join('|') === 'Role 1|Name Fallback|Role 6', 'parse keeps valid rows only (identity of titles); name fallback works');
  check(parsed[0].location === 'Warszawa, Mazowieckie, Polska' && parsed[1].location === '' && parsed[2].location === '', 'location from geolocation JSON; null / invalid JSON → empty (control)');
  check(parsed[0].postedAt === 1770284174000 && !('postedAt' in parsed[1]), 'postedAt = validStart*1000, omitted when null');
  check(parsed[0].description === 'Build things', `description is stripped text (got ${JSON.stringify(parsed[0].description)})`);
  check(mod.parseTraffitPage({}, 'acme', 'A').length === 0, 'malformed payload → []');

  // pagination: 150 items total over 2 pages
  const mk = (from, n) => Array.from({ length: n }, (_, i) => it(from + i));
  const urls = [];
  const opts = [];
  let sleeps = 0;
  const ctx = {
    fetchJson: async (url, o) => {
      urls.push(url);
      opts.push(o);
      if (url.endsWith('offset=0')) return { count: 150, items: mk(1000, 100) };
      if (url.endsWith('offset=100')) return { count: 150, items: mk(2000, 50) };
      return { count: 150, items: [] };
    },
    sleep: async () => { sleeps++; },
  };
  const got = await traffit.fetch({ name: 'Acme', careers_url: 'https://acme.traffit.com/' }, ctx);
  check(urls.length === 2 && urls[1].endsWith('offset=100'), 'fetch() stops once count is reached (2 requests, no offset=200)');
  check(got.length === 150 && new Set(got.map(j => j.url)).size === 150, 'fetch() returns 150 distinct jobs');
  check(opts.every(o => o?.redirect === 'error') && sleeps === 1, 'redirect:error on every request; one pause between two pages');

  urls.length = 0;
  const capped = await traffit.fetch({ name: 'Acme', careers_url: 'https://acme.traffit.com/' }, { ...ctx, maxPages: 1 });
  check(urls.length === 1 && capped.length === 100, 'ctx.maxPages=1 stops after one page');

  urls.length = 0;
  await traffit.fetch({ name: 'Acme', careers_url: 'https://acme.traffit.com/' }, { fetchJson: async u => { urls.push(u); return { count: 999, items: [] }; } });
  check(urls.length === 1, 'empty page stops pagination even if count says more');

  let threw = false;
  const before = urls.length;
  try {
    await traffit.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && urls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`traffit provider tests crashed: ${e.message}`);
}
