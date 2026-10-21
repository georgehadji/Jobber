// tests/providers/solides.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — solides');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/solides.mjs')).href);
  const solides = mod.default;

  check(solides.id === 'solides', 'solides.id is "solides"');

  const hit = solides.detect({ name: 'Dynamox', careers_url: 'https://dynamox.vagas.solides.com.br/' });
  check(hit?.url === 'https://apigw.solides.com.br/jobs/v3/home/vacancy?slug=dynamox&take=25&page=1', 'detect() resolves <slug>.vagas.solides.com.br → API url');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/careers'],
    ['http scheme', 'http://dynamox.vagas.solides.com.br/'],
    ['lookalike host', 'https://evil-vagas.solides.com.br.evil.com/'],
    ['lookalike prefix', 'https://dynamox.vagas-solides.com.br/'],
    ['host in path', 'https://evil.example/dynamox.vagas.solides.com.br'],
    ['gateway host itself', 'https://apigw.solides.com.br/'],
    ['non-string', 7],
  ]) {
    check(solides.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  const row = (id, extra = {}) => ({
    id,
    title: `Role ${id}`,
    description: '<p>Hello <strong>world</strong></p><script>evil()</script><p>Second &amp; last</p>',
    currentState: 'em_andamento',
    city: { name: 'Florianópolis' },
    state: { code: 'SC' },
    homeOffice: false,
    createdAt: '2026-10-15',
    ...extra,
  });
  const page1 = { data: { totalPages: 2, data: [row(1), row(2, { homeOffice: true, currentState: undefined }), row(3, { currentState: 'encerrada' }), row(0), row(5, { title: ' ' })] } };
  const page2 = { data: { totalPages: 2, data: [row(10)] } };

  const parsed = mod.parseSolidesPage(page1, 'dynamox', 'Dynamox');
  check(parsed.map(j => j.url).join() === 'https://dynamox.vagas.solides.com.br/vaga/1,https://dynamox.vagas.solides.com.br/vaga/2', 'parse drops closed (encerrada), id-less and title-less rows; keeps missing-state rows');
  check(parsed[0].description === 'Hello world\nSecond & last', `description is tag-stripped text without script (got ${JSON.stringify(parsed[0].description)})`);
  check(parsed[0].postedAt === Date.parse('2026-10-15') && parsed[0].location === 'Florianópolis, SC', 'postedAt from createdAt, location city + state');
  check(parsed[1].location === 'Florianópolis, SC, Remote', 'homeOffice adds Remote (control: row 1 has none)');
  check(!('salary' in parsed[0]), 'salary omitted (period unclear)');
  check(mod.parseSolidesPage({ data: {} }, 'x', 'X').length === 0, 'malformed payload → []');

  // fetch: pagination follows totalPages
  const urls = [];
  const opts = [];
  let sleeps = 0;
  const ctx = {
    fetchJson: async (url, o) => { urls.push(url); opts.push(o); return url.includes('page=2') ? page2 : page1; },
    sleep: async () => { sleeps++; },
  };
  const got = await solides.fetch({ name: 'Dynamox', careers_url: 'https://dynamox.vagas.solides.com.br/' }, ctx);
  check(urls.length === 2 && urls[0].endsWith('page=1') && urls[1].endsWith('page=2'), 'fetch() walks pages 1..totalPages then stops');
  check(opts.every(o => o?.redirect === 'error'), 'every request uses redirect:error');
  check(got.map(j => j.url.split('/').pop()).join() === '1,2,10' && sleeps === 1, 'fetch() merges pages (ids 1,2,10) and paces between pages');

  // maxPages cap (control: same data, uncapped above)
  urls.length = 0;
  const capped = await solides.fetch({ name: 'D', careers_url: 'https://dynamox.vagas.solides.com.br/' }, { ...ctx, maxPages: 1 });
  check(urls.length === 1 && capped.length === 2, 'ctx.maxPages=1 stops after one page');

  // empty page stops the walk
  urls.length = 0;
  await solides.fetch({ name: 'D', careers_url: 'https://dynamox.vagas.solides.com.br/' }, { fetchJson: async u => { urls.push(u); return { data: { totalPages: 99, data: [] } }; } });
  check(urls.length === 1, 'empty page stops pagination even if totalPages says more');

  // SSRF
  let threw = false;
  const before = urls.length;
  try {
    await solides.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && urls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`solides provider tests crashed: ${e.message}`);
}
