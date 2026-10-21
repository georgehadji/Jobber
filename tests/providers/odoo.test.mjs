// tests/providers/odoo.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — odoo');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/odoo.mjs')).href);
  const odoo = mod.default;

  check(odoo.id === 'odoo', 'odoo.id is "odoo"');

  check(odoo.detect({ name: 'H', careers_url: 'https://hhgjapan.odoo.com/jobs' })?.url === 'https://hhgjapan.odoo.com/jobs', 'detect() claims <tenant>.odoo.com/jobs');
  check(odoo.detect({ name: 'H', careers_url: 'https://hhgjapan.odoo.com/' })?.url === 'https://hhgjapan.odoo.com/jobs', 'detect() defaults to /jobs');
  check(odoo.detect({ name: 'H', careers_url: 'https://caval-admin.odoo.com/en/jobs' })?.url === 'https://caval-admin.odoo.com/en/jobs', 'detect() keeps a language prefix');
  check(odoo.detect({ name: 'H', careers_url: 'https://hhgjapan.odoo.com/en/evil?x=1' })?.url === 'https://hhgjapan.odoo.com/jobs', 'detect() drops unrelated path/query (control: no prefix kept)');
  for (const [label, url] of [
    ['self-hosted domain', 'https://jobs.company.com/jobs'],
    ['http scheme', 'http://hhgjapan.odoo.com/jobs'],
    ['lookalike host', 'https://evil-odoo.com/jobs'],
    ['lookalike suffix', 'https://hhgjapan.odoo.com.evil.com/jobs'],
    ['host in path', 'https://evil.example/hhgjapan.odoo.com/jobs'],
    ['vendor www', 'https://www.odoo.com/jobs'],
    ['bare apex', 'https://odoo.com/jobs'],
    ['non-string', 7],
  ]) {
    check(odoo.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  const card = (href, title, loc, country) => `<div class="col-lg mb32"><div class="card"><a draggable="false" href="${href}" class="text-decoration-none text-reset"><div class="card-body p-4"><div class="mt0"><h3>${title}</h3></div>
<address><div itemscope="itemscope" itemtype="http://schema.org/PostalAddress"><span><div><span itemprop="addressLocality">${loc}</span>,
<span itemprop="addressRegion">JP-20</span>,
<span itemprop="addressCountry">${country}</span></div></span></div></address></div></a></div></div>`;
  const html = [
    card('/jobs/chef-de-cuisine-43', 'Chef de Cuisine', 'Hakuba, Kitaazumi', 'Japan'),
    card('/jobs/detail/restaurant-manager-9', 'Restaurant &amp; Bar Manager', 'Hakuba', 'Japan'),
    card('/jobs/chef-de-cuisine-43', 'Duplicate', 'X', 'Y'),
    card('/jobs/', 'Listing root', 'X', 'Y'),
    card('/jobs/country/japan-3', 'Filter link', 'X', 'Y').replace('country/japan-3', 'country/japan'),
    card('https://evil.example/jobs/trap-77', 'Foreign host', 'X', 'Y'),
    card('http://hhgjapan.odoo.com/jobs/insecure-88', 'Insecure', 'X', 'Y'),
    '<a href="/jobs/no-heading-5"><span>No heading</span></a>',
  ].join('\n');

  const jobs = mod.parseOdooListing(html, 'https://hhgjapan.odoo.com/jobs', 'HHG');
  check(jobs.map(j => j.url).join() === 'https://hhgjapan.odoo.com/jobs/chef-de-cuisine-43,https://hhgjapan.odoo.com/jobs/detail/restaurant-manager-9', 'parse keeps same-host https /jobs/<slug>-<id> cards, dedups (identity of urls)');
  check(jobs[0].title === 'Chef de Cuisine' && jobs[1].title === 'Restaurant & Bar Manager', 'titles from <h3>, entities decoded');
  check(jobs[0].location === 'Hakuba, Kitaazumi, Japan' && jobs[1].location === 'Hakuba, Japan', 'location = addressLocality + addressCountry');
  check(jobs[0].company === 'HHG' && !('description' in jobs[0]) && !('postedAt' in jobs[0]), 'company = entry name; no description/postedAt (list-only)');
  check(mod.parseOdooListing('<html></html>', 'https://x.odoo.com/jobs', 'X').length === 0, 'no cards → []');
  const dbl = mod.parseOdooListing(card('/jobs/escaped-12', 'R&amp;D &amp;lt;Lead&amp;gt;', 'Tokyo', 'Japan'), 'https://hhgjapan.odoo.com/jobs', 'HHG');
  check(dbl[0]?.title === 'R&D &lt;Lead&gt;', `entities decoded once — &amp;lt; stays "&lt;", never "<" (got ${JSON.stringify(dbl[0]?.title)})`);

  const calls = [];
  const ctx = { fetchText: async (url, o) => { calls.push({ url, o }); return html; } };
  const got = await odoo.fetch({ name: 'HHG', careers_url: 'https://hhgjapan.odoo.com/jobs' }, ctx);
  check(calls.length === 1 && calls[0].url === 'https://hhgjapan.odoo.com/jobs' && calls[0].o?.redirect === 'error', 'fetch() requests the listing once with redirect:error');
  check(got.length === 2, 'fetch() returns parsed jobs');

  let threw = false;
  const before = calls.length;
  try {
    await odoo.fetch({ name: 'Evil', careers_url: 'https://evil.example/jobs' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && calls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`odoo provider tests crashed: ${e.message}`);
}
