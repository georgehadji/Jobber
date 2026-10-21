// tests/providers/paycor.test.mjs — Paycor Recruiting provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — paycor');

const CID = '8a7883c664f8df9e0165119e33353606';
const GOOD = `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${CID}`;
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/paycor.mjs')).href);
  const p = mod.default;
  const { parsePaycorListing } = mod;

  check(p.id === 'paycor', 'paycor.id is "paycor"', JSON.stringify(p.id));

  const hit = p.detect({ name: 'Acme', careers_url: GOOD });
  check(hit?.url === GOOD, 'paycor.detect() resolves clientId → CareerHome listing URL', JSON.stringify(hit));
  check(p.detect({ name: 'Acme', careers_url: `https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${CID.toUpperCase()}&id=abc` })?.url === GOOD,
    'paycor.detect() accepts a posting URL and normalizes clientId case');
  const negatives = {
    'wrong host': `https://example.com/career/CareerHome.action?clientId=${CID}`,
    'http scheme': GOOD.replace('https:', 'http:'),
    'lookalike host (evil-)': GOOD.replace('recruitingbypaycor.com', 'evil-recruitingbypaycor.com'),
    'lookalike suffix': GOOD.replace('recruitingbypaycor.com', 'recruitingbypaycor.com.evil.test'),
    'host in path': `https://evil.test/recruitingbypaycor.com/career/CareerHome.action?clientId=${CID}`,
    'short clientId': 'https://recruitingbypaycor.com/career/CareerHome.action?clientId=abc123',
    'non-hex clientId': `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${'z'.repeat(32)}`,
    'no clientId': 'https://recruitingbypaycor.com/career/CareerHome.action',
  };
  for (const [label, url] of Object.entries(negatives)) {
    check(p.detect({ name: 'X', careers_url: url }) === null, `paycor.detect() rejects ${label}`);
  }
  check(p.detect({ name: 'X', careers_url: null }) === null && p.detect({ name: 'X', careers_url: 7 }) === null, 'paycor.detect() tolerates non-string careers_url');

  // fixture — shaped like the live listing (trimmed)
  const link = (id, title, extra = '', cid = CID) => `
    <div class="gnewtonCareerGroupRowClass">
      <div class="gnewtonCareerGroupJobTitleClass">
        <a href="https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${cid}&amp;id=${id}&amp;source=&amp;lang=en" ns-qa="x">
          ${title}
        </a>
      </div>
      <div class="gnewtonCareerGroupJobDescriptionClass">
        ${extra}
      </div>
    </div>`;
  const html = `<html><body><div class="gnewtonCareerGroupHeaderClass">Legal</div>
    ${link('8a7885a8a0abfd5001a0ec93dab63411', 'Associate General Counsel, Commercial Contracts', 'Dublin, Ireland')}
    ${link('8a78879e9f4435c7019f60d4805405c0', 'Director, Enterprise Sales &amp; Partnerships', 'Austin,&nbsp;TX')}
    ${link('8a78879e9f4435c7019f60d4805405c0', 'Duplicate Of Previous', 'Nowhere')}
    ${link('8a78839e9fd3ba7b01a033770e2355f5', 'Other Board Role', 'Elsewhere', 'ffffffffffffffffffffffffffffffff')}
    ${link('8a78839e9fd3ba7b01a033770e2355f6', '   ', 'No Title')}
    ${link('x', 'Bad Id Role', 'Nowhere')}
    <a href="https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${CID}">Submit your resume</a>
    <a href="https://evil.test/career/JobIntroduction.action?clientId=${CID}&amp;id=8a78839e9fd3ba7b01a033770e2355f7">Evil host role</a>
    <a href="/about">About us</a>
    </body></html>`;
  const jobs = parsePaycorListing(html, CID, 'Acme');
  check(jobs.length === 2 && jobs[0].title === 'Associate General Counsel, Commercial Contracts' && jobs[1].title === 'Director, Enterprise Sales & Partnerships',
    'parsePaycorListing keeps own-board postings, drops dupes / other clientId / blank title / bad id / id-less / off-host (by identity)', jobs.map(j => j.title).join('|'));
  check(jobs[0].url === `https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${CID}&id=8a7885a8a0abfd5001a0ec93dab63411`, 'parsePaycorListing rebuilds canonical URL without tracking params', jobs[0].url);
  check(jobs[0].location === 'Dublin, Ireland' && jobs[1].location === 'Austin, TX' && jobs[0].company === 'Acme', 'parsePaycorListing reads sibling location cell, decodes entities/nbsp');
  check(!('description' in jobs[0]) && !('postedAt' in jobs[0]) && !('salary' in jobs[0]), 'parsePaycorListing omits fields the listing does not carry');
  check(parsePaycorListing('', CID, 'X').length === 0 && parsePaycorListing(null, CID, 'X').length === 0 && parsePaycorListing('<html>no jobs</html>', CID, 'X').length === 0, 'parsePaycorListing empty / malformed → []');

  // fetch() — mock ctx
  const calls = [];
  const ctx = { fetchText: async (url, opts) => { calls.push({ url, opts }); return html; } };
  const fetched = await p.fetch({ name: 'Acme', careers_url: GOOD }, ctx);
  check(fetched.length === 2 && calls.length === 1 && calls[0].url === GOOD && calls[0].opts?.redirect === 'error', 'paycor.fetch() requests the listing once with redirect:error and parses it', `jobs=${fetched.length} calls=${calls.length}`);

  let hits = 0;
  let threw = '';
  try { await p.fetch({ name: 'Evil', careers_url: GOOD.replace('recruitingbypaycor.com', 'evil.test') }, { fetchText: async () => { hits++; return ''; } }); } catch (e) { threw = e.message; }
  check(/cannot derive/.test(threw) && hits === 0, 'paycor.fetch() rejects hostile careers_url before any request', `threw="${threw}" hits=${hits}`);
} catch (e) {
  fail(`paycor provider tests crashed: ${e.message}`);
}
