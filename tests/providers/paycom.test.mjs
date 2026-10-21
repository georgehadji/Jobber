// tests/providers/paycom.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — paycom');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

const KEY = 'e743deb45c5896f708643c7d7b581397';
const BASE = `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}`;
const MANTLE = 'https://portal-applicant-tracking.us-cent.paycomonline.net';
const SHELL = `<html><script>var configsFromHost={"sessionJWT":"aaa.bbb.ccc","apiHost":"portal-applicant-tracking.us-cent.paycomonline.net"}</script></html>`;

// Shape of the live previews-search response (2026-10-21, SEGA of America), trimmed.
const row = (id, over = {}) => ({ jobId: id, jobTitle: `Role ${id}`, positionType: 'Full Time', remoteType: '', locations: 'Irvine, CA 92618', description: 'snippet...', postedOn: '', isHotJob: false, ...over });
const PAGE1 = { jobPostingPreviewsCount: 3, jobPostingPreviews: [row(243726, { jobTitle: 'Associate Brand Manager' }), row(252042, { remoteType: 'Remote', locations: '' }), row('bad'), row(7, { jobTitle: ' ' })] };

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/paycom.mjs')).href);
  const paycom = mod.default;
  const { parsePreviews, extractPortalSession, buildSearchBody, resolveClientKey } = mod;

  check(paycom.id === 'paycom', 'paycom.id is "paycom"');

  // detect
  const hit = paycom.detect({ name: 'S', careers_url: `${BASE}/jobs/252042` });
  check(hit?.url === `${BASE}/jobs/1`, `paycom.detect() portal path → bootstrap URL (got ${JSON.stringify(hit)})`);
  check(paycom.detect({ name: 'S', careers_url: `https://paycomonline.net/v4/ats/web.php/portal/${KEY.toUpperCase()}/career-page` })?.url === `${BASE}/jobs/1`, 'paycom.detect() lowercases an upper-case key and accepts the bare host');
  check(paycom.detect({ name: 'S', careers_url: `https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=121110&clientkey=${KEY.toUpperCase()}` })?.url === `${BASE}/jobs/1`, 'paycom.detect() reads clientkey= from a ViewJobDetails link');
  check(paycom.detect({ name: 'S', careers_url: 'https://www.paycomonline.net/v4/ats/web.php/portal/nothex/jobs/1' }) === null, 'paycom.detect() null for a non-32-hex key');
  check(paycom.detect({ name: 'S', careers_url: 'https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=1&clientkey=short' }) === null, 'paycom.detect() null for a malformed clientkey parameter');
  check(paycom.detect({ name: 'S', careers_url: 'https://example.com/careers' }) === null, 'paycom.detect() null for non-Paycom host');
  check(paycom.detect({ name: 'S', careers_url: `http://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/1` }) === null, 'paycom.detect() null for http scheme');
  check(paycom.detect({ name: 'S', careers_url: `https://evil-paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/1` }) === null, 'paycom.detect() null for lookalike host evil-paycomonline.net');
  check(paycom.detect({ name: 'S', careers_url: `https://www.paycomonline.net.evil.example/portal/${KEY}/jobs/1` }) === null, 'paycom.detect() null for suffix-spoofed host');
  check(paycom.detect({ name: 'S', careers_url: `https://evil.example/www.paycomonline.net/portal/${KEY}/jobs/1` }) === null, 'paycom.detect() null for path-spoofed URL');
  check(resolveClientKey({ name: 'S', careers_url: 42 }) === null, 'resolveClientKey null for non-string careers_url');

  // session extraction: valid + control + hostile Mantle host
  const sess = extractPortalSession(SHELL);
  check(sess?.jwt === 'aaa.bbb.ccc' && sess?.mantle === MANTLE, `extractPortalSession reads JWT + Mantle host (got ${JSON.stringify(sess)})`);
  check(extractPortalSession('<html>no token</html>') === null, 'extractPortalSession null without token/host');
  const spoof = extractPortalSession('"sessionJWT":"x" portal-applicant-tracking.us-cent.paycomonline.net.evil.example https://evil.example/portal-applicant-tracking.us-east.paycomonline.net');
  check(spoof?.mantle === MANTLE && !/evil/.test(spoof.mantle), `extractPortalSession rebuilds the origin from the matched paycomonline.net host only, never a page-supplied URL (got ${JSON.stringify(spoof)})`);
  check(extractPortalSession('"sessionJWT":"x" portal-applicant-tracking.evil.example') === null, 'extractPortalSession null when the only host is not under paycomonline.net');

  // body shape: filters MUST nest under filtersForQuery
  const body = buildSearchBody(50, 50);
  check(body.skip === 50 && body.take === 50 && body.filtersForQuery && !('keywordSearchText' in body), 'buildSearchBody nests filters under filtersForQuery');

  // parser
  const jobs = parsePreviews(PAGE1, KEY, 'SEGA');
  check(jobs.length === 2, `parsePreviews drops non-numeric id and blank title (got ${jobs.length})`);
  check(jobs[0].url === `${BASE}/jobs/243726` && jobs[0].title === 'Associate Brand Manager' && jobs[0].location === 'Irvine, CA 92618' && jobs[0].company === 'SEGA',
    `parsePreviews url/title/location/company (got ${JSON.stringify(jobs[0])})`);
  check(jobs[1].location === 'Remote', 'parsePreviews tags remoteType Remote (control: row 0 is not tagged)');
  check(!jobs.some((j) => 'description' in j || 'postedAt' in j), 'parsePreviews omits the truncated snippet and a blank postedOn');
  check(parsePreviews({ jobPostingPreviews: [row(1, { postedOn: '2026-05-01T00:00:00Z' })] }, KEY, 'A')[0].postedAt === Date.parse('2026-05-01T00:00:00Z'), 'parsePreviews keeps a parseable postedOn');
  check(parsePreviews({}, KEY, 'A').length === 0 && parsePreviews(null, KEY, 'A').length === 0, 'parsePreviews malformed payload → []');

  // fetch: pagination (50/page), stops at the reported total, never exceeds maxPages
  const makeCtx = (pages, extra = {}) => {
    const calls = [];
    return {
      calls,
      ctx: {
        sleep: async () => {},
        fetchText: async (url, opts) => { calls.push({ kind: 'text', url, opts }); return SHELL; },
        fetchJson: async (url, opts) => {
          calls.push({ kind: 'json', url, opts });
          const skip = JSON.parse(opts.body).skip;
          return pages[skip / 50] ?? { jobPostingPreviewsCount: 99, jobPostingPreviews: [] };
        },
        ...extra,
      },
    };
  };
  const full = (start, n, total) => ({ jobPostingPreviewsCount: total, jobPostingPreviews: Array.from({ length: n }, (_, i) => row(start + i)) });

  const a = makeCtx([full(1, 50, 60), full(51, 10, 60)]);
  const all = await paycom.fetch({ name: 'SEGA', careers_url: `${BASE}/jobs/1` }, a.ctx);
  const jsonCalls = a.calls.filter((c) => c.kind === 'json');
  check(all.length === 60 && jsonCalls.length === 2, `paycom.fetch() pages until the reported total (jobs=${all.length}, search calls=${jsonCalls.length})`);
  check(a.calls[0].url === `${BASE}/jobs/1` && a.calls[0].opts?.redirect === 'error', 'paycom.fetch() bootstraps from the portal page with redirect:error');
  check(jsonCalls.every((c) => c.url === `${MANTLE}/api/ats/job-posting-previews/search` && c.opts.redirect === 'error' && c.opts.method === 'POST'
    && c.opts.headers.Authorization === 'aaa.bbb.ccc' && JSON.parse(c.opts.body).filtersForQuery), 'paycom.fetch() search calls: POST, Mantle URL, JWT header, redirect:error, filtersForQuery body');
  check(JSON.parse(jsonCalls[1].opts.body).skip === 50, 'paycom.fetch() second page uses skip=50');

  const b = makeCtx([full(1, 50, 500), full(51, 50, 500), full(101, 50, 500)], { maxPages: 1 });
  const capped = await paycom.fetch({ name: 'S', careers_url: `${BASE}/jobs/1` }, b.ctx);
  check(capped.length === 50 && b.calls.filter((c) => c.kind === 'json').length === 1, `paycom.fetch() honours ctx.maxPages=1 (jobs=${capped.length})`);

  const c = makeCtx([full(1, 50, 5000)], { maxPages: undefined });
  c.ctx.fetchJson = async (url, opts) => { c.calls.push({ kind: 'json' }); const s = JSON.parse(opts.body).skip; return full(s + 1, 50, 5000); };
  await paycom.fetch({ name: 'S', careers_url: `${BASE}/jobs/1` }, c.ctx);
  check(c.calls.filter((x) => x.kind === 'json').length === 5, `paycom.fetch() default cap is 5 pages (got ${c.calls.filter((x) => x.kind === 'json').length})`);

  const d = makeCtx([{ jobPostingPreviewsCount: 3, jobPostingPreviews: [] }]);
  check((await paycom.fetch({ name: 'S', careers_url: `${BASE}/jobs/1` }, d.ctx)).length === 0 && d.calls.filter((x) => x.kind === 'json').length === 1, 'paycom.fetch() stops on an empty page');

  // retired client key vs missing token
  let gone = '';
  try { await paycom.fetch({ name: 'S', careers_url: `${BASE}/jobs/1` }, { fetchText: async () => '<p>Job board does not exist.</p>', fetchJson: async () => ({}) }); } catch (e) { gone = e.message; }
  let noTok = '';
  try { await paycom.fetch({ name: 'S', careers_url: `${BASE}/jobs/1` }, { fetchText: async () => '<html></html>', fetchJson: async () => ({}) }); } catch (e) { noTok = e.message; }
  check(/does not exist/.test(gone) && /no session token/.test(noTok), `paycom.fetch() distinguishes a retired key (${JSON.stringify(gone)}) from a missing token (${JSON.stringify(noTok)})`);

  const hostile = [];
  let threw = false;
  try { await paycom.fetch({ name: 'X', careers_url: 'https://evil.example/portal/' + KEY + '/jobs/1' }, { fetchText: async (u) => { hostile.push(u); return SHELL; }, fetchJson: async (u) => { hostile.push(u); return PAGE1; } }); } catch { threw = true; }
  check(threw && hostile.length === 0, 'paycom.fetch() rejects a hostile careers_url without making a request');
} catch (e) {
  fail(`paycom provider tests crashed: ${e.message}`);
}
